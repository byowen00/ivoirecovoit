'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { formatDay, formatTime } from '@/components/TripCard';
import { ApiRequestError } from '@/lib/api';
import { type AppNotification, notifications } from '@/lib/trust';

const message = (err: unknown) => (err instanceof ApiRequestError ? err.message : 'Une erreur est survenue. Réessayez.');

/** Écran 13 : notifications dans l'application, de la plus récente à la plus ancienne. */
export function NotificationList() {
  const router = useRouter();
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (cursor?: string) => {
      notifications.list(cursor).then(
        (r) => {
          setItems((prev) => (cursor && prev ? [...prev, ...r.data] : r.data));
          setNext(r.nextCursor);
          setUnread(r.unreadCount);
        },
        (err: unknown) => {
          if (err instanceof ApiRequestError && err.status === 401) router.replace('/connexion?next=/notifications');
          else setError(message(err));
        },
      );
    },
    [router],
  );
  useEffect(() => load(), [load]);

  async function open(n: AppNotification) {
    if (!n.readAt) {
      await notifications.markRead([n.id]).catch(() => undefined);
      setItems((prev) => prev?.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)) ?? null);
      setUnread((u) => Math.max(0, u - 1));
    }
    if (n.link) router.push(n.link);
  }

  async function readAll() {
    try {
      await notifications.markAllRead();
      setItems((prev) => prev?.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })) ?? null);
      setUnread(0);
    } catch (err) {
      setError(message(err));
    }
  }

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="text-sm text-ink-muted">{unread > 0 ? `${unread} non lue${unread > 1 ? 's' : ''}` : 'Tout est lu.'}</p>
        </div>
        <div className="flex gap-2">
          {unread > 0 && (
            <button type="button" className="btn-secondary" onClick={() => void readAll()}>
              Tout marquer comme lu
            </button>
          )}
          <Link href="/compte#notifications" className="btn-secondary">
            Réglages
          </Link>
        </div>
      </div>
      {error && <p role="alert" className="card text-danger">{error}</p>}
      {!items && !error && <p className="card text-ink-muted">Chargement…</p>}
      {items && items.length === 0 && (
        <p className="card text-ink-muted">Aucune notification pour l’instant. Vous serez prévenu ici de vos réservations, paiements et messages.</p>
      )}
      {items && items.length > 0 && (
        <ul className="grid gap-2">
          {items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => void open(n)}
                className={`card grid w-full gap-1 text-left ${n.readAt ? '' : 'border-l-4 border-l-brand'}`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className={n.readAt ? 'font-medium' : 'font-bold'}>
                    {!n.readAt && <span className="sr-only">Non lue : </span>}
                    {n.title}
                  </span>
                  <span className="shrink-0 text-xs text-ink-muted tabular-nums">
                    {formatDay(n.createdAt)} {formatTime(n.createdAt)}
                  </span>
                </span>
                <span className="text-sm text-ink-muted">{n.body}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {next && (
        <button type="button" className="btn-secondary justify-self-center" onClick={() => load(next)}>
          Notifications plus anciennes
        </button>
      )}
    </div>
  );
}
