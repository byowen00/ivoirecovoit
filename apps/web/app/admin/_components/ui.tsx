'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDay, formatTime } from '@/components/TripCard';
import { label } from '@/lib/admin';
import { ApiRequestError } from '@/lib/api';
import { formatXof } from '@/lib/format';

/** Erreur de saisie détectée dans la console avant l'appel à l'API. */
export class InputError extends Error {}

export const errText = (err: unknown) =>
  err instanceof ApiRequestError || err instanceof InputError ? err.message : 'Une erreur est survenue. Réessayez.';
export const dt = (iso: string | null | undefined) => (iso ? `${formatDay(iso)} ${formatTime(iso)}` : '—');
export const xof = (n: number | null | undefined) => (n === null || n === undefined ? '—' : formatXof(n));

/** Garde la dernière version d'une fonction sans relancer les effets qui l'utilisent. */
function useLatest<F>(fn: F) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  return ref;
}

/** Chargement d'une ressource de la console ; recharge quand une valeur de `deps` change, ou sur demande. */
export function useAdmin<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const latest = useLatest(load);
  const key = JSON.stringify(deps);
  useEffect(() => {
    let live = true;
    latest.current().then(
      (d) => {
        if (!live) return;
        setData(d);
        setError(null);
      },
      (err: unknown) => live && setError(errText(err)),
    );
    return () => {
      live = false;
    };
  }, [key, tick, latest]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, reload, setData };
}

export function PageTitle({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <h1 className="text-2xl font-bold">{title}</h1>
      {children}
    </div>
  );
}

export function Loading({ error }: { error?: string | null }) {
  return error ? <p role="alert" className="card text-danger">{error}</p> : <p className="card text-ink-muted">Chargement…</p>;
}

export function Notice({ ok, error }: { ok?: string | null; error?: string | null }) {
  if (error) return <p role="alert" className="card text-sm text-danger">{error}</p>;
  if (ok) return <p role="status" className="card text-sm text-success">{ok}</p>;
  return null;
}

const TONE: Record<string, string> = {
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-ink',
  danger: 'bg-danger-soft text-danger',
  muted: 'bg-surface-muted text-ink-muted',
};
const toneOf = (code: string) =>
  /^(CONFIRMED|COMPLETED|PAID|SUCCEEDED|APPROVED|ACTIVE|OK|RESOLVED|ACTION_TAKEN|PUBLISHED)$/.test(code)
    ? 'success'
    : /^(PENDING|REQUESTED|AWAITING|IN_REVIEW|OPEN|PROCESSING|REFUND_PENDING|DRAFT|PAYABLE|IN_PAYOUT|MEDIUM|HIGH|RUNNING|SUSPENDED|PENDING_.*)$/.test(code)
      ? 'warning'
      : /^(FAILED|REJECTED|BANNED|CANCELLED.*|MANUAL_REQUIRED|CRITICAL|DISCREPANCIES|NO_SHOW)$/.test(code)
        ? 'danger'
        : 'muted';

export function Badge({ code }: { code: string | null | undefined }) {
  if (!code) return <span>—</span>;
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${TONE[toneOf(code)]}`}>{label(code)}</span>;
}

export function Demo({ on }: { on?: boolean }) {
  return on ? <span className="ml-1 rounded bg-warning-soft px-1 text-xs text-ink">[DEMO]</span> : null;
}

export interface Column<T> {
  label: string;
  render: (row: T) => React.ReactNode;
  className?: string;
}

export function Table<T>({ rows, columns, empty = 'Aucun élément.', rowKey }: { rows: T[]; columns: Column<T>[]; empty?: string; rowKey: (row: T) => string }) {
  if (rows.length === 0) return <p className="card text-sm text-ink-muted">{empty}</p>;
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase text-ink-muted">
            {columns.map((c) => (
              <th key={c.label} scope="col" className={`px-3 py-2 font-medium ${c.className ?? ''}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className="border-b border-line last:border-b-0">
              {columns.map((c) => (
                <td key={c.label} className={`px-3 py-2 align-top ${c.className ?? ''}`}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Fields({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-muted">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Section({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="card grid gap-3" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/**
 * Action sensible : un motif obligatoire (journalisé), éventuellement d'autres champs, puis confirmation.
 * `run` reçoit le motif ; une erreur de l'API s'affiche dans le formulaire.
 */
export function ReasonAction({
  label: text,
  title,
  danger,
  minLength = 5,
  placeholder,
  disabled,
  children,
  run,
  onDone,
}: {
  label: string;
  title?: string;
  danger?: boolean;
  minLength?: number;
  placeholder?: string;
  disabled?: boolean;
  children?: React.ReactNode;
  run: (reason: string) => Promise<unknown>;
  onDone?: (result: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <button type="button" className={danger ? 'btn-danger' : 'btn-secondary'} disabled={disabled} onClick={() => setOpen(true)}>
        {text}
      </button>
    );
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await run(reason.trim());
      setOpen(false);
      setReason('');
      onDone?.(r);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="grid w-full gap-2 rounded border border-line p-3" aria-label={title ?? text}>
      <p className="font-semibold">{title ?? text}</p>
      {children}
      <label className="grid gap-1 text-sm">
        <span>Motif (obligatoire, conservé dans le journal)</span>
        <textarea rows={2} maxLength={500} className="field h-auto py-2" value={reason} placeholder={placeholder} onChange={(e) => setReason(e.target.value)} />
      </label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={danger ? 'btn-danger' : 'btn-primary'} disabled={busy || reason.trim().length < minLength}>
          Confirmer
        </button>
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
          Annuler
        </button>
      </div>
    </form>
  );
}

export function More({ next, onMore }: { next: string | null | undefined; onMore: (cursor: string) => void }) {
  if (!next) return null;
  return (
    <button type="button" className="btn-secondary justify-self-center" onClick={() => onMore(next)}>
      Afficher plus
    </button>
  );
}

/** Liste paginée par curseur, rechargée quand une valeur de `deps` change. */
export function usePaged<T>(fetchPage: (cursor?: string) => Promise<{ data: T[]; nextCursor: string | null }>, deps: unknown[]) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const latest = useLatest(fetchPage);
  const key = JSON.stringify(deps);
  useEffect(() => {
    let live = true;
    latest.current().then(
      (r) => {
        if (!live) return;
        setRows(r.data);
        setNext(r.nextCursor);
        setError(null);
      },
      (err: unknown) => live && setError(errText(err)),
    );
    return () => {
      live = false;
    };
  }, [key, tick, latest]);
  const more = useCallback(
    (cursor: string) => {
      latest.current(cursor).then(
        (r) => {
          setRows((prev) => [...(prev ?? []), ...r.data]);
          setNext(r.nextCursor);
        },
        (err: unknown) => setError(errText(err)),
      );
    },
    [latest],
  );
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { rows, next, error, more, reload };
}
