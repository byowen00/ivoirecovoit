import { HttpStatus } from '@nestjs/common';
import { ApiError } from '../../common/api-error';
import type { MobileMoneyMethod, NormalizedPaymentEvent, PaymentProvider, ProviderStatus, WebhookVerification } from './provider';

const notIntegrated = () =>
  new ApiError(
    HttpStatus.SERVICE_UNAVAILABLE,
    'PAYMENT_PROVIDER_NOT_INTEGRATED',
    'Le paiement mobile n’est pas encore disponible : aucun prestataire de paiement n’est intégré.',
  );

/**
 * SQUELETTE d'adaptateur pour un agrégateur de Mobile Money (CinetPay, PayDunya, Hub2…), à compléter une fois
 * le prestataire choisi, le contrat signé et sa documentation obtenue. Il ne fait rien et ne prétend rien :
 * chaque appel répond « non intégré », et la configuration refuse PAYMENT_PROVIDER=aggregator au démarrage.
 *
 * À implémenter avec la documentation du prestataire :
 * - initiatePayment : création de la transaction (référence marchand = payments.id, montant entier en XOF,
 *   numéro payeur E.164, URL de notification), conversion de la réponse en NextAction ;
 * - getPaymentStatus / findByMerchantReference : interrogation de statut côté serveur ;
 * - verifyWebhook : vérification de signature et d'horodatage selon le schéma du prestataire ;
 * - parseWebhook : conversion vers NormalizedPaymentEvent (statuts finaux du prestataire uniquement) ;
 * - refund (si l'API existe ; sinon remboursement manuel par l'équipe finance) ;
 * - listTransactions pour le rapprochement quotidien.
 */
export class AggregatorPaymentProvider implements PaymentProvider {
  readonly code = 'aggregator';
  readonly isSandbox = false;

  async supportedMethods(): Promise<MobileMoneyMethod[]> {
    return [];
  }
  async initiatePayment(): Promise<never> {
    throw notIntegrated();
  }
  async getPaymentStatus(): Promise<ProviderStatus> {
    throw notIntegrated();
  }
  verifyWebhook(): WebhookVerification {
    return { valid: false, reason: 'MISSING_SIGNATURE' };
  }
  parseWebhook(): NormalizedPaymentEvent {
    throw notIntegrated();
  }
}
