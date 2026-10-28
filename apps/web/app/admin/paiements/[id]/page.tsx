import type { Metadata } from 'next';
import { PaymentDetail } from './PaymentDetail';

export const metadata: Metadata = { title: 'Paiement' };

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PaymentDetail id={id} />;
}
