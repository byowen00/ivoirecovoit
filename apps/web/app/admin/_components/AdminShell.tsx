'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import { adminAuth, can, ROLE_LABEL, type StaffMe } from '@/lib/admin';
import { ApiRequestError } from '@/lib/api';

const StaffContext = createContext<{ me: StaffMe | null; setMe: (m: StaffMe | null) => void }>({ me: null, setMe: () => undefined });
export const useStaff = () => useContext(StaffContext).me;
export const useSetStaff = () => useContext(StaffContext).setMe;

/** Menu de la console ; chaque entrée n'apparaît qu'avec la permission correspondante (l'API vérifie de toute façon). */
const NAV: { href: string; label: string; perms: string[] }[] = [
  { href: '/admin', label: 'Tableau de bord', perms: ['stats.read'] },
  { href: '/admin/verifications', label: 'Vérifications', perms: ['verifications.read'] },
  { href: '/admin/utilisateurs', label: 'Utilisateurs', perms: ['users.read'] },
  { href: '/admin/trajets', label: 'Trajets', perms: ['trips.read'] },
  { href: '/admin/reservations', label: 'Réservations', perms: ['bookings.read'] },
  { href: '/admin/paiements', label: 'Paiements', perms: ['payments.read'] },
  { href: '/admin/finance/remboursements', label: 'Remboursements', perms: ['refunds.create', 'refunds.create.capped', 'refunds.approve', 'finance.read'] },
  { href: '/admin/finance', label: 'Commissions et versements', perms: ['finance.read'] },
  { href: '/admin/finance/rapprochement', label: 'Rapprochement', perms: ['finance.reconcile'] },
  { href: '/admin/finance/exports', label: 'Exports', perms: ['exports.create'] },
  { href: '/admin/reclamations', label: 'Réclamations', perms: ['disputes.manage'] },
  { href: '/admin/signalements', label: 'Signalements', perms: ['reports.manage'] },
  { href: '/admin/parametres', label: 'Paramètres', perms: ['settings.read'] },
  { href: '/admin/frais', label: 'Règles de frais', perms: ['settings.fees'] },
  { href: '/admin/promotions', label: 'Promotions', perms: ['promotions.manage'] },
  { href: '/admin/lieux', label: 'Lieux', perms: ['places.manage'] },
  { href: '/admin/statistiques', label: 'Statistiques', perms: ['stats.read'] },
  { href: '/admin/journal', label: 'Journal d’audit', perms: ['audit.read'] },
  { href: '/admin/personnel', label: 'Personnel', perms: ['staff.manage'] },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<StaffMe | null>(null);
  const [checked, setChecked] = useState(false);
  const isLogin = pathname === '/admin/connexion';

  useEffect(() => {
    if (isLogin || me) return;
    adminAuth.me().then(
      (m) => {
        setMe(m);
        setChecked(true);
      },
      (err: unknown) => {
        setChecked(true);
        if (err instanceof ApiRequestError && (err.status === 401 || err.status === 403)) router.replace(`/admin/connexion?next=${encodeURIComponent(pathname)}`);
      },
    );
  }, [isLogin, me, pathname, router]);

  async function logout() {
    await adminAuth.logout().catch(() => undefined);
    setMe(null);
    router.replace('/admin/connexion');
  }

  if (isLogin) return <StaffContext.Provider value={{ me, setMe }}>{children}</StaffContext.Provider>;
  if (!me) return <p className="card text-ink-muted">{checked ? 'Connexion requise…' : 'Chargement de la console…'}</p>;

  const active = (href: string) => (href === '/admin' ? pathname === '/admin' : pathname === href || (pathname.startsWith(`${href}/`) && !NAV.some((n) => n.href !== href && n.href.startsWith(href) && pathname.startsWith(n.href))));
  return (
    <StaffContext.Provider value={{ me, setMe }}>
      <div className="grid gap-4 md:grid-cols-[13rem_1fr]">
        <aside className="grid content-start gap-2">
          <div className="card grid gap-1 text-sm">
            <p className="font-semibold">Administration</p>
            <p className="text-ink-muted">
              {me.firstName} {me.lastName}
            </p>
            <p className="text-xs text-ink-muted">{me.roles.map((r) => ROLE_LABEL[r] ?? r).join(', ')}</p>
            <button type="button" className="justify-self-start text-sm font-semibold text-brand underline" onClick={() => void logout()}>
              Se déconnecter
            </button>
          </div>
          <nav aria-label="Console d’administration" className="card">
            <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm md:grid md:gap-1">
              {NAV.filter((n) => can(me, ...n.perms)).map((n) => (
                <li key={n.href}>
                  <Link href={n.href} aria-current={active(n.href) ? 'page' : undefined} className={active(n.href) ? 'font-bold text-brand' : 'text-ink-muted hover:text-ink'}>
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
        <div className="grid min-w-0 content-start gap-4">{children}</div>
      </div>
    </StaffContext.Provider>
  );
}
