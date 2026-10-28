'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatDay } from '@/components/TripCard';
import { DISPUTE_STATUS_LABEL, type DisputeSummary, type MyReport, REPORT_CATEGORY_LABEL, REPORT_STATUS_LABEL, trust } from '@/lib/trust';

/** Réclamations et signalements de la personne connectée. */
export function MyCases() {
  const [disputes, setDisputes] = useState<DisputeSummary[] | null>(null);
  const [reports, setReports] = useState<MyReport[] | null>(null);
  useEffect(() => {
    trust.myDisputes().then((r) => setDisputes(r.data), () => setDisputes([]));
    trust.myReports().then((r) => setReports(r.data), () => setReports([]));
  }, []);

  return (
    <>
      <section className="card grid gap-2" aria-labelledby="disputes-title">
        <h2 id="disputes-title" className="text-lg font-semibold">
          Mes réclamations
        </h2>
        {disputes === null && <p className="text-sm text-ink-muted">Chargement…</p>}
        {disputes?.length === 0 && (
          <p className="text-sm text-ink-muted">
            Aucune réclamation. Pour en ouvrir une, allez sur la réservation concernée dans{' '}
            <Link href="/reservations" className="font-semibold text-brand">
              Mes réservations
            </Link>
            .
          </p>
        )}
        <ul className="grid gap-2">
          {disputes?.map((d) => (
            <li key={d.id}>
              <Link href={`/aide/reclamations/${d.id}`} className="grid rounded border border-line p-2 hover:bg-surface-muted">
                <span className="font-medium">
                  {d.reference} · {d.reasonLabel}
                </span>
                <span className="text-sm text-ink-muted">
                  {DISPUTE_STATUS_LABEL[d.status]} · réservation {d.bookingReference} · {formatDay(d.createdAt)}
                  {!d.openedByMe && ' · ouverte par l’autre partie'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section className="card grid gap-2" aria-labelledby="reports-title">
        <h2 id="reports-title" className="text-lg font-semibold">
          Mes signalements
        </h2>
        {reports?.length === 0 && <p className="text-sm text-ink-muted">Aucun signalement envoyé.</p>}
        <ul className="grid gap-1 text-sm">
          {reports?.map((r) => (
            <li key={r.id} className="flex justify-between gap-2">
              <span>
                {REPORT_CATEGORY_LABEL[r.category]} · {formatDay(r.createdAt)}
              </span>
              <span className="text-ink-muted">{REPORT_STATUS_LABEL[r.status] ?? r.status}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
