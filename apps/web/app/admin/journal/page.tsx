import type { Metadata } from 'next';
import { AuditLog } from './AuditLog';

export const metadata: Metadata = { title: "Journal d’audit" };

export default function AuditPage() {
  return <AuditLog />;
}
