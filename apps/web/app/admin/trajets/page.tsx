import type { Metadata } from 'next';
import { TripList } from './TripList';

export const metadata: Metadata = { title: 'Trajets' };

export default function TripsPage() {
  return <TripList />;
}
