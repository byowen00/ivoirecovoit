import type { Metadata } from 'next';
import { MyTrips } from './MyTrips';

export const metadata: Metadata = { title: 'Mes trajets' };

export default function MyTripsPage() {
  return <MyTrips />;
}
