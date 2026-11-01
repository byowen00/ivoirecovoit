import type { Request } from 'express';
import type { RequestContext } from '../../infra/audit.service';
import type { SessionKind, UserStatus } from '../../database/types';

export interface AuthContext {
  userId: string;
  sessionId: string;
  kind: SessionKind;
  status: UserStatus;
  /** Personnel uniquement : union des permissions de ses rôles. */
  permissions: Set<string>;
  roles: string[];
}

export type AppRequest = Request & { id?: string; auth?: AuthContext };

export function requestContext(req: AppRequest): RequestContext {
  return { ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null, requestId: req.id ?? null };
}

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/i;

/**
 * Vraie si la requête vient de l'ordinateur ou du réseau local, et non d'Internet : aucun en-tête Cloudflare
 * (tunnel) et des noms d'hôte locaux, y compris celui d'origine quand le site relaie la requête.
 */
export function isLocalRequest(req: Pick<Request, 'headers'>): boolean {
  const h = req.headers;
  if (h['cf-connecting-ip'] || h['cf-ray']) return false;
  const hosts = [h.host, h['x-forwarded-host']].flatMap((v) => (Array.isArray(v) ? v : v ? v.split(',') : []));
  return hosts.length > 0 && hosts.every((v) => LOCAL_HOST.test(v.trim()));
}
