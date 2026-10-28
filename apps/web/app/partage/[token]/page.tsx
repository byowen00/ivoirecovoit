import type { Metadata } from 'next';
import { SharedTripView } from './SharedTripView';

// Le lien contient un secret : ne pas l'indexer ni le transmettre en référent.
export const metadata: Metadata = { title: 'Trajet partagé', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default async function SharedTripPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SharedTripView token={token} />;
}
