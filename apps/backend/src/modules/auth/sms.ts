import { HttpStatus, Logger } from '@nestjs/common';
import { ApiError } from '../../common/api-error';

export const SMS_SENDER = Symbol('SMS_SENDER');

export interface SmsSender {
  /** Vrai si le message n'est pas réellement envoyé (mode test). */
  readonly isTestMode: boolean;
  send(phoneE164: string, text: string): Promise<void>;
}

/**
 * Mode OTP de test (développement, staging) : aucun SMS n'est envoyé, le message est écrit dans les logs.
 * La configuration refuse ce mode en production.
 */
export class TestModeSmsSender implements SmsSender {
  readonly isTestMode = true;
  private readonly logger = new Logger('SMS (mode test)');

  async send(phoneE164: string, text: string): Promise<void> {
    this.logger.warn(`[NON ENVOYÉ] ${phoneE164} : ${text}`);
  }
}

/** Aucun fournisseur SMS intégré : l'envoi échoue proprement plutôt que de faire semblant. */
export class UnavailableSmsSender implements SmsSender {
  readonly isTestMode = false;

  async send(): Promise<void> {
    throw new ApiError(
      HttpStatus.SERVICE_UNAVAILABLE,
      'PROVIDER_UNAVAILABLE',
      "L'envoi de SMS n'est pas encore disponible. Réessayez plus tard.",
    );
  }
}
