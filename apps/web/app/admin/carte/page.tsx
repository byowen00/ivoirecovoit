import type { Metadata } from 'next';
import { LiveMapView } from './LiveMapView';

export const metadata: Metadata = { title: 'Carte en temps réel' };

export default function AdminLiveMapPage() {
  return <LiveMapView />;
}
