'use client';

import 'leaflet/dist/leaflet.css';
import type { LayerGroup, Map as LeafletMap } from 'leaflet';
import { useEffect, useRef, useState } from 'react';
import type { LatLng } from '@/lib/trips';

export interface MapPoint {
  lat: number;
  lng: number;
  label: string;
  /** Couleur selon le rôle : départ, arrivée, arrêt intermédiaire, résultat de recherche. */
  tone: 'origin' | 'destination' | 'stop' | 'result';
  id?: string;
}

// Tuiles configurables (fournisseur sous contrat en production). Par défaut, OpenStreetMap avec son attribution.
const TILE_URL = process.env.NEXT_PUBLIC_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  process.env.NEXT_PUBLIC_TILE_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">contributeurs OpenStreetMap</a>';

const TONE: Record<MapPoint['tone'], string> = {
  origin: '#00704a',
  destination: '#b85400',
  stop: '#545c66',
  result: '#1d5fd6',
};

type Leaflet = typeof import('leaflet');
// Leaflet est un module UMD : selon l'outil de build, l'API est exposée directement ou sous « default ».
const loadLeaflet = (): Promise<Leaflet> =>
  import('leaflet').then((m) => ((m as unknown as { default?: Leaflet }).default ?? (m as unknown as Leaflet)));

// Centre par défaut : Côte d'Ivoire entière.
const CI_CENTER: [number, number] = [7.54, -5.55];

interface Props {
  points: MapPoint[];
  route?: LatLng[];
  label: string;
  onSelect?: (id: string) => void;
  className?: string;
}

/**
 * Carte Leaflet chargée à la demande (pas de rendu serveur). L'itinéraire affiché est une estimation :
 * la légende le rappelle, et la liste textuelle reste la référence pour les lecteurs d'écran.
 */
export function TripMap({ points, route = [], label, onSelect, className = 'h-72' }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    loadLeaflet()
      .then((L) => {
        if (disposed || !container.current) return;
        map.current = L.map(container.current, { center: CI_CENTER, zoom: 7, scrollWheelZoom: false });
        L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 18 }).addTo(map.current);
        layer.current = L.layerGroup().addTo(map.current);
        setReady(true);
      })
      .catch(() => setFailed(true));
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready || !map.current || !layer.current) return;
    let cancelled = false;
    void loadLeaflet().then((L) => {
      if (cancelled || !map.current || !layer.current) return;
      layer.current.clearLayers();
      if (route.length > 1) L.polyline(route, { color: '#b85400', weight: 4, opacity: 0.8, dashArray: '6 6' }).addTo(layer.current);
      for (const p of points) {
        const m = L.circleMarker([p.lat, p.lng], { radius: p.tone === 'stop' ? 6 : 8, color: '#fff', weight: 2, fillColor: TONE[p.tone], fillOpacity: 1 })
          .bindTooltip(p.label)
          .addTo(layer.current);
        if (onSelect && p.id) m.on('click', () => onSelect(p.id!));
      }
      const all: [number, number][] = [...points.map((p) => [p.lat, p.lng] as [number, number]), ...route];
      if (all.length === 1) map.current.setView(all[0]!, 13);
      else if (all.length > 1) map.current.fitBounds(L.latLngBounds(all), { padding: [24, 24], maxZoom: 14 });
    });
    return () => {
      cancelled = true;
    };
  }, [ready, points, route, onSelect]);

  if (failed) return <p className="card text-sm text-ink-muted">Carte indisponible. Les informations du trajet restent ci-dessous.</p>;
  return (
    <figure className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
      <div ref={container} className={`${className} w-full`} role="region" aria-label={label} />
      <figcaption className="px-3 py-2 text-xs text-ink-muted">Tracé indicatif, ce n’est pas un suivi GPS.</figcaption>
    </figure>
  );
}
