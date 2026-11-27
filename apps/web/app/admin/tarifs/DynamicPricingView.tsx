'use client';

import { useState } from 'react';
import { adminCall, can } from '@/lib/admin';
import { useStaff } from '../_components/AdminShell';
import { Loading, Notice, PageTitle, ReasonAction, Section, useAdmin } from '../_components/ui';

interface Toggle { enabled: boolean; percent: number }
interface Rules {
  enabled: boolean;
  maxTotalPercent: number;
  appliesTo: 'ALL' | 'URBAN' | 'INTERCITY';
  rain: Toggle & { minMm: number };
  heavyRain: Toggle & { minMm: number };
  peakHours: Toggle & { windows: { days: number[]; from: string; to: string }[] };
  trafficAlert: Toggle & { until: string | null; note: string };
  night: Toggle & { from: string; to: string };
  holidays: Toggle & { dates: string[] };
  weekend: Toggle;
}
type FactorKey = 'rain' | 'heavyRain' | 'peakHours' | 'trafficAlert' | 'night' | 'holidays' | 'weekend';

const DAYS = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
const FACTORS: { key: FactorKey; label: string; hint: string }[] = [
  { key: 'rain', label: 'Pluie', hint: 'Prévision de pluie au lieu et à l’heure du départ.' },
  { key: 'heavyRain', label: 'Fortes pluies', hint: 'Remplace « Pluie » quand le seuil est atteint.' },
  { key: 'peakHours', label: 'Heures de pointe', hint: 'Embouteillages habituels, selon les horaires ci-dessous.' },
  { key: 'trafficAlert', label: 'Embouteillages signalés', hint: 'Accident, travaux, manifestation : activé par l’équipe jusqu’à une date.' },
  { key: 'night', label: 'Nuit', hint: 'Départ dans la plage horaire de nuit.' },
  { key: 'holidays', label: 'Jours fériés et événements', hint: 'Dates choisies par l’équipe.' },
  { key: 'weekend', label: 'Week-end', hint: 'Samedi et dimanche.' },
];

