import { HttpException, HttpStatus } from '@nestjs/common';

/** Erreur métier au format standard de l'API : { error: { code, message, details } }. */
export class ApiError extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, status);
  }
}
