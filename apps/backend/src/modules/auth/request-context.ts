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
