import type { Metadata } from 'next';
import { ManageTrip } from './ManageTrip';

export const metadata: Metadata = { title: 'Gérer le trajet' };

export default async function ManageTripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ManageTrip id={id} />;
}
