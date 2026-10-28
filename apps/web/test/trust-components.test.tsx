import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ReportForm } from '@/components/ReportForm';
import { StarRating, Stars } from '@/components/StarRating';
import { shareMessage } from '@/lib/trust';

function Rating() {
  const [v, setV] = useState(0);
  return <StarRating value={v} onChange={setV} />;
}

describe('StarRating', () => {
  it('se choisit à la souris et affiche le libellé', async () => {
    render(<Rating />);
    await userEvent.click(screen.getByLabelText(/4 sur 5 : Bien/));
    expect(screen.getByLabelText(/4 sur 5 : Bien/)).toBeChecked();
    expect(screen.getByText('Bien', { selector: 'p' })).toBeInTheDocument();
  });

  it('affiche une note arrondie', () => {
    render(<Stars rating={3.6} />);
    expect(screen.getByLabelText('3.6 sur 5')).toHaveTextContent('★★★★★');
  });
});

describe('ReportForm', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    document.cookie = 'ic_csrf=' + 'c'.repeat(32);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('n’envoie qu’avec un motif et une description de 10 caractères', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'r1' }), { status: 201, headers: { 'content-type': 'application/json' } }));
    render(<ReportForm targetType="USER" targetId="u1" bookingId="b1" title="Signaler le conducteur" onDone={() => undefined} />);
    const send = screen.getByRole('button', { name: 'Envoyer le signalement' });
    expect(send).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('Motif'), 'DANGEROUS_DRIVING');
    await userEvent.type(screen.getByLabelText(/Que s’est-il passé/), 'Court');
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Que s’est-il passé/), ' : excès de vitesse');
    await userEvent.click(send);
    expect(await screen.findByRole('status')).toHaveTextContent('Signalement envoyé');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/bff/api/reports');
    expect(JSON.parse(init.body)).toEqual({ targetType: 'USER', targetId: 'u1', bookingId: 'b1', category: 'DANGEROUS_DRIVING', description: 'Court : excès de vitesse' });
    expect(init.headers['Idempotency-Key']).toBeTruthy();
  });

  it('affiche l’erreur renvoyée par l’API', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Trop de signalements aujourd’hui.' } }), { status: 429, headers: { 'content-type': 'application/json' } }),
    );
    render(<ReportForm targetType="MESSAGE" targetId="m1" title="Signaler ce message" onDone={() => undefined} />);
    await userEvent.selectOptions(screen.getByLabelText('Motif'), 'HARASSMENT');
    await userEvent.type(screen.getByLabelText(/Que s’est-il passé/), 'Message insultant reçu');
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer le signalement' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Trop de signalements aujourd’hui.');
  });
});

describe('shareMessage', () => {
  it('précise que les horaires sont estimés et sans GPS', () => {
    expect(shareMessage('https://x.ci/partage/abc', 'Cocody → Yamoussoukro')).toBe(
      'Je voyage avec IvoireCovoit (Cocody → Yamoussoukro). Suivez mon trajet ici : https://x.ci/partage/abc (horaires estimés, pas de position GPS).',
    );
  });
});
