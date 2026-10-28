import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiError } from './api-error';

const DEFAULT_CODES: Record<number, [string, string]> = {
  400: ['VALIDATION_ERROR', 'La requête est invalide.'],
  401: ['UNAUTHENTICATED', 'Authentification requise.'],
  403: ['FORBIDDEN', "Vous n'avez pas accès à cette ressource."],
  404: ['NOT_FOUND', 'Ressource introuvable.'],
  409: ['CONFLICT', 'Conflit avec l’état actuel de la ressource.'],
  429: ['RATE_LIMITED', 'Trop de requêtes. Réessayez plus tard.'],
};

/** Format d'erreur unique, sans pile ni détail interne (SQL, chemins) envoyés au client. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const requestId = req.id;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Une erreur inattendue est survenue. Réessayez dans un instant.';
    let details: Record<string, unknown> | undefined;

    if (exception instanceof ApiError) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const [defaultCode, defaultMessage] = DEFAULT_CODES[status] ?? ['HTTP_ERROR', exception.message];
      code = defaultCode;
      message = defaultMessage;
    }

    if (status >= 500) {
      this.logger.error(`${req.method} ${req.url} [${requestId}]`, (exception as Error)?.stack);
    }
    const retryAfterS = details?.retryAfterS;
    if (status === HttpStatus.TOO_MANY_REQUESTS && typeof retryAfterS === 'number') {
      res.setHeader('Retry-After', String(retryAfterS));
    }
    res.status(status).json({ error: { code, message, details, requestId } });
  }
}
