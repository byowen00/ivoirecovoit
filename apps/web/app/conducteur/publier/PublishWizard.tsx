'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PlaceInput } from '@/components/PlaceInput';
import { todayInAbidjan } from '@/components/SearchForm';
import { type MapPoint, TripMap } from '@/components/TripMap';
import { formatTime } from '@/components/TripCard';
import { ApiRequestError } from '@/lib/api';
import { driver, type VehicleView } from '@/lib/driver';
import { formatDistance, formatDuration, formatXof } from '@/lib/format';
import {
  clearDraft,
  draftDepartureIso,
  draftPoints,
  emptyDraft,
  loadDraft,
  REPEAT_HORIZON_DAYS,
  repeatDates,
  repeatDaysLabel,
  saveDraft,
  stepErrors,
  type TripDraft,
} from '@/lib/trip-draft';
import { driverTrips, LUGGAGE_LABEL, type LuggagePolicy, newIdempotencyKey, priceProblemText, routeSourceNote, type TripPreview } from '@/lib/trips';

const STEPS = ['Itinéraire', 'Véhicule et places', 'Prix', 'Vérification'] as const;
const MAX_INTERMEDIATE = 5;
const message = (err: unknown) => (err instanceof ApiRequestError ? err.message : 'Une erreur est survenue. Réessayez.');

/** Écran 10 : publication d'un trajet en 4 étapes, avec brouillon conservé sur l'appareil. */
export function PublishWizard() {
  const router = useRouter();
  const [draft, setDraft] = useState<TripDraft | null>(null);
  const [restored, setRestored] = useState(false);
  const [vehicles, setVehicles] = useState<VehicleView[] | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    const saved = loadDraft();
    // Lecture du brouillon local après le premier rendu (indisponible côté serveur).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(saved ?? emptyDraft(newIdempotencyKey(), todayInAbidjan()));
    setRestored(!!saved && (saved.step > 1 || !!saved.origin));
    driver.me().then(
      (p) => {
        if (!p.canPublish) setBlocked('Votre profil conducteur et au moins un véhicule doivent être validés avant de publier.');
        driver.vehicles().then((v) => setVehicles(v.data.filter((x) => x.status === 'APPROVED' && x.isActive)), () => setVehicles([]));
      },
      (err: unknown) => {
        if (err instanceof ApiRequestError && err.status === 401) router.replace('/connexion?next=/conducteur/publier');
        else if (err instanceof ApiRequestError && err.status === 404) setBlocked('Créez d’abord votre profil conducteur.');
        else setBlocked(message(err));
      },
    );
  }, [router]);

  // Sauvegarde locale à chaque modification.
  useEffect(() => {
    if (draft) saveDraft(draft);
  }, [draft]);

  if (blocked) {
    return (
      <div className="card mx-auto grid max-w-xl gap-3">
        <h1 className="text-xl font-bold">Publier un trajet</h1>
        <p>{blocked}</p>
        <Link href="/conducteur" className="btn-primary justify-self-start">
          Aller à l’espace conducteur
        </Link>
      </div>
    );
  }
  if (!draft) return <p className="card text-ink-muted">Chargement…</p>;

  const update = (patch: Partial<TripDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  // Toute modification de l'itinéraire invalide les prix calculés.
  const updateRoute = (patch: Partial<TripDraft>) => update({ ...patch, stopPrices: [] });

  function go(step: TripDraft['step']) {
    if (step > draft!.step) {
      const e = stepErrors(draft!, draft!.step);
      setErrors(e);
      if (e.length) return;
    }
    setErrors([]);
    update({ step });
    window.scrollTo({ top: 0 });
  }

  function restart() {
    clearDraft();
    setDraft(emptyDraft(newIdempotencyKey(), todayInAbidjan()));
    setRestored(false);
    setErrors([]);
  }

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <div>
        <h1 className="text-2xl font-bold">Publier un trajet</h1>
        <ol className="mt-3 grid grid-cols-4 gap-2" aria-label="Étapes">
          {STEPS.map((label, i) => (
            <li
              key={label}
              aria-current={draft.step === i + 1 ? 'step' : undefined}
              className={`border-t-4 pt-1 text-xs sm:text-sm ${draft.step >= i + 1 ? 'border-brand font-medium' : 'border-line text-ink-muted'}`}
            >
              {i + 1}. {label}
            </li>
          ))}
        </ol>
      </div>
      {restored && (
        <p role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] bg-brand-soft px-3 py-2 text-sm">
          Brouillon retrouvé sur cet appareil.
          <button type="button" className="font-semibold text-brand underline" onClick={restart}>
            Recommencer
          </button>
        </p>
      )}

      {draft.step === 1 && <RouteStep draft={draft} update={updateRoute} />}
      {draft.step === 2 && <VehicleStep draft={draft} update={update} vehicles={vehicles} />}
      {draft.step === 3 && <PriceStep draft={draft} update={update} />}
      {draft.step === 4 && <ReviewStep draft={draft} vehicles={vehicles ?? []} onEdit={go} onDone={(id) => (clearDraft(), router.push(`/conducteur/trajets/${id}`))} />}

      {errors.length > 0 && (
        <ul role="alert" className="card list-disc pl-8 text-sm text-danger">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {draft.step < 4 && (
        <div className="flex justify-between gap-2">
          <button type="button" className="btn-secondary" disabled={draft.step === 1} onClick={() => go((draft.step - 1) as TripDraft['step'])}>
            Retour
          </button>
          <button type="button" className="btn-primary" onClick={() => go((draft.step + 1) as TripDraft['step'])}>
            Continuer
          </button>
        </div>
      )}
      <p className="text-xs text-ink-muted">Le brouillon est conservé 14 jours sur cet appareil uniquement.</p>
    </div>
  );
}

