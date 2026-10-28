import { Controller, Get, HttpStatus, Inject, Param, Post, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiError } from '../../common/api-error';
import { ENV, type Env } from '../../config/env';
import { DB, type Db } from '../../database/database.module';
import { Public } from '../auth/decorators';
import { PaymentsService } from './payments.service';
import { METHOD_LABEL, type MobileMoneyMethod, PAYMENT_PROVIDER, type PaymentProvider } from './provider';
import { SandboxPaymentProvider } from './sandbox.provider';

const ACTIONS = ['valider', 'refuser', 'annuler', 'expirer', 'doublon', 'desordre', 'valider-sans-webhook'] as const;
type Action = (typeof ACTIONS)[number];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'En attente de validation',
  SUCCEEDED: 'Validé',
  FAILED: 'Refusé',
  EXPIRED: 'Expiré',
  CANCELLED: 'Annulé par le payeur',
};
const MESSAGE: Record<string, string> = {
  valider: 'Paiement validé ; webhook signé envoyé au serveur.',
  refuser: 'Paiement refusé ; webhook envoyé.',
  annuler: 'Paiement annulé par le payeur ; webhook envoyé.',
  expirer: 'Paiement expiré ; webhook envoyé.',
  doublon: 'Paiement validé ; le même webhook a été envoyé deux fois.',
  desordre: 'Paiement validé ; un ancien événement « en attente » a été envoyé après le succès.',
  'valider-sans-webhook': 'Paiement validé chez le « prestataire » sans webhook : le serveur l’apprendra en interrogeant le bac à sable.',
  done: 'Cette opération est déjà terminée.',
};

/**
 * Page de paiement simulée du bac à sable (remplace l'écran de l'opérateur Mobile Money). N'existe que si le
 * prestataire configuré est le bac à sable, jamais en production. Aucun argent réel, aucun code secret demandé.
 */
@ApiExcludeController()
@Controller('sandbox/pay')
export class SandboxController {
  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Db,
    private readonly payments: PaymentsService,
  ) {}

  private sandbox(): SandboxPaymentProvider {
    if (!(this.provider instanceof SandboxPaymentProvider) || this.env.NODE_ENV === 'production') {
      throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Ressource introuvable.');
    }
    return this.provider;
  }

  @Public()
  @Get(':ref')
  async page(@Param('ref') ref: string, @Query('m') m: string | undefined, @Res() res: Response) {
    const sbx = this.sandbox();
    const t = await sbx.transaction(ref);
    if (!t || t.kind !== 'PAYMENT') throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Paiement simulé introuvable.');
    const payment = await this.db.selectFrom('payments').select(['booking_id']).where('id', '=', t.merchant_reference).executeTakeFirst();
    const back = payment ? `${this.env.WEB_BASE_URL}/reservations/${payment.booking_id}/payer?paiement=${t.merchant_reference}` : null;
    const pending = t.status === 'PENDING';
    const button = (action: Action, label: string, cls = '') =>
      `<form method="post" action="${esc(ref)}/${action}"><button class="${cls}" type="submit">${esc(label)}</button></form>`;
    const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Paiement simulé – bac à sable IvoireCovoit</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;background:#f6f7f9;color:#1b1f24}
main{max-width:28rem;margin:0 auto;padding:1rem}
.banner{background:#fff4d6;border:1px solid #e0b443;border-radius:.5rem;padding:.75rem;font-weight:600}
.card{background:#fff;border:1px solid #d8dde3;border-radius:.5rem;padding:1rem;margin-top:1rem}
dl{display:grid;grid-template-columns:auto 1fr;gap:.25rem .75rem;margin:0}dt{color:#5b6570}dd{margin:0;font-weight:600}
form{margin:.5rem 0 0}button{width:100%;min-height:2.75rem;font-size:1rem;border-radius:.5rem;border:1px solid #9aa4ae;background:#fff;cursor:pointer}
button.ok{background:#0b7a3e;color:#fff;border-color:#0b7a3e}button.ko{background:#b42318;color:#fff;border-color:#b42318}
.msg{background:#e7f1ff;border-radius:.5rem;padding:.75rem;margin-top:1rem}details{margin-top:1rem}a{color:#0b5bd3}
</style></head><body><main>
<p class="banner">BAC À SABLE : aucun argent réel n’est débité. Cette page remplace la validation chez l’opérateur Mobile Money.</p>
${m && MESSAGE[m] ? `<p class="msg" role="status">${esc(MESSAGE[m])}</p>` : ''}
<section class="card"><dl>
<dt>Montant</dt><dd>${Number(t.amount_xof).toLocaleString('fr-FR').replace(/\s/g, ' ')} FCFA</dd>
<dt>Moyen</dt><dd>${esc(t.method ? METHOD_LABEL[t.method as MobileMoneyMethod] ?? t.method : '')}</dd>
<dt>Numéro</dt><dd>${esc(t.payer_phone_masked ?? '')}</dd>
<dt>Référence</dt><dd>${esc(t.provider_reference)}</dd>
<dt>Statut</dt><dd>${esc(STATUS_LABEL[t.status] ?? t.status)}</dd>
</dl></section>
${
  pending
    ? `<section class="card"><p>Que doit répondre l’opérateur ?</p>
${button('valider', 'Valider le paiement', 'ok')}
${button('refuser', 'Refuser (solde insuffisant)', 'ko')}
${button('annuler', 'Annuler depuis le téléphone')}
${button('expirer', 'Laisser expirer')}
<details><summary>Cas de test</summary>
${button('doublon', 'Valider et envoyer le webhook deux fois')}
${button('desordre', 'Valider puis envoyer un ancien « en attente »')}
${button('valider-sans-webhook', 'Valider sans envoyer de webhook')}
</details></section>`
    : ''
}
${back ? `<p><a href="${esc(back)}">Revenir à IvoireCovoit</a></p>` : ''}
</main></body></html>`;
    res.status(200).type('html').send(html);
  }

  @Public()
  @Post(':ref/:action')
  async act(@Param('ref') ref: string, @Param('action') action: string, @Res() res: Response) {
    const sbx = this.sandbox();
    if (!(ACTIONS as readonly string[]).includes(action)) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Action inconnue.');
    const a = action as Action;
    const target = a === 'refuser' ? 'FAILED' : a === 'annuler' ? 'CANCELLED' : a === 'expirer' ? 'EXPIRED' : 'SUCCEEDED';
    const before = await sbx.transaction(ref);
    if (!before || before.kind !== 'PAYMENT') throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Paiement simulé introuvable.');
    const settled = await sbx.settle(ref, target);
    if (!settled) return res.redirect(303, `../${encodeURIComponent(ref)}?m=done`);
    if (a !== 'valider-sans-webhook') {
      const failureCode = a === 'refuser' ? 'INSUFFICIENT_FUNDS' : undefined;
      const hook = sbx.buildWebhook({ ...settled, failureCode });
      await this.payments.receiveWebhook(sbx.code, hook.rawBody, hook.headers);
      if (a === 'doublon') await this.payments.receiveWebhook(sbx.code, hook.rawBody, hook.headers);
      if (a === 'desordre') {
        const stale = sbx.buildWebhook({ ...settled, status: 'PENDING' }, { occurredAt: before.created_at });
        await this.payments.receiveWebhook(sbx.code, stale.rawBody, stale.headers);
      }
    }
    return res.redirect(303, `../${encodeURIComponent(ref)}?m=${a}`);
  }
}
