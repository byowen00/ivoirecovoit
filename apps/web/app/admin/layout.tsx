import type { Metadata } from 'next';
import { AdminShell } from './_components/AdminShell';

export const metadata: Metadata = { title: { default: 'Administration', template: '%s · Administration' }, robots: { index: false, follow: false } };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
