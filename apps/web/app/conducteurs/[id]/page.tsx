import type { Metadata } from 'next';
import { DriverProfileView } from './DriverProfileView';

export const metadata: Metadata = { title: 'Profil conducteur' };

export default async function DriverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DriverProfileView id={id} />;
}
