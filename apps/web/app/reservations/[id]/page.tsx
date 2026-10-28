import type { Metadata } from 'next';
import { BookingView } from './BookingView';

export const metadata: Metadata = { title: 'Ma réservation' };

export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BookingView id={id} />;
}
