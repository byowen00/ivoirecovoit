'use client';

const LABELS = ['', 'Très mauvais', 'Mauvais', 'Correct', 'Bien', 'Excellent'];

/** Choix d'une note de 1 à 5, au clavier comme à la souris (groupe de boutons radio). */
export function StarRating({
  value,
  onChange,
  name = 'rating',
  legend = 'Votre note',
  small = false,
}: {
  value: number;
  onChange: (v: number) => void;
  name?: string;
  legend?: string;
  small?: boolean;
}) {
  return (
    <fieldset className="grid gap-1">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={`cursor-pointer leading-none ${small ? 'text-2xl' : 'text-3xl'}`} title={LABELS[n]}>
            <input type="radio" name={name} value={n} checked={value === n} onChange={() => onChange(n)} className="sr-only" />
            <span aria-hidden="true" className={n <= value ? 'text-accent' : 'text-line'}>
              ★
            </span>
            <span className="sr-only">
              {n} sur 5 : {LABELS[n]}
            </span>
          </label>
        ))}
      </div>
      {value > 0 && !small && <p className="text-sm text-ink-muted">{LABELS[value]}</p>}
    </fieldset>
  );
}

export function Stars({ rating }: { rating: number }) {
  return (
    <span aria-label={`${rating} sur 5`} className="text-accent">
      {'★'.repeat(Math.round(rating))}
      <span className="text-line">{'★'.repeat(5 - Math.round(rating))}</span>
    </span>
  );
}
