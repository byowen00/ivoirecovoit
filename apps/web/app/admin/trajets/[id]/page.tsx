import type { Metadata } from 'next';
import { TripDetail } from './TripDetail';

export const metadata: Metadata = { title: 'Trajet' };

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TripDetail id={id} />;
}
