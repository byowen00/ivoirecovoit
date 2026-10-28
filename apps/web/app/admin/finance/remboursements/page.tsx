import type { Metadata } from 'next';
import { RefundList } from './RefundList';

export const metadata: Metadata = { title: 'Remboursements' };

export default function RefundsPage() {
  return <RefundList />;
}
