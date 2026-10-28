import { HttpStatus, Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { createPublicKey, generateKeyPairSync, type KeyObject, createPrivateKey } from 'node:crypto';
import { errors, jwtVerify, SignJWT } from 'jose';
import { ApiError } from '../../common/api-error';
import { ENV, type Env } from '../../config/env';
import type { SessionKind } from '../../database/types';

export const ACCESS_TOKEN_TTL_S = 15 * 60;
const ISSUER = 'ivoirecovoit';
const AUDIENCE = 'ivoirecovoit-api';

export interface AccessClaims {
  userId: string;
  sessionId: string;
  kind: SessionKind;
}

/** Jetons d'accès JWT signés EdDSA (Ed25519), valables 15 minutes. */
@Injectable()
export class TokenService implements OnModuleInit {
  private privateKey!: KeyObject;
  private publicKey!: KeyObject;

  constructor(@Inject(ENV) private readonly env: Env) {}

  onModuleInit(): void {
    if (this.env.JWT_PRIVATE_KEY && this.env.JWT_PUBLIC_KEY) {
      this.privateKey = createPrivateKey(this.env.JWT_PRIVATE_KEY.replace(/\\n/g, '\n'));
      this.publicKey = createPublicKey(this.env.JWT_PUBLIC_KEY.replace(/\\n/g, '\n'));
    } else {
      // Hors production uniquement (la configuration l'impose) : les jetons d'accès ne survivent pas à un redémarrage,
      // l'application les renouvelle alors avec le refresh token.
      const pair = generateKeyPairSync('ed25519');
      this.privateKey = pair.privateKey;
      this.publicKey = pair.publicKey;
      new Logger('Auth').warn('JWT_PRIVATE_KEY absente : paire de clés éphémère générée (développement uniquement).');
    }
    if (this.privateKey.asymmetricKeyType !== 'ed25519') throw new Error('JWT_PRIVATE_KEY doit être une clé Ed25519');
  }

  async sign(claims: AccessClaims): Promise<string> {
    return new SignJWT({ sid: claims.sessionId, knd: claims.kind })
      .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
      .setSubject(claims.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_TTL_S}s`)
      .sign(this.privateKey);
  }

  async verify(token: string): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.publicKey, {
        algorithms: ['EdDSA'],
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      const { sub, sid, knd } = payload as { sub?: unknown; sid?: unknown; knd?: unknown };
      if (typeof sub !== 'string' || typeof sid !== 'string' || (knd !== 'USER' && knd !== 'STAFF')) {
        throw new Error('claims invalides');
      }
      return { userId: sub, sessionId: sid, kind: knd };
    } catch (err) {
      if (err instanceof errors.JWTExpired) {
        throw new ApiError(HttpStatus.UNAUTHORIZED, 'TOKEN_EXPIRED', 'Votre session a expiré. Reconnexion en cours…');
      }
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Authentification requise.');
    }
  }
}
