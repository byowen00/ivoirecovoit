import type { Metadata } from 'next';
import { Verifications } from './Verifications';

export const metadata: Metadata = { title: 'Vérifications' };

export default async function VerificationsPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type } = await searchParams;
  return <Verifications initialType={type === 'vehicle' || type === 'document' ? type : 'driver'} />;
}
