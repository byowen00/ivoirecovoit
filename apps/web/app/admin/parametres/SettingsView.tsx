'use client';

import { useState } from 'react';
import { adminCall, can } from '@/lib/admin';
import { useStaff } from '../_components/AdminShell';
import { dt, InputError, Loading, Notice, PageTitle, ReasonAction, Section, useAdmin } from '../_components/ui';

interface Setting {
  key: string;
  group: string;
  label: string;
  value: unknown;
  version: number;
  updatedAt: string | null;
}
interface History {
  key: string;
  label: string;
  versions: { version: number; value: unknown; updatedAt: string; updatedBy: string | null }[];
}

export const show = (v: unknown) =>
  v === null || v === undefined ? 'non défini' : typeof v === 'boolean' ? (v ? 'Oui' : 'Non') : typeof v === 'object' ? JSON.stringify(v) : String(v);

/** Convertit la saisie selon le type de la valeur actuelle ; une saisie JSON invalide lève une erreur lisible. */
function parse(raw: string, current: unknown): unknown {
  const s = raw.trim();
  if (typeof current === 'number' || (current === null && /^-?\d*$/.test(s))) {
    if (s !== '' && !/^-?\d+$/.test(s)) throw new InputError('Nombre entier attendu.');
    return s === '' ? null : Number(s);
  }
  if (typeof current === 'boolean') return s === 'true';
  try {
    return JSON.parse(s);
  } catch {
    throw new InputError('Format JSON invalide.');
  }
}

export function SettingsView() {
  const me = useStaff();
  const list = useAdmin(() => adminCall<{ data: Setting[] }>('settings'), []);
  const [ok, setOk] = useState<string | null>(null);
  if (!list.data) return <Loading error={list.error} />;
  const groups = [...new Set(list.data.data.map((s) => s.group))];
  const writer = can(me, 'settings.write');
  return (
    <>
      <PageTitle title="Paramètres" />
      <p className="text-sm text-ink-muted">
        Chaque modification crée une nouvelle version, avec son auteur et son motif ; l’ancienne reste consultable. Les valeurs actuelles sont des valeurs de
        démarrage à confirmer avant le lancement. Les frais et commissions se règlent dans « Frais et commissions ».
      </p>
      <Notice ok={ok} />
      {groups.map((g) => (
        <Section key={g} title={g}>
          <ul className="grid gap-3">
            {list.data!.data.filter((s) => s.group === g).map((s) => (
              <SettingRow key={s.key} s={s} writer={writer} onSaved={() => { setOk(`« ${s.label} » mis à jour.`); list.reload(); }} />
            ))}
          </ul>
        </Section>
      ))}
    </>
  );
}

function SettingRow({ s, writer, onSaved }: { s: Setting; writer: boolean; onSaved: () => void }) {
  const [raw, setRaw] = useState(() => (typeof s.value === 'object' && s.value !== null ? JSON.stringify(s.value, null, 2) : s.value === null ? '' : String(s.value)));
  const [history, setHistory] = useState<History | null>(null);
  const isBool = typeof s.value === 'boolean';
  const isJson = typeof s.value === 'object' && s.value !== null;
  return (
    <li className="grid gap-2 border-b border-line pb-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">{s.label}</p>
        <p className="text-xs text-ink-muted">
          <code>{s.key}</code> · version {s.version}{s.updatedAt ? ` du ${dt(s.updatedAt)}` : ''}
        </p>
      </div>
      <p className="break-all text-sm">Valeur : <strong>{show(s.value)}</strong></p>
      <div className="flex flex-wrap gap-2">
        {writer && (
          <ReasonAction label="Modifier" title={`Modifier : ${s.label}`} run={(reason) => adminCall(`settings/${encodeURIComponent(s.key)}`, 'PUT', { value: parse(raw, s.value), reason })} onDone={onSaved}>
            <label className="grid gap-1 text-sm">
              <span>Nouvelle valeur</span>
              {isBool ? (
                <select className="field" value={raw} onChange={(e) => setRaw(e.target.value)}>
                  <option value="true">Oui</option>
                  <option value="false">Non</option>
                </select>
              ) : isJson ? (
                <textarea rows={6} className="field h-auto py-2 font-mono text-xs" value={raw} onChange={(e) => setRaw(e.target.value)} />
              ) : (
                <input className="field" inputMode="numeric" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="Vide = non appliqué" />
              )}
            </label>
          </ReasonAction>
        )}
        <button
          type="button"
          className="btn-secondary"
          onClick={() => (history ? setHistory(null) : void adminCall<History>(`settings/${encodeURIComponent(s.key)}`).then(setHistory, () => undefined))}
        >
          {history ? 'Masquer l’historique' : 'Historique'}
        </button>
      </div>
      {history && (
        <ol className="grid gap-1 text-xs">
          {history.versions.map((v) => (
            <li key={v.version}>
              v{v.version} · {dt(v.updatedAt)} · {v.updatedBy ?? 'installation'} : <code className="break-all">{show(v.value)}</code>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}
