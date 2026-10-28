import type { Metadata } from 'next';
import { Stats } from './Stats';

export const metadata: Metadata = { title: 'Statistiques' };

export default function StatsPage() {
  return <Stats />;
}
