import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BookingForm } from './BookingForm';

export const metadata: Metadata = { title: 'Réserver' };

export default async function ReservePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<p className="card text-ink-muted">Chargement…</p>}>
      <BookingForm tripId={id} />
    </Suspense>
  );
}
