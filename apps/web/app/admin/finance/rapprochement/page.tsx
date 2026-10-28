import type { Metadata } from 'next';
import { Reconciliation } from './Reconciliation';

export const metadata: Metadata = { title: 'Rapprochement' };

export default function ReconciliationPage() {
  return <Reconciliation />;
}
