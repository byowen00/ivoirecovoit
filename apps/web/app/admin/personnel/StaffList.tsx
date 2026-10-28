'use client';

import { useState } from 'react';
import { adminCall, can, ROLE_LABEL } from '@/lib/admin';
import { useStaff } from '../_components/AdminShell';
import { Badge, dt, errText, Loading, Notice, PageTitle, ReasonAction, Section, Table, useAdmin } from '../_components/ui';

interface StaffRow {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  roles: string[];
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}
interface Role {
  code: string;
  label: string;
  permissions: string[];
}

const ROLES = ['SUPPORT', 'ADMIN', 'FINANCE', 'SUPER_ADMIN'];
const EMPTY = { email: '', firstName: '', lastName: '', role: 'SUPPORT', password: '' };

export function StaffList() {
  const me = useStaff();
  const list = useAdmin(() => adminCall<{ data: StaffRow[] }>('staff'), []);
  const roles = useAdmin(() => adminCall<{ data: Role[] }>('staff-roles'), []);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [f, setF] = useState(EMPTY);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ email: string; otpauthUri: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg({});
    try {
      const r = await adminCall<{ id: string; email: string; otpauthUri: string }>('staff', 'POST', { ...f, email: f.email.trim(), firstName: f.firstName.trim(), lastName: f.lastName.trim() });
      setCreated({ email: r.email, otpauthUri: r.otpauthUri });
      setF(EMPTY);
      setCreating(false);
      list.reload();
    } catch (err) {
      setMsg({ error: errText(err) });
    }
  }

  return (
    <>
      <PageTitle title="Personnel">
        {!creating && can(me, 'staff.manage') && <button type="button" className="btn-primary" onClick={() => setCreating(true)}>Nouveau compte</button>}
      </PageTitle>
      <Notice ok={msg.ok} error={msg.error} />
      {created && (
        <section className="card grid gap-2 border-2 border-accent" aria-label="Clé de double authentification">
          <h2 className="font-semibold">Compte {created.email} créé</h2>
          <p className="text-sm">
            Transmettez cette clé à la personne, en main propre ou par un canal sûr, pour l’ajouter à son application d’authentification (Google Authenticator,
            Aegis…). <strong>Elle ne sera plus affichée</strong> : en cas de perte, il faudra recréer le compte.
          </p>
          <code className="break-all rounded bg-surface-muted p-2 text-xs">{created.otpauthUri}</code>
          <p className="text-sm">Clé à saisir à la main : <code className="break-all">{new URL(created.otpauthUri).searchParams.get('secret')}</code></p>
          <button type="button" className="btn-secondary justify-self-start" onClick={() => setCreated(null)}>J’ai transmis la clé, masquer</button>
        </section>
      )}
      {creating && (
        <Section title="Nouveau compte du personnel">
          <form className="grid gap-2 sm:grid-cols-2" onSubmit={(e) => void create(e)}>
            <label className="grid gap-1 text-sm"><span>E-mail professionnel</span><input type="email" className="field" value={f.email} onChange={set('email')} required /></label>
            <label className="grid gap-1 text-sm">
              <span>Rôle</span>
              <select className="field" value={f.role} onChange={set('role')}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm"><span>Prénom</span><input className="field" value={f.firstName} onChange={set('firstName')} required maxLength={60} /></label>
            <label className="grid gap-1 text-sm"><span>Nom</span><input className="field" value={f.lastName} onChange={set('lastName')} required maxLength={60} /></label>
            <label className="grid gap-1 text-sm sm:col-span-2">
              <span>Mot de passe provisoire (12 caractères minimum, à transmettre séparément)</span>
              <input type="password" autoComplete="new-password" className="field" value={f.password} onChange={set('password')} required minLength={12} />
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
          rowKey={(s) => s.id}
          columns={[
            { label: 'Personne', render: (s) => <><strong>{[s.firstName, s.lastName].filter(Boolean).join(' ') || '—'}</strong><span className="block text-xs text-ink-muted">{s.email}</span></> },
            { label: 'Rôles', render: (s) => s.roles.map((r) => ROLE_LABEL[r] ?? r).join(', ') || '—' },
            { label: 'État', render: (s) => <><Badge code={s.isActive ? 'ACTIVE' : 'INACTIVE'} /><span className="block text-xs text-ink-muted">dernière connexion {dt(s.lastLoginAt)}</span></> },
            {
              label: 'Actions',
              render: (s) =>
                s.id === me?.id ? (
                  <span className="text-xs text-ink-muted">Votre compte</span>
                ) : (
                  <div className="grid gap-2">
                    <RolesEditor s={s} onDone={() => { setMsg({ ok: 'Rôles mis à jour ; ses sessions ont été fermées.' }); list.reload(); }} />
                    <ReasonAction
                      label={s.isActive ? 'Désactiver' : 'Réactiver'}
                      danger={s.isActive}
                      run={(reason) => adminCall(`staff/${s.id}/active`, 'POST', { active: !s.isActive, reason })}
                      onDone={() => { setMsg({ ok: s.isActive ? 'Compte désactivé.' : 'Compte réactivé.' }); list.reload(); }}
                    />
                  </div>
                ),
            },
          ]}
        />
      )}
      {roles.data && (
        <Section title="Ce que chaque rôle peut faire">
          <ul className="grid gap-2 text-sm">
            {roles.data.data.map((r) => (
              <li key={r.code}>
                <strong>{ROLE_LABEL[r.code] ?? r.label}</strong> : <span className="text-xs text-ink-muted">{r.permissions.includes('*') ? 'tout' : r.permissions.join(', ')}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

function RolesEditor({ s, onDone }: { s: StaffRow; onDone: () => void }) {
  const [selected, setSelected] = useState<string[]>(s.roles);
  return (
    <ReasonAction label="Changer les rôles" run={(reason) => adminCall(`staff/${s.id}/roles`, 'PUT', { roles: selected, reason })} onDone={onDone} disabled={false}>
      <fieldset className="grid gap-1 text-sm">
        <legend className="mb-1">Rôles</legend>
        {ROLES.map((r) => (
          <label key={r} className="flex items-center gap-2">
            <input type="checkbox" checked={selected.includes(r)} onChange={(e) => setSelected(e.target.checked ? [...selected, r] : selected.filter((x) => x !== r))} />
            {ROLE_LABEL[r]}
          </label>
        ))}
      </fieldset>
    </ReasonAction>
  );
}
