import { cookies } from 'next/headers';
import Link from 'next/link';
import { PopularRoutes } from '@/components/PopularRoutes';
import { SearchForm } from '@/components/SearchForm';

/** Écran 4 : accueil et recherche. */
export default async function HomePage() {
  const signedIn = (await cookies()).has('ic_signed_in');
  return (
    <div className="grid gap-8">
      <section aria-labelledby="hero-title" className="-mt-6 mx-[calc(50%-50vw)] bg-night pb-24 text-white">
        <div className="mx-auto max-w-5xl px-4 pt-10 sm:pt-14">
          <h1 id="hero-title" className="max-w-2xl text-4xl leading-[1.05] font-extrabold sm:text-5xl">
            Voyagez ensemble, partagez les frais.
          </h1>
          <p className="mt-4 max-w-xl text-lg text-night-muted">
            Trouvez une place entre les communes d’Abidjan ou vers les villes de l’intérieur, avec des conducteurs vérifiés.
          </p>
        </div>
      </section>
      <div className="relative z-10 -mt-28 grid gap-6 md:grid-cols-[1.2fr_1fr] md:items-start">
        <SearchForm />
        <section aria-labelledby="popular-title" className="card md:mt-0">
          <h2 id="popular-title" className="text-lg font-bold">
            Trajets populaires
          </h2>
          <PopularRoutes />
        </section>
      </div>

      <section aria-label="Pourquoi IvoireCovoit" className="grid gap-4 sm:grid-cols-3">
        <div className="card grid gap-2">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-success" aria-hidden="true">
            <path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
          <h2 className="text-base font-bold">Conducteurs vérifiés</h2>
          <p className="text-sm text-ink-muted">Pièce d’identité et permis contrôlés avant le premier trajet, avis après chaque voyage.</p>
        </div>
        <div className="card grid gap-2">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-brand" aria-hidden="true">
            <rect x="6" y="2" width="12" height="20" rx="3" />
            <path d="M11 18h2" />
          </svg>
          <h2 className="text-base font-bold">Paiement Mobile Money</h2>
          <p className="text-sm text-ink-muted">Vous validez sur votre téléphone. IvoireCovoit ne vous demande jamais votre code secret.</p>
        </div>
        <div className="card grid gap-2">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="9" cy="8" r="3.5" />
            <circle cx="17" cy="9" r="2.5" />
            <path d="M3 20a6 6 0 0 1 12 0M15 20a4 4 0 0 1 6-3.5" />
          </svg>
          <h2 className="text-base font-bold">Moins cher, plus convivial</h2>
          <p className="text-sm text-ink-muted">Le conducteur partage ses frais de route, vous voyagez sans attendre que le car se remplisse.</p>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section aria-labelledby="bookings-title" className="card">
          <h2 id="bookings-title" className="text-lg font-semibold">
            Mes prochains trajets
          </h2>
          <p className="mt-2 text-ink-muted">
            {signedIn ? (
              <>
                <Link href="/reservations" className="font-semibold text-brand">
                  Mes réservations
                </Link>{' '}
                ·{' '}
                <Link href="/paiements" className="font-semibold text-brand">
                  Historique des paiements
                </Link>
              </>
            ) : (
              'Connectez-vous pour retrouver vos réservations ici.'
            )}
          </p>
        </section>
        <section aria-labelledby="drive-title" className="card bg-night text-white">
          <h2 id="drive-title" className="text-lg font-semibold">
            Vous conduisez ?
          </h2>
          <p className="mt-2 text-night-muted">Proposez vos places libres et partagez les frais de route. Profil et véhicule vérifiés avant publication.</p>
          <Link href={signedIn ? '/conducteur/publier' : '/connexion?next=/conducteur/publier'} className="btn-primary mt-3">
            Proposer un trajet
          </Link>
        </section>
      </div>
    </div>
  );
}
