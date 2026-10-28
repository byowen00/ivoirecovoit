import type { Metadata } from 'next';
import { DisputeList } from './DisputeList';

export const metadata: Metadata = { title: 'Réclamations' };

export default function DisputesPage() {
  return <DisputeList />;
}
