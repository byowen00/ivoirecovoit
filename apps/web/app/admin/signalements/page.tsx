import type { Metadata } from 'next';
import { ReportList } from './ReportList';

export const metadata: Metadata = { title: 'Signalements' };

export default function ReportsPage() {
  return <ReportList />;
}
