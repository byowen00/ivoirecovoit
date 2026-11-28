import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UpcomingTrips } from '@/components/UpcomingTrips';
import { publicTrips, type SearchResult } from '@/lib/trips';

const trip: SearchResult = {
  tripId: 't1', publicRef: 'T-1', kind: 'URBAN',
  pickup: { stopId: 'p', label: 'Angré', plannedAt: '2026-11-29T07:00:00Z', distanceFromQueryM: 0, lat: 5.4, lng: -4 },
  dropoff: { stopId: 'd', label: 'Plateau', plannedAt: '2026-11-29T07:40:00Z', distanceFromQueryM: 0 },
  estimatedDurationS: 2400, estimatedDistanceM: 12000, isEstimate: true, unitPriceXof: 1100, seatsAvailable: 3,
  acceptanceMode: 'MANUAL', driver: { id: 'u', displayName: 'Awa', ratingAvg: null, ratingCount: 0, verified: true },
  vehicle: { make: 'Toyota', model: 'Corolla', color: 'Gris', comfortClass: 'LUXE' }, stopsCount: 0, isDemo: true,
};

describe('UpcomingTrips', () => {
  it('liste les trajets proposés et filtre par type et par gamme', async () => {
    const spy = vi.spyOn(publicTrips, 'upcoming').mockResolvedValue({ data: [trip] });
    render(<UpcomingTrips />);
    expect(await screen.findByText('Angré')).toBeInTheDocument();
    expect(spy).toHaveBeenLastCalledWith({ kind: undefined, comfort: undefined }, expect.anything());
    await userEvent.click(screen.getByRole('button', { name: 'Interurbain' }));
    await userEvent.click(screen.getByRole('button', { name: /Luxe/ }));
    expect(spy).toHaveBeenLastCalledWith({ kind: 'INTERCITY', comfort: 'LUXE' }, expect.anything());
    spy.mockResolvedValue({ data: [] });
    await userEvent.click(screen.getByRole('button', { name: /Confort/ }));
    expect(await screen.findByText(/Aucun trajet proposé/)).toBeInTheDocument();
  });
});
