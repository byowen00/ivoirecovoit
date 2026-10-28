import { isCiMobile, paymentOutcome, transactionStatusLabel } from '@/lib/payments';

const booking = (status: string) => ({ status, paymentStatus: 'PROCESSING' }) as never;

describe('écran de paiement : résultat affiché', () => {
  it('attend tant que le serveur n’a pas de réponse vérifiée du prestataire', () => {
    expect(paymentOutcome({ status: 'PENDING', failureMessage: null, booking: booking('PENDING_PAYMENT') }, true)).toEqual({ kind: 'waiting' });
    expect(paymentOutcome({ status: 'CREATED', failureMessage: null, booking: booking('PENDING_PAYMENT') }, true).kind).toBe('waiting');
  });

  it('confirme seulement si la réservation est confirmée côté serveur', () => {
    expect(paymentOutcome({ status: 'SUCCEEDED', failureMessage: null, booking: booking('CONFIRMED') }, false).kind).toBe('confirmed');
    const late = paymentOutcome({ status: 'SUCCEEDED', failureMessage: null, booking: booking('EXPIRED') }, false);
    expect(late.kind).toBe('late');
    expect(late.kind === 'late' && late.text).toMatch(/remboursé intégralement/);
  });

  it('propose un nouvel essai tant que les places sont bloquées', () => {
    const r = paymentOutcome({ status: 'FAILED', failureMessage: 'Solde insuffisant.', booking: booking('PENDING_PAYMENT') }, true);
    expect(r).toMatchObject({ kind: 'failed', canRetry: true });
    expect(r.kind === 'failed' && r.text).toMatch(/Solde insuffisant\. Rien ne vous a été débité\. Vous pouvez réessayer/);
    expect(paymentOutcome({ status: 'EXPIRED', failureMessage: null, booking: booking('EXPIRED') }, false)).toMatchObject({ kind: 'failed', canRetry: false });
  });
});

describe('numéro payeur', () => {
  it('accepte les mobiles ivoiriens à 10 chiffres, avec ou sans indicatif', () => {
    for (const n of ['0707070707', '07 07 07 07 07', '+225 05 01 02 03 04', '002250102030405']) expect(isCiMobile(n)).toBe(true);
  });
  it('refuse les fixes et les formats incomplets', () => {
    for (const n of ['2721000000', '070707', '0807070707', '']) expect(isCiMobile(n)).toBe(false);
  });
});

describe('historique', () => {
  it('nomme les statuts des paiements et des remboursements', () => {
    expect(transactionStatusLabel({ kind: 'PAYMENT', status: 'SUCCEEDED' })).toBe('Réussi');
    expect(transactionStatusLabel({ kind: 'REFUND', status: 'SUCCEEDED' })).toBe('Remboursé');
    expect(transactionStatusLabel({ kind: 'REFUND', status: 'MANUAL_REQUIRED' })).toMatch(/manuel/);
  });
});
