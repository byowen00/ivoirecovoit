'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { notifications } from '@/lib/trust';

const POLL_MS = 60_000;

/** Lien vers les notifications avec le nombre de non lues (interrogation toutes les minutes, page visible seulement). */
export function NotificationBell() {
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  useEffect(() => {
    let stopped = false;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      notifications.unreadCount().then((r) => !stopped && setCount(r.unreadCount), () => undefined);
    };
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [pathname]);

  const label = count > 0 ? `Notifications : ${count} non lue${count > 1 ? 's' : ''}` : 'Notifications';
  return (
    <Link href="/notifications" aria-label={label} className="relative inline-flex size-10 items-center justify-center rounded-full text-night-muted hover:bg-white/10 hover:text-white">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-brand px-1 text-center text-xs font-bold leading-5 text-white tabular-nums">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
