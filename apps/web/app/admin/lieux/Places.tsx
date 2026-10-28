'use client';

import { useState } from 'react';
import { adminCall, can, type Page, query } from '@/lib/admin';
import { useStaff } from '../_components/AdminShell';
import { errText, Loading, More, Notice, PageTitle, Section, Table, usePaged } from '../_components/ui';

interface Place {
  id: string;
  kind: 'CITY' | 'COMMUNE' | 'NEIGHBORHOOD' | 'LANDMARK' | 'STATION';
  name: string;
  aliases: string[];
  isActive: boolean;
  precision: 'EXACT' | 'APPROX';
  parentId: string | null;
  parentName?: string | null;
  lat: number;
  lng: number;
}

const KIND: Record<Place['kind'], string> = { CITY: 'Ville', COMMUNE: 'Commune', NEIGHBORHOOD: 'Quartier', LANDMARK: 'Repère', STATION: 'Gare' };
const EMPTY = { kind: 'NEIGHBORHOOD', name: '', parentId: '', aliases: '', lat: '', lng: '', precision: 'APPROX' };

export function Places() {
  const me = useStaff();
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [f, setF] = useState(EMPTY);
  const [creating, setCreating] = useState(false);
  const list = usePaged((cursor) => adminCall<Page<Place>>(`places${query({ q, kind, cursor, limit: 50 })}`), [q, kind]);
  const writer = can(me, 'places.manage');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function toggle(p: Place) {
    setMsg({});
    try {
      await adminCall(`places/${p.id}`, 'PATCH', { isActive: !p.isActive });
      setMsg({ ok: `${p.name} ${p.isActive ? 'masqué de la recherche' : 'réactivé'}.` });
      list.reload();
    } catch (err) {
      setMsg({ error: errText(err) });
    }
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg({});
    try {
      await adminCall('places', 'POST', {
        kind: f.kind,
        name: f.name.trim(),
        ...(f.parentId.trim() ? { parentId: f.parentId.trim() } : {}),
        aliases: f.aliases.split(',').map((a) => a.trim()).filter(Boolean),
        lat: Number(f.lat.replace(',', '.')),
        lng: Number(f.lng.replace(',', '.')),
        precision: f.precision,
      });
      setMsg({ ok: `${f.name.trim()} ajouté.` });
      setF(EMPTY);
      setCreating(false);
      list.reload();
    } catch (err) {
      setMsg({ error: errText(err) });
    }
  }

  return (
    <>
      <PageTitle title="Lieux">
        {writer && !creating && <button type="button" className="btn-primary" onClick={() => setCreating(true)}>Ajouter un lieu</button>}
      </PageTitle>
      <p className="text-sm text-ink-muted">
        Référentiel des villes, quartiers et repères proposés à la recherche. Les coordonnées doivent venir d’une source vérifiée (OpenStreetMap, relevé sur
        place) ; « Approximative » signale un point indicatif. N’ajoutez aucune coordonnée devinée.
      </p>
      <Notice ok={msg.ok} error={msg.error} />
      {creating && (
        <Section title="Nouveau lieu">
          <form className="grid gap-2 sm:grid-cols-2" onSubmit={(e) => void create(e)}>
            <label className="grid gap-1 text-sm">
              <span>Type</span>
              <select className="field" value={f.kind} onChange={set('kind')}>
                {Object.entries(KIND).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm"><span>Nom</span><input className="field" value={f.name} onChange={set('name')} required minLength={2} maxLength={100} /></label>
            <label className="grid gap-1 text-sm"><span>Identifiant du lieu parent (facultatif)</span><input className="field font-mono text-xs" value={f.parentId} onChange={set('parentId')} placeholder="copié depuis la liste" /></label>
            <label className="grid gap-1 text-sm"><span>Autres noms (séparés par des virgules)</span><input className="field" value={f.aliases} onChange={set('aliases')} /></label>
            <label className="grid gap-1 text-sm"><span>Latitude (4 à 11)</span><input className="field" inputMode="decimal" value={f.lat} onChange={set('lat')} required /></label>
            <label className="grid gap-1 text-sm"><span>Longitude (−9 à −2)</span><input className="field" inputMode="decimal" value={f.lng} onChange={set('lng')} required /></label>
            <label className="grid gap-1 text-sm">
              <span>Précision</span>
              <select className="field" value={f.precision} onChange={set('precision')}>
                <option value="APPROX">Approximative</option>
                <option value="EXACT">Exacte (vérifiée)</option>
              </select>
            </label>
            <div className="flex items-end gap-2">
              <button type="submit" className="btn-primary">Ajouter</button>
              <button type="button" className="btn-secondary" onClick={() => setCreating(false)}>Annuler</button>
            </div>
          </form>
        </Section>
      )}
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setQ(input.trim()); }}>
        <input aria-label="Nom" className="field max-w-xs" placeholder="Nom ou autre nom" value={input} onChange={(e) => setInput(e.target.value)} />
        <select aria-label="Type" className="field w-auto" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Tous types</option>
          {Object.entries(KIND).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <button type="submit" className="btn-secondary">Rechercher</button>
      </form>
      {!list.rows ? (
        <Loading error={list.error} />
      ) : (
        <Table
          rows={list.rows}
          rowKey={(p) => p.id}
          empty="Aucun lieu."
          columns={[
            { label: 'Nom', render: (p) => <><strong className={p.isActive ? '' : 'line-through'}>{p.name}</strong>{p.aliases.length > 0 && <span className="block text-xs text-ink-muted">{p.aliases.join(', ')}</span>}</> },
            { label: 'Type', render: (p) => <>{KIND[p.kind]}{p.parentName && <span className="block text-xs text-ink-muted">dans {p.parentName}</span>}</> },
            { label: 'Coordonnées', render: (p) => <>{p.lat.toFixed(5)}, {p.lng.toFixed(5)}<span className="block text-xs text-ink-muted">{p.precision === 'EXACT' ? 'exacte' : 'approximative'}</span></> },
            { label: 'Identifiant', render: (p) => <code className="break-all text-xs">{p.id}</code> },
            { label: '', render: (p) => (writer ? <button type="button" className="btn-secondary" onClick={() => void toggle(p)}>{p.isActive ? 'Masquer' : 'Réactiver'}</button> : null) },
          ]}
        />
      )}
      <More next={list.next} onMore={list.more} />
    </>
  );
}
