import type { Metadata } from 'next';
import { DriverDashboard } from './DriverDashboard';

export const metadata: Metadata = { title: 'Espace conducteur' };

export default function DriverPage() {
  return <DriverDashboard />;
}
