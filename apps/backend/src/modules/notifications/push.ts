import { createSign } from 'node:crypto';

/*
 * Canal « notification sur le téléphone » derrière une interface (EF-81, EF-83 : les canaux SMS et WhatsApp
 * viendront derrière la même interface). Deux implémentations :
 *   - DisabledPushChannel : aucun envoi, la notification reste visible dans l'application ;
 *   - FcmPushChannel : Firebase Cloud Messaging, API HTTP v1. ÉCRIT D'APRÈS LA DOCUMENTATION PUBLIQUE, JAMAIS ESSAYÉ
 *     AVEC UN VRAI PROJET FIREBASE (aucun projet ni compte de service fourni). Testé seulement contre un faux serveur.
 */

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  /** Lien profond dans l'application (ex. /reservations/…). */
  data: Record<string, string>;
}

export type PushResult =
  | { status: 'SENT'; providerMessageId: string }
  /** Jeton périmé ou inconnu : à supprimer. */
  | { status: 'INVALID_TOKEN'; error: string }
  | { status: 'FAILED'; error: string; retryable: boolean };

export interface PushChannel {
  readonly configured: boolean;
  send(message: PushMessage): Promise<PushResult>;
}

export const PUSH_CHANNEL = Symbol('PUSH_CHANNEL');

export class DisabledPushChannel implements PushChannel {
  readonly configured = false;
  send(): Promise<PushResult> {
    return Promise.resolve({ status: 'FAILED', error: 'PUSH_NOT_CONFIGURED', retryable: false });
  }
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

type Fetch = typeof fetch;

export class FcmPushChannel implements PushChannel {
  readonly configured = true;
  private readonly account: ServiceAccount;
  private accessToken?: { value: string; expiresAt: number };

  constructor(
    private readonly projectId: string,
    serviceAccountB64: string,
    private readonly http: Fetch = fetch,
    private readonly baseUrl = 'https://fcm.googleapis.com',
  ) {
    this.account = JSON.parse(Buffer.from(serviceAccountB64, 'base64').toString('utf8')) as ServiceAccount;
    if (!this.account.client_email || !this.account.private_key) throw new Error('Compte de service Firebase incomplet');
  }

  /** Jeton OAuth 2 du compte de service (assertion JWT RS256), gardé jusqu'à une minute avant son expiration. */
  private async token(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.accessToken && this.accessToken.expiresAt > now + 60) return this.accessToken.value;
    const tokenUri = this.account.token_uri ?? 'https://oauth2.googleapis.com/token';
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({
      iss: this.account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(this.account.private_key).toString('base64url');
    const res = await this.http(tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
    });
    if (!res.ok) throw new Error(`Jeton Firebase refusé (${res.status})`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.accessToken = { value: body.access_token, expiresAt: now + body.expires_in };
    return body.access_token;
  }

  async send(m: PushMessage): Promise<PushResult> {
    let token: string;
    try {
      token = await this.token();
    } catch (err) {
      return { status: 'FAILED', error: (err as Error).message.slice(0, 300), retryable: true };
    }
    const res = await this.http(`${this.baseUrl}/v1/projects/${encodeURIComponent(this.projectId)}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: m.token,
          notification: { title: m.title, body: m.body },
          data: m.data,
          android: { priority: 'HIGH' },
        },
      }),
    }).catch((err: Error) => err);
    if (res instanceof Error) return { status: 'FAILED', error: res.message.slice(0, 300), retryable: true };
    if (res.ok) {
      const body = (await res.json()) as { name?: string };
      return { status: 'SENT', providerMessageId: body.name ?? '' };
    }
    const text = (await res.text().catch(() => '')).slice(0, 300);
    // 404 UNREGISTERED / 400 INVALID_ARGUMENT sur le jeton : l'application a été désinstallée ou le jeton a changé.
    if (res.status === 404 || (res.status === 400 && /registration token|UNREGISTERED|INVALID_ARGUMENT/i.test(text))) {
      return { status: 'INVALID_TOKEN', error: text || `HTTP ${res.status}` };
    }
    return { status: 'FAILED', error: text || `HTTP ${res.status}`, retryable: res.status === 429 || res.status >= 500 };
  }
}
