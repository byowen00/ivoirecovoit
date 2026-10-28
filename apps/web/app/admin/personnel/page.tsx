import type { Metadata } from 'next';
import { StaffList } from './StaffList';

export const metadata: Metadata = { title: 'Personnel' };

export default function StaffPage() {
  return <StaffList />;
}
