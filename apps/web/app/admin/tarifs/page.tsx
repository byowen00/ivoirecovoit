import type { Metadata } from 'next';
import { DynamicPricingView } from './DynamicPricingView';

export const metadata: Metadata = { title: 'Tarif dynamique' };

export default function DynamicPricingPage() {
  return <DynamicPricingView />;
}
