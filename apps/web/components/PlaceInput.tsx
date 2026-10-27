'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ApiRequestError } from '@/lib/api';
import { PLACE_KIND_LABEL, type PlaceSuggestion, searchPlaces } from '@/lib/places';

interface Props {
  label: string;
  placeholder: string;
  value: PlaceSuggestion | null;
  onChange: (place: PlaceSuggestion | null) => void;
  /** Délai avant d'interroger l'API, pour économiser les données mobiles. */
  debounceMs?: number;
}

type Status = 'idle' | 'loading' | 'ready' | 'error';

/** Champ de lieu avec suggestions (motif « combobox » accessible au clavier et aux lecteurs d'écran). */
export function PlaceInput({ label, placeholder, value, onChange, debounceMs = 250 }: Props) {
  const id = useId();
  const listId = `${id}-list`;
  const [text, setText] = useState(value?.label ?? '');
  const [items, setItems] = useState<PlaceSuggestion[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<AbortController | null>(null);

  function cancelPending() {
    if (timer.current) clearTimeout(timer.current);
    inflight.current?.abort();
  }

  useEffect(() => cancelPending, []);

  function onTextChange(next: string) {
    setText(next);
    if (value) onChange(null);
    cancelPending();
    const q = next.trim();
    if (q.length < 2) {
      setItems([]);
      setStatus('idle');
      setOpen(false);
      return;
    }
    const controller = new AbortController();
    inflight.current = controller;
    timer.current = setTimeout(async () => {
      setStatus('loading');
      setError(null);
      try {
        const results = await searchPlaces(q, controller.signal);
        setItems(results);
        setStatus('ready');
        setActive(results.length ? 0 : -1);
        setOpen(true);
      } catch (err) {
        if (controller.signal.aborted) return;
        setStatus('error');
        setError(err instanceof ApiRequestError ? err.message : 'Suggestions indisponibles pour le moment.');
      }
    }, debounceMs);
  }

  function select(place: PlaceSuggestion) {
    cancelPending();
    setText(place.label);
    setOpen(false);
    setItems([]);
    setStatus('idle');
    onChange(place);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || items.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      select(items[active]!);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => items.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="h-12 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-base text-ink placeholder:text-ink-muted"
      />
      <div aria-live="polite" className="min-h-5 pt-1 text-sm">
        {status === 'loading' && <span className="text-ink-muted">Recherche…</span>}
        {status === 'error' && <span className="text-danger">{error}</span>}
        {status === 'ready' && items.length === 0 && (
          <span className="text-ink-muted">Aucun lieu trouvé. Essayez le nom de la ville ou de la commune.</span>
        )}
      </div>
      {open && items.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`Suggestions pour ${label}`}
          className="absolute z-20 mt-[-1rem] w-full overflow-hidden rounded-[var(--radius-control)] border border-line bg-surface shadow-lg"
        >
          {items.map((p, i) => (
            <li
              key={p.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => select(p)}
              className={`flex min-h-12 cursor-pointer items-center justify-between gap-3 px-3 py-2 ${
                i === active ? 'bg-brand-soft' : ''
              }`}
            >
              <span className="text-ink">{p.label}</span>
              <span className="text-xs text-ink-muted">{PLACE_KIND_LABEL[p.kind]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
