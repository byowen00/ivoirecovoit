import type { Metadata } from 'next';
import { CodeForm } from './CodeForm';

export const metadata: Metadata = { title: 'Code de vérification' };

export default function CodePage() {
  return (
    <div className="mx-auto max-w-md">
      <CodeForm />
    </div>
  );
}
