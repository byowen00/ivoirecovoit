import type { Metadata } from 'next';
import { Places } from './Places';

export const metadata: Metadata = { title: 'Lieux' };

export default function PlacesPage() {
  return <Places />;
}
