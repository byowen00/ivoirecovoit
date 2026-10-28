import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { OtpInput } from '@/components/OtpInput';

function Harness({ onComplete }: { onComplete: (v: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <>
      <OtpInput value={value} onChange={setValue} onComplete={onComplete} />
      <output data-testid="value">{value}</output>
    </>
  );
}

const box = (n: number) => screen.getByLabelText(`Chiffre ${n} sur 6`);

describe('OtpInput', () => {
  it('avance de case en case et signale le code complet', async () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    await userEvent.click(box(1));
    await userEvent.keyboard('123456');
    expect(screen.getByTestId('value')).toHaveTextContent('123456');
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('répartit un code collé dans les six cases', async () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    await userEvent.click(box(1));
    await userEvent.paste('Code : 987 654');
    expect(screen.getByTestId('value')).toHaveTextContent('987654');
    expect(box(6)).toHaveValue('4');
    expect(onComplete).toHaveBeenCalledWith('987654');
  });

  it('ignore les lettres et revient en arrière avec la touche Effacer', async () => {
    render(<Harness onComplete={() => undefined} />);
    await userEvent.click(box(1));
    await userEvent.keyboard('1a2');
    expect(screen.getByTestId('value')).toHaveTextContent('12');
    await userEvent.keyboard('{Backspace}');
    expect(screen.getByTestId('value')).toHaveTextContent('1');
    expect(box(2)).toHaveFocus();
  });

  it('expose un groupe accessible et le remplissage automatique du code SMS', () => {
    render(<Harness onComplete={() => undefined} />);
    expect(screen.getByRole('group', { name: 'Code à 6 chiffres' })).toBeInTheDocument();
    expect(box(1)).toHaveAttribute('autocomplete', 'one-time-code');
    expect(box(1)).toHaveAttribute('inputmode', 'numeric');
  });
});
