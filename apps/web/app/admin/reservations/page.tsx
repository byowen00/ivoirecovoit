import type { Metadata } from 'next';
import { BookingList } from './BookingList';

export const metadata: Metadata = { title: 'Réservations' };

export default function BookingsPage() {
  return <BookingList />;
}
