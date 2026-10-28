'use client';

import { useRef } from 'react';

const LENGTH = 6;

interface Props {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}

/**
 * Six cases pour le code reçu par SMS. Collage d'un code complet, saisie automatique du code par le
 * téléphone (autocomplete="one-time-code"), retour arrière vers la case précédente.
 */
export function OtpInput({ value, onChange, onComplete, disabled, invalid, describedBy }: Props) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: LENGTH }, (_, i) => value[i] ?? '');

  function commit(next: string, focusIndex: number) {
    const clean = next.replace(/\D/g, '').slice(0, LENGTH);
    onChange(clean);
    refs.current[Math.min(focusIndex, LENGTH - 1)]?.focus();
    if (clean.length === LENGTH) onComplete?.(clean);
  }

  function handleInput(index: number, raw: string) {
    const typed = raw.replace(/\D/g, '');
    if (typed.length > 1) {
      // Remplissage automatique (code lu dans le SMS) ou frappe sur une case déjà remplie.
      const merged = typed.length >= LENGTH ? typed : value.slice(0, index) + typed.slice(-1) + value.slice(index + 1);
      commit(merged, typed.length >= LENGTH ? LENGTH - 1 : index + 1);
      return;
    }
    const chars = digits.slice();
    chars[index] = typed;
    commit(chars.join('').slice(0, LENGTH), typed ? index + 1 : index);
  }

  return (
    <div role="group" aria-label="Code à 6 chiffres" aria-describedby={describedBy} className="flex justify-between gap-2">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          onChange={(e) => handleInput(i, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !d && i > 0) {
              e.preventDefault();
              const chars = digits.slice();
              chars[i - 1] = '';
              commit(chars.join(''), i - 1);
            } else if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
            else if (e.key === 'ArrowRight' && i < LENGTH - 1) refs.current[i + 1]?.focus();
          }}
          onPaste={(e) => {
            e.preventDefault();
            const pasted = e.clipboardData.getData('text').replace(/\D/g, '');
            if (pasted) commit(pasted.length >= LENGTH ? pasted : value.slice(0, i) + pasted, Math.min(i + pasted.length, LENGTH - 1));
          }}
          onFocus={(e) => e.target.select()}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          pattern="[0-9]*"
          maxLength={LENGTH}
          disabled={disabled}
          aria-label={`Chiffre ${i + 1} sur ${LENGTH}`}
          aria-invalid={invalid || undefined}
          className={`h-14 w-full min-w-0 rounded-[var(--radius-control)] border bg-surface text-center text-2xl font-semibold tabular-nums ${
            invalid ? 'border-danger' : 'border-line'
          }`}
        />
      ))}
    </div>
  );
}
