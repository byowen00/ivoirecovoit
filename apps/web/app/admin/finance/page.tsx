import type { Metadata } from 'next';
import { FinanceView } from './FinanceView';

export const metadata: Metadata = { title: 'Commissions et versements' };

export default function FinancePage() {
  return <FinanceView />;
}
