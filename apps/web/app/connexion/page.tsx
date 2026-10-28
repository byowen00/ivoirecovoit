import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PhoneForm } from './PhoneForm';

export const metadata: Metadata = { title: 'Connexion' };

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-md">
      <Suspense>
        <PhoneForm />
      </Suspense>
    </div>
  );
}
