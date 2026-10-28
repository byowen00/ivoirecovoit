import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TripDetailView } from './TripDetailView';

export const metadata: Metadata = { title: 'Détail du trajet' };

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <TripDetailView id={id} />
    </Suspense>
  );
}