/** Réglage du tarif dynamique : il ajuste le prix SUGGÉRÉ au conducteur, qui reste libre de son prix. */
export function DynamicPricingView() {
  const me = useStaff();
  const list = useAdmin(() => adminCall<{ data: { key: string; value: unknown; version: number }[] }>('settings'), []);
  const [edit, setEdit] = useState<Rules | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  if (!list.data) return <Loading error={list.error} />;
  const stored = list.data.data.find((s) => s.key === 'pricing.dynamic');
  if (!stored) return <Loading error="Paramètre « pricing.dynamic » absent : mettez l’API à jour." />;
  const r: Rules = edit ?? (stored.value as Rules);
  const set = (next: Partial<Rules>) => setEdit({ ...r, ...next });
  const setFactor = <K extends FactorKey>(k: K, v: Partial<Rules[K]>) => setEdit({ ...r, [k]: { ...r[k], ...v } });
  const writer = can(me, 'settings.write');
  const num = (v: string) => (v.trim() === '' || Number.isNaN(Number(v)) ? 0 : Math.round(Number(v)));

  return (
    <>
      <PageTitle title="Tarif dynamique" />
      <p className="text-sm text-ink-muted">
        Le tarif dynamique ajuste le <strong>prix suggéré</strong> au conducteur quand il publie : il reste libre de son prix dans la fourchette autorisée. La
        météo vient de prévisions (jamais inventées : sans prévision, elle n’est pas comptée). Les embouteillages suivent les heures de pointe réglées ici et
        les signalements de l’équipe, faute de données de trafic en temps réel. Pourcentages de démonstration, à valider commercialement.
      </p>
      <Notice ok={ok} />
      <Section title="Général">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={r.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            <span className="font-medium">Tarif dynamique activé</span>
          </label>
          <label className="grid gap-1 text-sm">
            <span>Hausse cumulée maximale (%)</span>
            <input className="field" inputMode="numeric" value={r.maxTotalPercent} onChange={(e) => set({ maxTotalPercent: num(e.target.value) })} />
          </label>
          <label className="grid gap-1 text-sm">
            <span>S’applique aux trajets</span>
            <select className="field" value={r.appliesTo} onChange={(e) => set({ appliesTo: e.target.value as Rules['appliesTo'] })}>
              <option value="ALL">En ville et interurbains</option>
              <option value="URBAN">En ville seulement</option>
              <option value="INTERCITY">Interurbains seulement</option>
            </select>
          </label>
        </div>
      </Section>
      <Section title="Facteurs">
        <ul className="grid gap-4">
          {FACTORS.map((f) => {
            const v = r[f.key];
            return (
              <li key={f.key} className="grid gap-2 border-b border-line pb-3 last:border-b-0">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={v.enabled} onChange={(e) => setFactor(f.key, { enabled: e.target.checked })} />
                    <span className="font-medium">{f.label}</span>
                  </label>
                  <label className="flex items-center gap-1 text-sm">
                    <input className="field w-20" inputMode="numeric" aria-label={`${f.label} : pourcentage`} value={v.percent} onChange={(e) => setFactor(f.key, { percent: num(e.target.value) })} />
                    <span>%</span>
                  </label>
                </div>
                <p className="text-sm text-ink-muted">{f.hint}</p>
                {(f.key === 'rain' || f.key === 'heavyRain') && (
                  <label className="flex items-center gap-2 text-sm">
                    <span>À partir de</span>
                    <input className="field w-20" inputMode="decimal" value={r[f.key].minMm} onChange={(e) => setFactor(f.key, { minMm: Number(e.target.value.replace(',', '.')) || 0 })} />
                    <span>mm de pluie dans l’heure</span>
                  </label>
                )}
                {f.key === 'night' && (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span>De</span>
                    <input type="time" className="field w-28" value={r.night.from} onChange={(e) => setFactor('night', { from: e.target.value })} />
                    <span>à</span>
                    <input type="time" className="field w-28" value={r.night.to} onChange={(e) => setFactor('night', { to: e.target.value })} />
                  </div>
                )}
                {f.key === 'peakHours' && (
                  <div className="grid gap-2 text-sm">
                    {r.peakHours.windows.map((w, i) => {
                      const upd = (nw: Partial<typeof w>) => setFactor('peakHours', { windows: r.peakHours.windows.map((x, j) => (j === i ? { ...x, ...nw } : x)) });
                      return (
                        <div key={i} className="flex flex-wrap items-center gap-2">
                          {DAYS.map((d, k) => (
                            <label key={d} className="flex items-center gap-1">
                              <input
                                type="checkbox"
                                checked={w.days.includes(k + 1)}
                                onChange={(e) => upd({ days: e.target.checked ? [...w.days, k + 1].sort() : w.days.filter((x) => x !== k + 1) })}
                              />
                              {d}
                            </label>
                          ))}
                          <input type="time" className="field w-28" value={w.from} onChange={(e) => upd({ from: e.target.value })} aria-label="Début" />
                          <input type="time" className="field w-28" value={w.to} onChange={(e) => upd({ to: e.target.value })} aria-label="Fin" />
                          <button type="button" className="btn-secondary" onClick={() => setFactor('peakHours', { windows: r.peakHours.windows.filter((_, j) => j !== i) })}>
                            Retirer
                          </button>
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      className="btn-secondary w-fit"
                      onClick={() => setFactor('peakHours', { windows: [...r.peakHours.windows, { days: [1, 2, 3, 4, 5], from: '07:00', to: '09:00' }] })}
                    >
                      Ajouter une plage
                    </button>
                  </div>
                )}
                {f.key === 'trafficAlert' && (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span>Jusqu’au</span>
                    <input
                      type="datetime-local"
                      className="field"
                      value={r.trafficAlert.until ? r.trafficAlert.until.slice(0, 16) : ''}
                      onChange={(e) => setFactor('trafficAlert', { until: e.target.value ? `${e.target.value}:00.000Z` : null })}
                    />
                    <span>(heure d’Abidjan)</span>
                    <input
                      className="field min-w-60"
                      maxLength={120}
                      placeholder="Motif affiché, ex. travaux au Plateau"
                      value={r.trafficAlert.note}
                      onChange={(e) => setFactor('trafficAlert', { note: e.target.value })}
                    />
                  </div>
                )}
                {f.key === 'holidays' && (
                  <label className="grid gap-1 text-sm">
                    <span>Dates (AAAA-MM-JJ, séparées par des virgules)</span>
                    <input
                      className="field"
                      value={r.holidays.dates.join(', ')}
                      onChange={(e) => setFactor('holidays', { dates: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })}
                    />
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      </Section>
      {writer ? (
        <ReasonAction
          label="Enregistrer le tarif dynamique"
          title="Enregistrer le tarif dynamique"
          run={(reason) => adminCall('settings/pricing.dynamic', 'PUT', { value: r, reason })}
          onDone={() => {
            setOk('Tarif dynamique enregistré.');
            setEdit(null);
            list.reload();
          }}
        />
      ) : (
        <p className="text-sm text-ink-muted">Lecture seule : il faut le droit de modifier les paramètres.</p>
      )}
    </>
  );
}
