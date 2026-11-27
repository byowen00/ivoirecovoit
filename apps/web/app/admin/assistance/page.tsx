import type { Metadata } from 'next';
import { SupportQueue } from './SupportQueue';

export const metadata: Metadata = { title: 'Assistance' };

export default function AdminSupportPage() {
  return <SupportQueue />;
}
