import type { Metadata } from 'next';
import { PaymentList } from './PaymentList';

export const metadata: Metadata = { title: 'Paiements' };

export default function PaymentsPage() {
  return <PaymentList />;
}
