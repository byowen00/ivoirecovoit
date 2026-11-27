import type { Metadata } from 'next';
import { SupportHome } from './SupportHome';

export const metadata: Metadata = { title: 'Assistance' };

export default function SupportPage() {
  return <SupportHome />;
}
