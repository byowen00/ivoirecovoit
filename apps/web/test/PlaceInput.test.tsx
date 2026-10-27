import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { PlaceInput } from '@/components/PlaceInput';
import type { PlaceSuggestion } from '@/lib/places';

const yamoussoukro: PlaceSuggestion = {
  id: 'p1', kind: 'CITY', name: 'Yamoussoukro', parentName: null, label: 'Yamoussoukro',
  lat: 6.83, lng: -5.29, locationPrecision: 'APPROX',
};

function Harness({ onSelect }: { onSelect: (p: PlaceSuggestion | null) => void }) {
  const [value, setValue] = useState<PlaceSuggestion | null>(null);
  return (
    <PlaceInput
      label="Arrivée"
      placeholder="Ville"
      value={value}
      debounceMs={0}
      onChange={(p) => {
        setValue(p);
        onSelect(p);
      }}
    />
  );
}

afterEach(() => vi.restoreAllMocks());

it('propose des suggestions et sélectionne au clavier', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ data: [yamoussoukro] }), { status: 200 }),
  );
  const onSelect = vi.fn();
  render(<Harness onSelect={onSelect} />);

  await userEvent.type(screen.getByRole('combobox', { name: 'Arrivée' }), 'yamous');
  expect(await screen.findByRole('option', { name: /Yamoussoukro/ })).toBeInTheDocument();
  expect(fetchMock.mock.calls.at(-1)?.[0]).toContain('/api/v1/places/autocomplete?q=yamous');

  await userEvent.keyboard('{Enter}');
  expect(onSelect).toHaveBeenLastCalledWith(yamoussoukro);
  expect(screen.getByRole('combobox')).toHaveValue('Yamoussoukro');
  // Après la sélection, aucun message « Aucun lieu trouvé » ne doit s'afficher
  expect(screen.queryByText(/Aucun lieu trouvé/)).not.toBeInTheDocument();
});

it("n'interroge pas l'API avant 2 caractères", async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch');
  render(<Harness onSelect={vi.fn()} />);
  await userEvent.type(screen.getByRole('combobox'), 'y');
  await new Promise((r) => setTimeout(r, 20));
  expect(fetchMock).not.toHaveBeenCalled();
});

it('affiche un message clair en cas de coupure réseau', async () => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
  render(<Harness onSelect={vi.fn()} />);
  await userEvent.type(screen.getByRole('combobox'), 'bouake');
  await waitFor(
    () => expect(screen.getByText(/Connexion impossible. Vérifiez votre réseau/)).toBeInTheDocument(),
    { timeout: 3000 },
  );
});
