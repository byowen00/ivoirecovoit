import { refundText, statusLabel, statusTone } from '@/lib/bookings';
import { formatXof } from '@/lib/format';

describe('statut d’une réservation', () => {
  it('adapte le libellé au point de vue', () => {
    expect(statusLabel('CANCELLED_BY_PASSENGER', 'PASSENGER')).toBe('Annulée par vous');
    expect(statusLabel('CANCELLED_BY_PASSENGER', 'DRIVER')).toBe('Annulée par le passager');
    expect(statusLabel('CANCELLED_BY_DRIVER', 'DRIVER')).toBe('Annulée par vous');
    expect(statusLabel('PENDING_ACCEPTANCE', 'DRIVER')).toBe('Demande à traiter');
    expect(statusLabel('PENDING_ACCEPTANCE', 'PASSENGER')).toBe('En attente du conducteur');
  });

  it('choisit une couleur par famille de statuts', () => {
    expect(statusTone('CONFIRMED')).toBe('success');
    expect(statusTone('PENDING_PAYMENT')).toBe('warning');
    expect(statusTone('CANCELLED_BY_ADMIN')).toBe('danger');
    expect(statusTone('EXPIRED')).toBe('muted');
  });
});

describe('remboursement annoncé avant annulation', () => {
  const base = { refundXof: 0, refundPercent: null, driverCompensationXof: 0, lateDriver: false };
  it('annonce une annulation gratuite quand rien n’est payé', () => {
    expect(refundText({ ...base, basis: 'NOTHING_PAID' }, formatXof)).toMatch(/gratuite/);
  });

  it('donne le montant et le pourcentage de la politique', () => {
    const text = refundText({ ...base, basis: 'POLICY', refundXof: 2500, refundPercent: 50 }, formatXof);
    expect(text).toContain(formatXof(2500));
    expect(text).toContain('50 %');
  });

  it('dit clairement quand rien n’est remboursé', () => {
    expect(refundText({ ...base, basis: 'POLICY', refundPercent: 0 }, formatXof)).toMatch(/aucun remboursement/);
  });

  it('explique l’annulation sans frais pour retard du conducteur', () => {
    expect(refundText({ ...base, basis: 'FREE_CANCELLATION', refundXof: 5000, lateDriver: true }, formatXof)).toMatch(/retard/);
  });
});