type StepProps = { draft: TripDraft; update: (p: Partial<TripDraft>) => void };

function RouteStep({ draft, update }: StepProps) {
  const setStop = (i: number, p: TripDraft['stops'][number]) => update({ stops: draft.stops.map((s, j) => (j === i ? p : s)) });
  return (
    <section className="card grid gap-3" aria-label="Itinéraire">
      <fieldset>
        <legend className="mb-1 text-sm font-medium">Type de trajet</legend>
        <div className="flex gap-4">
          {(
            [
              ['INTERCITY', 'Entre villes'],
              ['URBAN', 'Dans Abidjan ou une ville'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2">
              <input type="radio" name="kind" className="h-5 w-5" checked={draft.kind === k} onChange={() => update({ kind: k })} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <PlaceInput label="Départ" placeholder="Ville, commune, quartier ou gare" value={draft.origin} onChange={(p) => update({ origin: p })} />
      <div>
        <label htmlFor="meeting" className="mb-1 block text-sm font-medium">
          Point de rendez-vous au départ (facultatif)
        </label>
        <input
          id="meeting"
          className="field"
          maxLength={200}
          placeholder="Ex. : devant la pharmacie du carrefour"
          value={draft.meetingPoints[0] ?? ''}
          onChange={(e) => update({ meetingPoints: [e.target.value] })}
        />
      </div>
      {draft.stops.map((s, i) => (
        <div key={i} className="grid grid-cols-[1fr_auto] items-start gap-2 border-l-4 border-line pl-3">
          <PlaceInput label={`Arrêt ${i + 1}`} placeholder="Lieu de l’arrêt" value={s} onChange={(p) => setStop(i, p)} />
          <button
            type="button"
            className="btn-secondary mt-7 min-h-10 px-3 text-sm"
            onClick={() => update({ stops: draft.stops.filter((_, j) => j !== i) })}
            aria-label={`Retirer l’arrêt ${i + 1}`}
          >
            Retirer
          </button>
        </div>
      ))}
      {draft.stops.length < MAX_INTERMEDIATE && (
        <button type="button" className="btn-secondary justify-self-start text-sm" onClick={() => update({ stops: [...draft.stops, null] })}>
          + Ajouter un arrêt intermédiaire
        </button>
      )}
      <PlaceInput label="Arrivée" placeholder="Ville, commune, quartier ou gare" value={draft.destination} onChange={(p) => update({ destination: p })} />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="dep-date" className="mb-1 block text-sm font-medium">
            Date de départ
          </label>
          <input id="dep-date" type="date" min={todayInAbidjan()} className="field" value={draft.date} onChange={(e) => update({ date: e.target.value })} />
        </div>
        <div>
          <label htmlFor="dep-time" className="mb-1 block text-sm font-medium">
            Heure (Abidjan)
          </label>
          <input id="dep-time" type="time" step={300} className="field" value={draft.time} onChange={(e) => update({ time: e.target.value })} />
        </div>
      </div>
      <RepeatDays days={draft.repeatDays ?? []} onChange={(repeatDays) => update({ repeatDays })} />
    </section>
  );
}

const DAY_LETTERS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const DAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

/** Trajet régulier (domicile-travail, par exemple) : jours où le trajet est aussi publié. */
function RepeatDays({ days, onChange }: { days: number[]; onChange: (d: number[]) => void }) {
  const toggle = (d: number) => onChange(days.includes(d) ? days.filter((x) => x !== d) : [...days, d]);
  return (
    <fieldset className="grid gap-2 rounded-[var(--radius-card)] bg-surface-muted p-4">
      <legend className="sr-only">Trajet régulier</legend>
      <p className="font-display font-bold">Trajet régulier</p>
      <p className="text-sm text-ink-muted">
        Vous faites ce trajet souvent ? Cochez les jours : il sera aussi publié ces jours-là, à la même heure, pendant les deux semaines suivantes.
      </p>
      <div className="flex flex-wrap gap-2">
        {DAY_LETTERS.map((letter, i) => {
          const d = i + 1;
          const on = days.includes(d);
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              aria-label={DAY_NAMES[i]}
              onClick={() => toggle(d)}
              className={`size-10 rounded-full border-[1.5px] font-bold ${on ? 'border-brand bg-brand text-white' : 'border-line bg-surface'}`}
            >
              {letter}
            </button>
          );
        })}
      </div>
      <div className="flex gap-3 text-sm font-semibold">
        <button type="button" className="text-brand underline-offset-4 hover:underline" onClick={() => onChange([1, 2, 3, 4, 5])}>
          Du lundi au vendredi
        </button>
        {days.length > 0 && (
          <button type="button" className="text-ink-muted underline-offset-4 hover:underline" onClick={() => onChange([])}>
            Aucun
          </button>
        )}
      </div>
    </fieldset>
  );
}

function VehicleStep({ draft, update, vehicles }: StepProps & { vehicles: VehicleView[] | null }) {
  const vehicle = vehicles?.find((v) => v.id === draft.vehicleId);
  // Un seul véhicule validé : il est choisi d'office.
  useEffect(() => {
    if (vehicles?.length === 1 && !draft.vehicleId) update({ vehicleId: vehicles[0]!.id, seats: Math.min(draft.seats, vehicles[0]!.seatsCapacity) });
  }, [vehicles, draft.vehicleId, draft.seats, update]);
  if (!vehicles) return <p className="card text-ink-muted">Chargement de vos véhicules…</p>;
  return (
    <section className="card grid gap-3" aria-label="Véhicule et places">
      <div>
        <label htmlFor="vehicle" className="mb-1 block text-sm font-medium">
          Véhicule
        </label>
        <select
          id="vehicle"
          className="field"
          value={draft.vehicleId}
          onChange={(e) => {
            const v = vehicles.find((x) => x.id === e.target.value);
            update({ vehicleId: e.target.value, seats: v ? Math.min(draft.seats, v.seatsCapacity) : draft.seats });
          }}
        >
          <option value="">Choisir…</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.make} {v.model} · {v.plateNumber}
            </option>
          ))}
        </select>
        {vehicles.length === 0 && <p className="mt-1 text-sm text-danger">Aucun véhicule validé.</p>}
      </div>
      <div>
        <label htmlFor="seats" className="mb-1 block text-sm font-medium">
          Places proposées
        </label>
        <select id="seats" className="field" value={draft.seats} onChange={(e) => update({ seats: Number(e.target.value) })}>
          {Array.from({ length: vehicle?.seatsCapacity ?? 8 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium">Réservations</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="acc" className="h-5 w-5" checked={draft.acceptanceMode === 'AUTO'} onChange={() => update({ acceptanceMode: 'AUTO' })} />
          Acceptées automatiquement
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="acc" className="h-5 w-5" checked={draft.acceptanceMode === 'MANUAL'} onChange={() => update({ acceptanceMode: 'MANUAL' })} />
          J’accepte chaque demande moi-même
        </label>
      </fieldset>
      <div>
        <label htmlFor="luggage" className="mb-1 block text-sm font-medium">
          Bagages acceptés
        </label>
        <select id="luggage" className="field" value={draft.luggagePolicy} onChange={(e) => update({ luggagePolicy: e.target.value as LuggagePolicy })}>
          {Object.entries(LUGGAGE_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-3">
        <input type="checkbox" className="h-5 w-5" checked={draft.allowsCash} onChange={(e) => update({ allowsCash: e.target.checked })} />
        J’accepte aussi le paiement en espèces
      </label>
      <div>
        <label htmlFor="desc" className="mb-1 block text-sm font-medium">
          Description (facultatif)
        </label>
        <textarea id="desc" rows={3} maxLength={1000} className="field h-auto py-2" value={draft.description} onChange={(e) => update({ description: e.target.value })} />
      </div>
      <div>
        <label htmlFor="instr" className="mb-1 block text-sm font-medium">
          Consignes aux passagers (facultatif)
        </label>
        <textarea id="instr" rows={2} maxLength={500} className="field h-auto py-2" value={draft.instructions} onChange={(e) => update({ instructions: e.target.value })} />
      </div>
    </section>
  );
}

function PriceStep({ draft, update }: StepProps) {
  const [preview, setPreview] = useState<TripPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fullInput, setFullInput] = useState(draft.stopPrices.at(-1)?.toString() ?? '');
  const seq = useRef(0);
  const points = draftPoints(draft);
  const labels = points.map((p) => p.label);

  async function run(price: { pricePerSeatXof?: number; stopPricesXof?: number[] }, adopt: boolean) {
    const n = ++seq.current;
    try {
      const res = await driverTrips.preview({
        kind: draft.kind,
        departureAt: draftDepartureIso(draft),
        stops: points.map((p) => ({ placeId: p.id, label: p.label })),
        ...(draft.vehicleId ? { vehicleId: draft.vehicleId } : {}),
        ...price,
      });
      if (n !== seq.current) return; // réponse dépassée par une saisie plus récente
      setError(null);
      setPreview(res);
      if (adopt) {
        const prices = res.stops.map((s) => s.priceFromOriginXof);
        update({ stopPrices: prices });
        setFullInput(String(prices.at(-1)));
      }
    } catch (err) {
      if (n === seq.current) setError(message(err));
    }
  }

  // Premier calcul : prix suggéré, ou vérification des prix du brouillon.
  useEffect(() => {
    // Appel réseau : l'état n'est mis à jour qu'à la réponse.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run(draft.stopPrices.length === points.length ? { stopPricesXof: draft.stopPrices } : {}, draft.stopPrices.length !== points.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounce = (fn: () => void) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(fn, 400);
  };

  const mapPoints = useMemo<MapPoint[]>(
    () =>
      (preview?.stops ?? []).map((s, i, all) => ({ lat: s.lat, lng: s.lng, label: s.label, tone: i === 0 ? 'origin' : i === all.length - 1 ? 'destination' : 'stop' })),
    [preview],
  );

  if (!preview) return error ? <p role="alert" className="card text-danger">{error}</p> : <p className="card text-ink-muted">Calcul de l’itinéraire…</p>;

  return (
    <section className="grid gap-3" aria-label="Prix">
      <TripMap points={mapPoints} route={preview.geometry} label="Aperçu de l’itinéraire estimé" className="h-60" />
      <p className="text-sm text-ink-muted">
        {formatDistance(preview.estimatedDistanceM)}, {formatDuration(preview.estimatedDurationS)} · arrivée estimée vers{' '}
        {formatTime(preview.estimatedArrivalAt)}. {routeSourceNote(preview.routeSource)}
      </p>
      <div className="card grid gap-3">
        <p>
          Prix suggéré : <strong>{formatXof(preview.price.suggestedPriceXof)}</strong> par place pour le trajet complet. Fourchette autorisée :{' '}
          {formatXof(preview.price.minXof)} à {formatXof(preview.price.maxXof)}.
        </p>
        <div>
          <label htmlFor="full" className="mb-1 block text-sm font-medium">
            Prix par place, trajet complet (FCFA)
          </label>
          <input
            id="full"
            inputMode="numeric"
            className="field"
            value={fullInput}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 6);
              setFullInput(v);
              if (v) debounce(() => void run({ pricePerSeatXof: Number(v) }, true));
            }}
          />
          <p className="mt-1 text-xs text-ink-muted">Multiple de 50 FCFA. Les prix des arrêts sont répartis selon la distance ; vous pouvez les ajuster.</p>
        </div>
        {points.length > 2 && (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Prix depuis le départ, par arrêt</legend>
            {points.slice(1, -1).map((p, k) => {
              const i = k + 1;
              return (
                <div key={p.id} className="grid grid-cols-[1fr_9rem] items-center gap-2">
                  <label htmlFor={`price-${i}`}>{p.label}</label>
                  <input
                    id={`price-${i}`}
                    inputMode="numeric"
                    className="field"
                    value={draft.stopPrices[i] ?? ''}
                    onChange={(e) => {
                      const prices = [...draft.stopPrices];
                      prices[i] = Number(e.target.value.replace(/\D/g, '').slice(0, 6));
                      update({ stopPrices: prices });
                      debounce(() => void run({ stopPricesXof: prices }, false));
                    }}
                  />
                </div>
              );
            })}
          </fieldset>
        )}
        {preview.price.problems.length > 0 && (
          <ul role="alert" className="list-disc pl-5 text-sm text-danger">
            {preview.price.problems.map((p, i) => (
              <li key={i}>{priceProblemText(p, labels, preview.price)}</li>
            ))}
          </ul>
        )}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    </section>
  );
}

function ReviewStep({
  draft,
  vehicles,
  onEdit,
  onDone,
}: {
  draft: TripDraft;
  vehicles: VehicleView[];
  onEdit: (step: TripDraft['step']) => void;
  onDone: (id: string) => void;
}) {
  const [busy, setBusy] = useState<'publish' | 'draft' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const points = draftPoints(draft);
  const vehicle = vehicles.find((v) => v.id === draft.vehicleId);
  const problems = stepErrors(draft, 3);

  async function create(publish: boolean) {
    setBusy(publish ? 'publish' : 'draft');
    setError(null);
    try {
      const trip = await driverTrips.create(
        {
          vehicleId: draft.vehicleId,
          kind: draft.kind,
          departureAt: draftDepartureIso(draft),
          stops: points.map((p, i) => ({ placeId: p.id, label: p.label, ...(draft.meetingPoints[i] ? { meetingPoint: draft.meetingPoints[i] } : {}) })),
          pricePerSeatXof: draft.stopPrices.at(-1)!,
          stopPricesXof: draft.stopPrices,
          seatsOffered: draft.seats,
          acceptanceMode: draft.acceptanceMode,
          allowsCash: draft.allowsCash,
          luggagePolicy: draft.luggagePolicy,
          ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
          ...(draft.instructions.trim() ? { instructions: draft.instructions.trim() } : {}),
          publish,
        },
        // Clé distincte pour un brouillon, pour pouvoir ensuite publier depuis le même assistant.
        publish ? draft.idempotencyKey : `${draft.idempotencyKey.slice(0, 30)}-draft`,
      );
      const dates = publish ? repeatDates(draft.date, draft.repeatDays ?? []) : [];
      if (dates.length) {
        // Trajet régulier : un refus sur une date (chevauchement…) n'annule pas les autres ni le premier trajet.
        try {
          const res = await driverTrips.duplicate(trip.id, dates, true, `${draft.idempotencyKey.slice(0, 30)}-rep`);
          const refused = res.data.filter((r) => !r.tripId).length;
          if (refused) window.alert(`Trajet publié. ${res.data.length - refused} répétition(s) publiée(s), ${refused} refusée(s) (conflit d’horaire).`);
        } catch (err) {
          window.alert(`Le premier trajet est publié, mais pas les répétitions : ${message(err)}`);
        }
      }
      onDone(trip.id);
    } catch (err) {
      setError(message(err));
      setBusy(null);
    }
  }


  return (
    <section className="card grid gap-1" aria-label="Vérification">
      <Row onEdit={onEdit} label="Itinéraire" step={1}>
        <ol>
          {points.map((p, i) => (
            <li key={p.id}>
              {p.label}
              {i > 0 && draft.stopPrices[i] !== undefined && <span className="text-sm text-ink-muted"> · {formatXof(draft.stopPrices[i]!)}</span>}
            </li>
          ))}
        </ol>
      </Row>
      <Row onEdit={onEdit} label="Départ" step={1}>
        {draft.date.split('-').reverse().join('/')} à {draft.time}
      </Row>
      {(draft.repeatDays ?? []).length > 0 && (
        <Row onEdit={onEdit} label="Trajet régulier" step={1}>
          {repeatDaysLabel(draft.repeatDays!)}, {repeatDates(draft.date, draft.repeatDays!).length} autre(s) départ(s) sur les {REPEAT_HORIZON_DAYS} jours suivants
        </Row>
      )}
      <Row onEdit={onEdit} label="Véhicule et places" step={2}>
        {vehicle ? `${vehicle.make} ${vehicle.model}` : '—'} · {draft.seats} place{draft.seats > 1 ? 's' : ''} ·{' '}
        {draft.acceptanceMode === 'AUTO' ? 'acceptation automatique' : 'acceptation manuelle'} · {LUGGAGE_LABEL[draft.luggagePolicy]}
        {draft.allowsCash && ' · espèces acceptées'}
      </Row>
      <Row onEdit={onEdit} label="Prix par place (trajet complet)" step={3}>
        <strong>{draft.stopPrices.length ? formatXof(draft.stopPrices.at(-1)!) : '—'}</strong>
      </Row>
      {problems.length > 0 && <p className="text-sm text-danger">{problems.join(' ')}</p>}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-primary" disabled={!!busy || problems.length > 0} onClick={() => void create(true)}>
          {busy === 'publish' ? 'Publication…' : 'Publier le trajet'}
        </button>
        <button type="button" className="btn-secondary" disabled={!!busy || problems.length > 0} onClick={() => void create(false)}>
          {busy === 'draft' ? 'Enregistrement…' : 'Enregistrer comme brouillon'}
        </button>
      </div>
    </section>
  );
}

function Row({ label, step, onEdit, children }: { label: string; step: TripDraft['step']; onEdit: (s: TripDraft['step']) => void; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line py-2 last:border-0">
      <div>
        <p className="text-sm text-ink-muted">{label}</p>
        <div>{children}</div>
      </div>
      <button type="button" className="text-sm font-semibold text-brand underline-offset-4 hover:underline" onClick={() => onEdit(step)}>
        Modifier
      </button>
    </div>
  );
}
