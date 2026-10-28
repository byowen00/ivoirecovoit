import { can, label, query, type StaffMe } from '@/lib/admin';

const staff = (permissions: string[]): StaffMe => ({ id: 's', email: 'a@b.ci', firstName: null, lastName: null, roles: [], permissions });

describe('outils de la console', () => {
  it('construit une chaîne de requête sans les valeurs vides', () => {
    expect(query({ status: 'OPEN', q: '', cursor: undefined, open: true, limit: 30 })).toBe('?status=OPEN&open=true&limit=30');
    expect(query({ a: null })).toBe('');
  });

  it('masque les actions selon les permissions (l’API reste juge)', () => {
    expect(can(null, 'refunds.approve')).toBe(false);
    expect(can(staff(['refunds.create.capped']), 'refunds.approve')).toBe(false);
    expect(can(staff(['refunds.create.capped']), 'refunds.create', 'refunds.create.capped')).toBe(true);
    expect(can(staff(['*']), 'staff.manage')).toBe(true);
  });

  it('traduit les statuts et garde les codes inconnus', () => {
    expect(label('REQUESTED')).toBe('À valider');
    expect(label('XYZ')).toBe('XYZ');
    expect(label(null)).toBe('—');
  });
});
