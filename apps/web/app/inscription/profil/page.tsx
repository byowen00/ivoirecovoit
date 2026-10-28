import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ProfileSetupForm } from './ProfileSetupForm';

export const metadata: Metadata = { title: 'Votre profil' };

export default function ProfileSetupPage() {
  return (
    <div className="mx-auto max-w-md">
      <Suspense>
        <ProfileSetupForm />
      </Suspense>
    </div>
  );
}
