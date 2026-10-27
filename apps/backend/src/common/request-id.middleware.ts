import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const VALID_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Identifiant de corrélation : repris de X-Request-Id s'il est valide, sinon généré. */
export function requestId(req: Request & { id?: string }, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  req.id = incoming && VALID_ID.test(incoming) ? incoming : `req_${randomUUID().replace(/-/g, '')}`;
  res.setHeader('X-Request-Id', req.id);
  next();
}
