import type { Metadata } from 'next';
import { MyBookings } from './MyBookings';

export const metadata: Metadata = { title: 'Mes réservations' };

export default function MyBookingsPage() {
  return <MyBookings />;
}
