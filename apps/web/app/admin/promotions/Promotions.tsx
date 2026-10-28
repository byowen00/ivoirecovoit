'use client';

import { useState } from 'react';
import { adminCall, can } from '@/lib/admin';
import { useStaff } from '../_components/AdminShell';
import { Badge, Demo, dt, errText, Loading, Notice, PageTitle, Section, Table, useAdmin, xof } from '../_components/ui';

interface Promotion {
  id: string;
  code: string;
  description: string | null;
  discountType: 'FIXED' | 'PERCENT';
  discountValue: number;
  maxDiscountXof: number | null;
  minTotalXof: number;
  startsAt: string;
  endsAt: string;
  maxRedemptions: number | null;
  maxPerUser: number;
  redemptionsCount: number;
  firstTripOnly: boolean;
  isActive: boolean;
  isDemo: boolean;
}

const discount = (p: Promotion) =>
  p.discountType === 'PERCENT' ? `${p.discountValue.toLocaleString('fr-FR')} %${p.maxDiscountXof ? ` (max ${xof(p.maxDiscountXof)})` : ''}` : xof(p.discountValue);
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const EMPTY = { code: '', description: '', discountType: 'FIXED', discountValue: '', maxDiscountXof: '', minTotalXof: '0', startsAt: day(0), endsAt: day(30), maxRedemptions: '', maxPerUser: '1', firstTripOnly: false };

export function Promotions() {
  const me = useStaff();
  const list = useAdmin(() => adminCall<{ data: Promotion[] }>('promotions'), []);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [f, setF] = useState(EMPTY);
  const [creating, setCreating] = useState(false);
  const writer = can(me, 'promotions.manage');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });

  async function toggle(p: Promotion) {
    setMsg({});
    try {
      await adminCall(`promotions/${p.id}`, 'PATCH', { isActive: !p.isActive });
      setMsg({ ok: p.isActive ? `Code ${p.code} désactivé.` : `Code ${p.code} réactivé.` });
      list.reload();
    } catch (err) {
      setMsg({ error: errText(err) });
    }
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg({});
    const n = (v: string) => (v.trim() === '' ? null : Number(v));
    try {
      await adminCall('promotions', 'POST', {
        code: f.code.trim(),
        ...(f.description.trim() ? { description: f.description.trim() } : {}),
        discountType: f.discountType,
        discountValue: Number(f.discountValue),
        maxDiscountXof: f.discountType === 'PERCENT' ? n(f.maxDiscountXof) : null,
        minTotalXof: Number(f.minTotalXof) || 0,
        startsAt: new Date(`${f.startsAt}T00:00:00Z`).toISOString(),
        endsAt: new Date(`${f.endsAt}T23:59:59Z`).toISOString(),
        maxRedemptions: n(f.maxRedemptions),
        maxPerUser: Number(f.maxPerUser) || 1,
        firstTripOnly: f.firstTripOnly,
      });
      setMsg({ ok: `Code ${f.code.trim().toUpperCase()} créé.` });
      setF(EMPTY);
      setCreating(false);
      list.reload();
    } catch (err) {
      setMsg({ error: errText(err) });
    }
  }

  return (
    <>
      <PageTitle title="Promotions">
        {writer && !creating && <button type="button" className="btn-primary" onClick={() => setCreating(true)}>Nouveau code</button>}
      </PageTitle>
      <p className="text-sm text-ink-muted">
        La réduction s’applique au prix du trajet, à la charge de la plateforme : le conducteur reçoit le prix plein. Un code est réservé à la réservation et
        consommé au paiement.
      </p>
      <Notice ok={msg.ok} error={msg.error} />
      {creating && (
        <Section title="Nouveau code promo">
          <form className="grid gap-2 sm:grid-cols-2" onSubmit={(e) => void create(e)}>
            <label className="grid gap-1 text-sm"><span>Code</span><input className="field uppercase" value={f.code} onChange={set('code')} required pattern="[A-Za-z0-9-]{3,30}" /></label>
            <label className="grid gap-1 text-sm"><span>Description (interne)</span><input className="field" value={f.description} onChange={set('description')} maxLength={200} /></label>
            <label className="grid gap-1 text-sm">
              <span>Type</span>
              <select className="field" value={f.discountType} onChange={set('discountType')}>
                <option value="FIXED">Montant fixe (F CFA)</option>
                <option value="PERCENT">Pourcentage</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span>{f.discountType === 'PERCENT' ? 'Pourcentage (1 à 100)' : 'Montant (F CFA)'}</span>
              <input className="field" inputMode="numeric" value={f.discountValue} onChange={set('discountValue')} required />
            </label>
            {f.discountType === 'PERCENT' && (
              <label className="grid gap-1 text-sm"><span>Réduction maximum (F CFA, vide = sans)</span><input className="field" inputMode="numeric" value={f.maxDiscountXof} onChange={set('maxDiscountXof')} /></label>
            )}
            <label className="grid gap-1 text-sm"><span>Montant minimum de la réservation (F CFA)</span><input className="field" inputMode="numeric" value={f.minTotalXof} onChange={set('minTotalXof')} /></label>
            <label className="grid gap-1 text-sm"><span>Début</span><input type="date" className="field" value={f.startsAt} onChange={set('startsAt')} required /></label>
            <label className="grid gap-1 text-sm"><span>Fin</span><input type="date" className="field" value={f.endsAt} onChange={set('endsAt')} required /></label>
            <label className="grid gap-1 text-sm"><span>Utilisations au total (vide = sans limite)</span><input className="field" inputMode="numeric" value={f.maxRedemptions} onChange={set('maxRedemptions')} /></label>
            <label className="grid gap-1 text-sm"><span>Utilisations par personne</span><input className="field" inputMode="numeric" value={f.maxPerUser} onChange={set('maxPerUser')} /></label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={f.firstTripOnly} onChange={set('firstTripOnly')} /> Réservé au premier trajet
            </label>
            <div className="flex gap-2 sm:col-span-2">
              <button type="submit" className="btn-primary">Créer</button>
              <button type="button" className="btn-secondary" onClick={() => setCreating(false)}>Annuler</button>
            </div>
          </form>
        </Section>
      )}
      {!list.data ? (
        <Loading error={list.error} />
      ) : (
        <Table
          rows={list.data.data}
          rowKey={(p) => p.id}
          empty="Aucun code promo."
          columns={[
            { label: 'Code', render: (p) => <><strong>{p.code}</strong><Demo on={p.isDemo} />{p.description && <span className="block text-xs text-ink-muted">{p.description}</span>}</> },
            { label: 'Réduction', render: (p) => <>{discount(p)}{p.minTotalXof > 0 && <span className="block text-xs text-ink-muted">dès {xof(p.minTotalXof)}</span>}</> },
            { label: 'Validité', render: (p) => `${dt(p.startsAt)} → ${dt(p.endsAt)}` },
            { label: 'Utilisé', render: (p) => `${p.redemptionsCount}${p.maxRedemptions ? ` / ${p.maxRedemptions}` : ''} (${p.maxPerUser} par pers.${p.firstTripOnly ? ', 1er trajet' : ''})` },
            { label: 'État', render: (p) => <Badge code={p.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
            { label: '', render: (p) => (writer ? <button type="button" className="btn-secondary" onClick={() => void toggle(p)}>{p.isActive ? 'Désactiver' : 'Réactiver'}</button> : null) },
          ]}
        />
      )}
    </>
  );
}
