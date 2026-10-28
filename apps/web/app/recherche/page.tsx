import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SearchResults } from './SearchResults';

export const metadata: Metadata = { title: 'Résultats de recherche' };

export default function SearchPage() {
  return (
    <Suspense>
      <SearchResults />
    </Suspense>
  );
}
