import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchForm } from '@/components/SearchForm';
import { TripCard } from '@/components/TripCard';
import type { SearchResult } from '@/lib/trips';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

beforeEach(() => push.mockReset());

it('envoie vers les résultats avec le départ, l’arrivée, la date et les places', async () => {
  render(
    <SearchForm initial={{ from: { id: 'abj', label: 'Abidjan' }, to: { id: 'yam', label: 'Yamoussoukro' }, date: '2099-01-15', seats: 1 }} />,
  );
  await userEvent.selectOptions(screen.getByLabelText('Places'), '2');
  await userEvent.click(screen.getByRole('button', { name: 'Rechercher' }));
  const url = new URL(push.mock.calls[0]![0], 'http://x');
  expect(url.pathname).toBe('/recherche');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    from: 'abj', fromLabel: 'Abidjan', to: 'yam', toLabel: 'Yamoussoukro', seats: '2', date: '2099-01-15',
  });
});

it('inverse départ et arrivée', async () => {
  render(<SearchForm initial={{ from: { id: 'abj', label: 'Abidjan' }, to: { id: 'yam', label: 'Yamoussoukro' } }} />);
  await userEvent.click(screen.getByRole('button', { name: 'Inverser départ et arrivée' }));
  expect(screen.getByLabelText('Départ')).toHaveValue('Yamoussoukro');
  expect(screen.getByLabelText('Arrivée')).toHaveValue('Abidjan');
});

it('demande de choisir les lieux dans la liste', async () => {
  render(<SearchForm />);
  await userEvent.click(screen.getByRole('button', { name: 'Rechercher' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Choisissez le départ et l’arrivée');
  expect(push).not.toHaveBeenCalled();
});

const result: SearchResult = {
  tripId: 't1', publicRef: 'IC-1', kind: 'INTERCITY',
  pickup: { stopId: 's0', label: 'Abidjan, Adjamé', plannedAt: '2026-11-02T07:00:00Z', distanceFromQueryM: 2400, lat: 5.35, lng: -4.02 },
  dropoff: { stopId: 's2', label: 'Yamoussoukro', plannedAt: '2026-11-02T10:00:00Z', distanceFromQueryM: 0 },
  estimatedDurationS: 10_800, estimatedDistanceM: 230_000, isEstimate: true, unitPriceXof: 5000, seatsAvailable: 1,
  acceptanceMode: 'AUTO', driver: { id: 'd1', displayName: 'Kouassi K.', ratingAvg: 4.8, ratingCount: 12, verified: true },
  vehicle: { make: 'Toyota', model: 'Corolla', color: 'Gris' }, stopsCount: 1, isDemo: true,
};

it('affiche un résultat avec prix, horaires, places et mention démo', () => {
  render(<TripCard trip={result} seats={2} />);
  expect(screen.getByText(/5\s000 FCFA/)).toBeInTheDocument();
  expect(screen.getByText('07:00')).toBeInTheDocument();
  expect(screen.getByText('1 place libre')).toBeInTheDocument();
  expect(screen.getByText('[DEMO]')).toBeInTheDocument();
  expect(screen.getByText(/à env\.|à 2 km/)).toBeInTheDocument();
  const href = screen.getByRole('link').getAttribute('href')!;
  expect(href).toBe('/trajets/t1?pickup=s0&dropoff=s2&seats=2');
});
