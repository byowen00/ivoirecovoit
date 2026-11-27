'use client';

import 'leaflet/dist/leaflet.css';
import type { CircleMarker, Map as LeafletMap } from 'leaflet';
import { useEffect, useRef, useState } from 'react';

const TILE_URL = process.env.NEXT_PUBLIC_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  process.env.NEXT_PUBLIC_TILE_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">contributeurs OpenStreetMap</a>';
const ABIDJAN: [number, number] = [5.345, -4.024];

type Leaflet = typeof import('leaflet');
const loadLeaflet = (): Promise<Leaflet> =>
  import('leaflet').then((m) => ((m as unknown as { default?: Leaflet }).default ?? (m as unknown as Leaflet)));

interface Props {
  label: string;
  initial?: { lat: number; lng: number } | null;
  busy?: boolean;
  onPick: (point: { lat: number; lng: number }) => void;
  onCancel: () => void;
}

/** Choisir un point en touchant la carte ; il est ensuite rattaché au lieu connu le plus proche. */
export function MapPicker({ label, initial, busy, onPick, onCancel }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const marker = useRef<CircleMarker | null>(null);
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(initial ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    loadLeaflet()
      .then((L) => {
        if (disposed || !container.current) return;
        const start: [number, number] = initial ? [initial.lat, initial.lng] : ABIDJAN;
        const m = L.map(container.current, { center: start, zoom: initial ? 13 : 11 });
        L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 18 }).addTo(m);
        const place = (lat: number, lng: number) => {
          marker.current?.remove();
          marker.current = L.circleMarker([lat, lng], { radius: 9, color: '#fff', weight: 2, fillColor: '#c0560a', fillOpacity: 1 }).addTo(m);
          setPoint({ lat, lng });
        };
        if (initial) place(initial.lat, initial.lng);
        m.on('click', (e) => place(e.latlng.lat, e.latlng.lng));
        map.current = m;
      })
      .catch(() => setFailed(true));
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
    };
    // La carte n'est créée qu'une fois ; le point de départ ne change pas ensuite.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failed) return <p className="text-sm text-danger">Carte indisponible. Saisissez le lieu à la place.</p>;
  return (
    <div className="grid gap-2 rounded-[var(--radius-control)] border border-line bg-surface p-2">
      <div ref={container} className="h-64 w-full rounded-[var(--radius-control)]" role="region" aria-label={`Carte : ${label}`} />
      <p className="text-xs text-ink-muted">Touchez la carte à l’endroit voulu. Le lieu connu le plus proche sera retenu.</p>
      <div className="flex gap-2">
        <button type="button" className="btn-primary" disabled={!point || busy} onClick={() => point && onPick(point)}>
          {busy ? 'Recherche du lieu…' : 'Choisir ce point'}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </div>
  );
}
