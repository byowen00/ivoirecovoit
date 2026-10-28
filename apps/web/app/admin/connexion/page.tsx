import type { Metadata } from 'next';
import { StaffLogin } from './StaffLogin';

export const metadata: Metadata = { title: 'Connexion du personnel' };

export default async function StaffLoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <StaffLogin next={next?.startsWith('/admin') ? next : '/admin'} />;
}
