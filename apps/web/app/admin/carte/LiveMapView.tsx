'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import type { MapPoint } from '@/components/TripMap';
import { adminCall } from '@/lib/admin';
import { Demo, Loading, PageTitle, useAdmin } from '../_components/ui';

const TripMap = dynamic(() => import('@/components/TripMap').then((m) => m.TripMap), { ssr: false });

export interface LiveTrip {
  tripId: string;
  reference: string;
  kind: 'URBAN' | 'INTERCITY';
  isDemo: boolean;
  startedAt: string | null;
  fromLabel: string | null;
  toLabel: string | null;
  driver: { id: string; name: string };
  vehicle: { label: string; plate: string } | null;
  position: { lat: number; lng: number; heading: number | null; recordedAt: string } | null;
  ageS: number | null;
  stale: boolean;
  passengers: { reference: string; name: string; seats: number; pickup: string; dropoff: string }[];
}
interface LiveOverview {
  data: LiveTrip[];
  counts: { trips: number; sharing: number; passengers: number };
}

/** Texte de l'état de partage d'un trajet en cours. */
export function sharingText(t: Pick<LiveTrip, 'position' | 'ageS' | 'stale'>): string {
  if (!t.position || t.ageS === null) return 'Position non partagée (appli fermée ?)';
  if (t.stale) return `Dernière position il y a ${Math.round(t.ageS / 60)} min`;
  return t.ageS < 60 ? `Position il y a ${t.ageS} s` : `Position il y a ${Math.round(t.ageS / 60)} min`;
}

/** Console : trajets en cours sur la carte, actualisés toutes les 5 secondes. */
export function LiveMapView() {
  const live = useAdmin(() => adminCall<LiveOverview>('live'), []);
  const [selected, setSelected] = useState<string | null>(null);
  const { reload } = live;
  useEffect(() => {
    const timer = setInterval(reload, 5000);
    return () => clearInterval(timer);
  }, [reload]);

  const points = useMemo<MapPoint[]>(
    () =>
      (live.data?.data ?? [])
        .filter((t) => t.position && !t.stale)
        .map((t) => ({
          id: t.tripId,
          lat: t.position!.lat,
          lng: t.position!.lng,
          tone: 'vehicle',
          kind: t.kind,
          highlight: t.tripId === selected,
          label: `${t.driver.name} · ${t.fromLabel ?? '?'} → ${t.toLabel ?? '?'} · ${t.passengers.length} passager(s)`,
        })),
    [live.data, selected],
  );

  if (!live.data) return <Loading error={live.error} />;
  const { data, counts } = live.data;
  const demo = data.some((t) => t.isDemo);
  return (
    <>
      <PageTitle title="Carte en temps réel" />
      <div className="grid grid-cols-3 gap-2">
        {[
          ['Trajets en cours', counts.trips],
          ['Conducteurs visibles', counts.sharing],
          ['Passagers à bord', counts.passengers],
        ].map(([label, n]) => (
          <div key={label} className="card text-center">
            <p className="text-2xl font-bold tabular-nums">{n}</p>
            <p className="text-xs text-ink-muted">{label}</p>
          </div>
        ))}
      </div>
      <TripMap
        points={points}
        label="Conducteurs en circulation"
        className="h-[28rem]"
        fitOnce
        onSelect={setSelected}
        caption={
          demo
            ? 'Actualisé toutes les 5 s. Les voitures [DEMO] ont des positions simulées (pnpm demo:live), pas des GPS réels.'
            : 'Actualisé toutes les 5 s. Position envoyée par l’appli du conducteur pendant le trajet ; les passagers ne partagent pas la leur.'
        }
      />
      {data.length === 0 ? (
        <p className="text-sm text-ink-muted">Aucun trajet en cours. Pour un essai, lancez « pnpm demo:live » sur le PC.</p>
      ) : (
        <ul className="grid gap-2">
          {data.map((t) => (
            <li key={t.tripId} className={`rounded border p-3 ${t.tripId === selected ? 'border-brand' : 'border-line'}`}>
              <button type="button" className="w-full text-left" onClick={() => setSelected(t.tripId === selected ? null : t.tripId)}>
                <span className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium">
                    {t.driver.name} {!t.driver.name.includes("[DEMO]") && <Demo on={t.isDemo} />}
                  </span>
                  <span className={`text-xs ${t.position && !t.stale ? 'text-success' : 'text-danger'}`}>{sharingText(t)}</span>
                </span>
                <span className="block text-sm">
                  {t.fromLabel} → {t.toLabel} · {t.reference}
                  {t.vehicle && ` · ${t.vehicle.label} (${t.vehicle.plate})`}
                </span>
                <span className="block text-xs text-ink-muted">
                  {t.passengers.length === 0
                    ? 'Aucun passager confirmé'
                    : t.passengers.map((p) => `${p.name} (${p.seats} pl., ${p.pickup} → ${p.dropoff})`).join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
