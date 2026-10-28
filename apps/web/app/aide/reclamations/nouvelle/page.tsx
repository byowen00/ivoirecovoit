import type { Metadata } from 'next';
import { NewDispute } from './NewDispute';

export const metadata: Metadata = { title: 'Ouvrir une réclamation' };

export default async function NewDisputePage({ searchParams }: { searchParams: Promise<{ reservation?: string }> }) {
  const { reservation } = await searchParams;
  return <NewDispute bookingId={reservation ?? ''} />;
}
