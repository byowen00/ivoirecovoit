import type { Metadata } from 'next';
import { DisputeDetail } from './DisputeDetail';

export const metadata: Metadata = { title: 'Réclamation' };

export default async function DisputePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DisputeDetail id={id} />;
}
