import type { Metadata } from 'next';
import { FeeRules } from './FeeRules';

export const metadata: Metadata = { title: 'Frais et commissions' };

export default function FeesPage() {
  return <FeeRules />;
}
