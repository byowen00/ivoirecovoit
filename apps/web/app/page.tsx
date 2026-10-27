import { SearchForm } from '@/components/SearchForm';

// Axes mis en avant dans le cahier des charges ; l'application n'est pas limitée à ces destinations.
const POPULAR_ROUTES = [
  'Abidjan → Yamoussoukro',
  'Abidjan → Bouaké',
  'Abidjan → Daloa',
  'Abidjan → San-Pédro',
  'Abidjan → Grand-Bassam',
];

export default function HomePage() {
  return (
    <div className="grid gap-8 md:grid-cols-[1fr_1fr] md:items-start">
      <section aria-labelledby="hero-title" className="pt-2">
        <h1 id="hero-title" className="text-3xl font-bold leading-tight sm:text-4xl">
          Voyagez ensemble, partagez les frais.
        </h1>
        <p className="mt-3 text-lg text-ink-muted">
          Trouvez une place entre les communes d’Abidjan ou vers les villes de l’intérieur, avec des conducteurs vérifiés.
        </p>
        <ul className="mt-6 flex flex-wrap gap-2" aria-label="Trajets populaires">
          {POPULAR_ROUTES.map((r) => (
            <li key={r} className="rounded-full bg-brand-soft px-3 py-1 text-sm text-brand-strong">
              {r}
            </li>
          ))}
        </ul>
      </section>
      <SearchForm />
    </div>
  );
}
