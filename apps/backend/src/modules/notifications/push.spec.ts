import { createVerify, generateKeyPairSync } from 'node:crypto';
import { DisabledPushChannel, FcmPushChannel } from './push';

/** Faux serveur Firebase : aucune requête ne sort de la machine. */
function fakeFirebase(publicKey: string, sendStatus: number, sendBody: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const http = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/token')) {
      const assertion = new URLSearchParams(init.body as URLSearchParams).get('assertion')!;
      const [h, p, sig] = assertion.split('.');
      const ok = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(sig!, 'base64url'));
      return new Response(JSON.stringify(ok ? { access_token: 'jeton-oauth', expires_in: 3600 } : {}), { status: ok ? 200 : 401 });
    }
    return new Response(JSON.stringify(sendBody), { status: sendStatus });
  }) as unknown as typeof fetch;
  return { http, calls };
}

describe('FcmPushChannel (contre un faux serveur, jamais contre Firebase)', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' },
                                                               privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const account = Buffer.from(JSON.stringify({ client_email: 'svc@exemple.iam', private_key: privateKey, token_uri: 'https://faux.test/token' })).toString('base64');
  const message = { token: 'jeton-appareil', title: 'Paiement confirmé', body: '5 300 F CFA reçus', data: { link: '/reservations/1' } };

  it('signe l’assertion JWT, réutilise le jeton OAuth et envoie le message', async () => {
    const fake = fakeFirebase(publicKey, 200, { name: 'projects/p/messages/42' });
    const ch = new FcmPushChannel('projet-test', account, fake.http, 'https://faux.test');
    expect(await ch.send(message)).toEqual({ status: 'SENT', providerMessageId: 'projects/p/messages/42' });
    await ch.send(message);
    expect(fake.calls.filter((c) => c.url.endsWith('/token'))).toHaveLength(1);
    const sent = fake.calls.find((c) => c.url.includes('/messages:send'))!;
    expect(sent.url).toBe('https://faux.test/v1/projects/projet-test/messages:send');
    expect((sent.init.headers as Record<string, string>).authorization).toBe('Bearer jeton-oauth');
    expect(JSON.parse(sent.init.body as string).message).toMatchObject({ token: 'jeton-appareil', notification: { title: 'Paiement confirmé' }, data: { link: '/reservations/1' } });
  });

  it('jeton d’appareil périmé → INVALID_TOKEN ; erreur serveur → à réessayer ; 400 autre → définitif', async () => {
    const gone = new FcmPushChannel('p', account, fakeFirebase(publicKey, 404, { error: { status: 'UNREGISTERED' } }).http, 'https://faux.test');
    expect((await gone.send(message)).status).toBe('INVALID_TOKEN');
    const down = new FcmPushChannel('p', account, fakeFirebase(publicKey, 503, {}).http, 'https://faux.test');
    expect(await down.send(message)).toMatchObject({ status: 'FAILED', retryable: true });
    const bad = new FcmPushChannel('p', account, fakeFirebase(publicKey, 403, { error: 'PERMISSION_DENIED' }).http, 'https://faux.test');
    expect(await bad.send(message)).toMatchObject({ status: 'FAILED', retryable: false });
  });

  it('compte de service incomplet refusé ; canal désactivé n’envoie rien', async () => {
    expect(() => new FcmPushChannel('p', Buffer.from('{}').toString('base64'))).toThrow('incomplet');
    const off = new DisabledPushChannel();
    expect(off.configured).toBe(false);
    expect(await off.send()).toMatchObject({ status: 'FAILED', error: 'PUSH_NOT_CONFIGURED' });
  });
});
