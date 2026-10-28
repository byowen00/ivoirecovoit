import type { Metadata } from 'next';
import { PaymentFlow } from './PaymentFlow';

export const metadata: Metadata = { title: 'Paiement' };

export default async function PayPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ paiement?: string }> }) {
  const { id } = await params;
  const { paiement } = await searchParams;
  return <PaymentFlow bookingId={id} paymentId={typeof paiement === 'string' ? paiement : null} />;
}
