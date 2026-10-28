import type { Metadata } from 'next';
import { PublishWizard } from './PublishWizard';

export const metadata: Metadata = { title: 'Publier un trajet' };

export default function PublishPage() {
  return <PublishWizard />;
}
