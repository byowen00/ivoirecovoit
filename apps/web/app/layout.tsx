import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'IvoireCovoit', template: '%s · IvoireCovoit' },
  description: 'Covoiturage en Côte d’Ivoire : trajets entre Abidjan, les communes et les villes de l’intérieur.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#b85400' };

const isSandbox = process.env.NEXT_PUBLIC_ENVIRONMENT !== 'production';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Simple indicateur de présence d'une session (aucun secret) pour choisir le lien du menu.
  const signedIn = (await cookies()).has('ic_signed_in');
  return (
    <html lang="fr-CI" data-theme="light">
      <body className="min-h-dvh">
        {isSandbox && (
          <div role="note" className="bg-warning-soft px-4 py-1 text-center text-xs font-medium text-ink">
            Environnement de développement : données de démonstration, aucun paiement réel.
          </div>
        )}
        <header className="border-b border-line bg-surface">
          <nav className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4" aria-label="Navigation principale">
            <Link href="/" className="text-lg font-bold text-brand">
              IvoireCovoit
            </Link>
            <div className="flex items-center gap-4">
              <Link href="/statut" className="text-sm text-ink-muted underline-offset-4 hover:underline">
                État du service
              </Link>
              <Link href={signedIn ? '/compte' : '/connexion'} className="text-sm font-semibold text-brand underline-offset-4 hover:underline">
                {signedIn ? 'Mon compte' : 'Se connecter'}
              </Link>
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
