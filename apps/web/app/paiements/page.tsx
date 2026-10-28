import type { Metadata } from 'next';
import { PaymentHistory } from './PaymentHistory';

export const metadata: Metadata = { title: 'Historique des paiements' };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ onglet?: string }> }) {
  const { onglet } = await searchParams;
  return <PaymentHistory initialTab={onglet === 'gains' ? 'earnings' : 'transactions'} />;
}
