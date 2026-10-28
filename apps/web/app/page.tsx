import { cookies } from 'next/headers';
import Link from 'next/link';
import { PopularRoutes } from '@/components/PopularRoutes';
import { SearchForm } from '@/components/SearchForm';

/** Écran 4 : accueil et recherche. */
export default async function HomePage() {
  const signedIn = (await cookies()).has('ic_signed_in');
  return (
    <div className="grid gap-8">
      <div className="grid gap-8 md:grid-cols-[1fr_1fr] md:items-start">
        <section aria-labelledby="hero-title" className="pt-2">
          <h1 id="hero-title" className="text-3xl font-bold leading-tight sm:text-4xl">
            Voyagez ensemble, partagez les frais.
          </h1>
          <p className="mt-3 text-lg text-ink-muted">
            Trouvez une place entre les communes d’Abidjan ou vers les villes de l’intérieur, avec des conducteurs vérifiés.
          </p>
          <h2 className="mt-6 text-sm font-semibold text-ink-muted">Trajets populaires</h2>
          <PopularRoutes />
        </section>
        <SearchForm />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section aria-labelledby="bookings-title" className="card">
          <h2 id="bookings-title" className="text-lg font-semibold">
            Mes prochains trajets
          </h2>
          <p className="mt-2 text-ink-muted">
            {signedIn
              ? 'Aucune réservation à venir. La réservation de places arrive à la prochaine étape du développement.'
              : 'Connectez-vous pour retrouver vos réservations ici.'}
          </p>
        </section>
        <section aria-labelledby="drive-title" className="card">
          <h2 id="drive-title" className="text-lg font-semibold">
            Vous conduisez ?
          </h2>
          <p className="mt-2 text-ink-muted">Proposez vos places libres et partagez les frais de route. Profil et véhicule vérifiés avant publication.</p>
          <Link href={signedIn ? '/conducteur/publier' : '/connexion?next=/conducteur/publier'} className="btn-secondary mt-3">
            Proposer un trajet
          </Link>
        </section>
      </div>
    </div>
  );
}
