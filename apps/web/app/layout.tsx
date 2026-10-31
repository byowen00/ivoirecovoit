import type { Metadata, Viewport } from 'next';
import { cookies, headers } from 'next/headers';
import Link from 'next/link';
import { NotificationBell } from '@/components/NotificationBell';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'IvoireCovoit', template: '%s · IvoireCovoit' },
  description: 'Covoiturage en Côte d’Ivoire : trajets entre Abidjan, les communes et les villes de l’intérieur.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#11181c' };

const environment = process.env.NEXT_PUBLIC_ENVIRONMENT;
const isSandbox = environment !== 'production';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Simple indicateur de présence d'une session (aucun secret) pour choisir le lien du menu.
  const signedIn = (await cookies()).has('ic_signed_in');
  // La console d'administration a son propre en-tête : on n'affiche pas celui du site public.
  const inConsole = ((await headers()).get('x-pathname') ?? '').startsWith('/admin');
  return (
    <html lang="fr-CI" data-theme="light" className="overflow-x-clip">
      <body className="min-h-dvh">
        {isSandbox && (
          <div role="note" className="bg-warning-soft px-4 py-1 text-center text-xs font-medium text-ink">
            {environment === 'staging'
              ? 'Pré-production : données de test, aucun paiement réel.'
              : 'Environnement de développement : données de démonstration, aucun paiement réel.'}
          </div>
        )}
        {!inConsole && (
          <header className="bg-night text-white">
            <nav className="mx-auto flex min-h-16 max-w-5xl flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2" aria-label="Navigation principale">
              <Link href="/" className="font-display flex shrink-0 items-center gap-2 text-xl font-extrabold tracking-tight">
                {/* eslint-disable-next-line @next/next/no-img-element -- icône SVG statique */}
                <img src="/icon.svg" alt="" width={28} height={28} className="rounded-lg" />
                <span>
                  Ivoire<span className="text-accent">Covoit</span>
                </span>
              </Link>
              <div className="flex items-center gap-0.5 whitespace-nowrap sm:gap-2">
                {signedIn && (
                  <>
                    <Link href="/reservations" className="rounded-lg px-1.5 py-2 text-sm font-medium sm:px-2 text-night-muted hover:bg-white/10 hover:text-white">
                      Réservations
                    </Link>
                    <Link href="/conducteur" className="rounded-lg px-1.5 py-2 text-sm font-medium sm:px-2 text-night-muted hover:bg-white/10 hover:text-white">
                      <span className="sm:hidden">Conducteur</span>
                      <span className="hidden sm:inline">Espace conducteur</span>
                    </Link>
                  </>
                )}
                <Link href="/aide" className="rounded-lg px-1.5 py-2 text-sm font-medium sm:px-2 text-night-muted hover:bg-white/10 hover:text-white">
                  Aide
                </Link>
                <Link href="/statut" className="hidden rounded-lg px-1.5 py-2 text-sm font-medium sm:px-2 text-night-muted hover:bg-white/10 hover:text-white sm:inline">
                  État du service
                </Link>
                {signedIn && <NotificationBell />}
                {signedIn ? (
                  <Link
                    href="/compte"
                    aria-label="Mon compte (connecté)"
                    className="ml-1 inline-flex items-center gap-2 rounded-full bg-white/10 p-1 text-sm font-semibold hover:bg-white/20 sm:pr-3"
                  >
                    <span className="relative inline-flex size-8 items-center justify-center rounded-full bg-accent text-night">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                        <circle cx="12" cy="8" r="4" />
                        <path d="M4 21a8 8 0 0 1 16 0" />
                      </svg>
                      <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-night bg-online" />
                    </span>
                    <span className="hidden sm:inline">Mon compte</span>
                  </Link>
                ) : (
                  <Link href="/connexion" className="ml-1 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-night hover:bg-night-muted">
                    Se connecter
                  </Link>
                )}
              </div>
            </nav>
          </header>
        )}
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
