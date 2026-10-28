import type { Metadata } from 'next';
import { DisputeView } from './DisputeView';

export const metadata: Metadata = { title: 'Réclamation' };

export default async function DisputePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DisputeView id={id} />;
}
