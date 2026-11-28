'use client';

import { useState } from 'react';
import { adminCall, can } from '@/lib/admin';
import { apiGet } from '@/lib/api';
import type { Appearance, AppearanceValue, ThemeName } from '@/lib/appearance';
import { useStaff } from '../_components/AdminShell';
import { vehicleMarker } from '@/lib/vehicle-marker';
import { Loading, Notice, PageTitle, ReasonAction, Section, useAdmin } from '../_components/ui';

const LAYOUTS: { value: AppearanceValue['homeLayout']; label: string; hint: string }[] = [
  { value: 'CARTE', label: 'Carte avec la position', hint: 'L’accueil de l’appli s’ouvre sur une carte centrée sur la personne.' },
  { value: 'CLASSIQUE', label: 'Classique', hint: 'En-tête sombre avec le nom de l’appli, sans carte.' },
];
const ICONS: { value: AppearanceValue['vehicleIcon']; label: string }[] = [
  { value: 'AUTO', label: 'Selon le trajet (voiture en ville, minibus en interurbain)' },
  { value: 'VOITURE', label: 'Voiture' },
  { value: 'TAXI', label: 'Taxi' },
  { value: 'MINIBUS', label: 'Minibus' },
  { value: 'POINT', label: 'Simple point' },
];
const SIZES: { value: AppearanceValue['vehicleSize']; label: string }[] = [
  { value: 'PETIT', label: 'Petit' },
  { value: 'MOYEN', label: 'Moyen' },
  { value: 'GRAND', label: 'Grand' },
];

const KINDS: { value: AppearanceValue['defaultTripKind']; label: string }[] = [
  { value: 'ALL', label: 'Tous' },
  { value: 'URBAN', label: '🏙 En ville' },
  { value: 'INTERCITY', label: '🛣 Interurbain' },
];

/** Réglage de l'apparence du site et de l'appli : palette, accueil, menu de recherche par défaut. */
export function InterfaceView() {
  const me = useStaff();
  const current = useAdmin(() => apiGet<Appearance>('/app/appearance'), []);
  const [edit, setDraft] = useState<AppearanceValue | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  if (!current.data) return <Loading error={current.error} />;
  const a = current.data;
  // Tant que rien n'est modifié, le brouillon est la valeur enregistrée.
  const draft: AppearanceValue = edit ?? { theme: a.theme, homeLayout: a.homeLayout, defaultTripKind: a.defaultTripKind, showPopularRoutes: a.showPopularRoutes, liveDrivers: a.liveDrivers ?? true,
    vehicleIcon: a.vehicleIcon ?? 'AUTO', vehicleColor: a.vehicleColor ?? 'MARQUE', vehicleSize: a.vehicleSize ?? 'MOYEN' };
  const themes = current.data.themes;
  const c = themes[draft.theme];
  const writer = can(me, 'settings.write');
  const set = <K extends keyof AppearanceValue>(k: K, v: AppearanceValue[K]) => setDraft({ ...draft, [k]: v });

  return (
    <>
      <PageTitle title="Interface et design" />
      <p className="text-sm text-ink-muted">
        Ces choix s’appliquent au site et à l’appli (au prochain démarrage de l’appli, une minute au plus pour le site). Chaque modification est
        versionnée et journalisée avec son motif.
      </p>
      <Notice ok={ok} />
      <Section title="Couleurs">
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Palette de couleurs">
          {(Object.keys(themes) as ThemeName[]).map((name) => {
            const t = themes[name];
            return (
              <label key={name} className={`flex cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border p-3 ${draft.theme === name ? 'border-ink ring-2 ring-ink' : 'border-line'}`}>
                <input type="radio" name="theme" className="sr-only" checked={draft.theme === name} onChange={() => set('theme', name)} />
                <span className="flex gap-1" aria-hidden>
                  {[t.night, t.brand, t.accent, t.brandSoft].map((col) => (
                    <span key={col} className="h-7 w-7 rounded-full border border-line" style={{ background: col }} />
                  ))}
                </span>
                <span className="font-medium">{t.label}</span>
              </label>
            );
          })}
        </div>
      </Section>
      <Section title="Accueil de l’appli">
        <div className="grid gap-2" role="radiogroup" aria-label="Disposition de l’accueil">
          {LAYOUTS.map((l) => (
            <label key={l.value} className="flex items-start gap-2">
              <input type="radio" name="layout" className="mt-1" checked={draft.homeLayout === l.value} onChange={() => set('homeLayout', l.value)} />
              <span>
                <span className="font-medium">{l.label}</span>
                <span className="block text-sm text-ink-muted">{l.hint}</span>
              </span>
            </label>
          ))}
          <label className="mt-2 flex items-center gap-2">
            <input type="checkbox" checked={draft.showPopularRoutes} onChange={(e) => set('showPopularRoutes', e.target.checked)} />
            <span>Afficher « Trajets fréquents » sur l’accueil</span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={draft.liveDrivers} onChange={(e) => set('liveDrivers', e.target.checked)} />
            <span>
              Afficher en temps réel les conducteurs en circulation sur la carte
              <span className="block text-sm text-ink-muted">
                Trajets en cours seulement, position arrondie à 500 m environ, sans nom ni plaque. Actualisé toutes les 15 secondes.
              </span>
            </span>
          </label>
        </div>
      </Section>
      <Section title="Véhicules sur la carte">
        <p className="text-sm text-ink-muted">
          Icône des voitures en circulation sur les cartes de l’appli (accueil, suivi du trajet pour le passager et le conducteur), du site et de la console.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm">
            <span>Icône</span>
            <select className="field" value={draft.vehicleIcon} onChange={(e) => set('vehicleIcon', e.target.value as AppearanceValue['vehicleIcon'])}>
              {ICONS.map((i) => (
                <option key={i.value} value={i.value}>{i.label}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span>Couleur</span>
            <select className="field" value={draft.vehicleColor} onChange={(e) => set('vehicleColor', e.target.value as AppearanceValue['vehicleColor'])}>
              {Object.entries(a.vehicleColors ?? { MARQUE: { label: 'Couleur de la palette', hex: null } }).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span>Taille</span>
            <select className="field" value={draft.vehicleSize} onChange={(e) => set('vehicleSize', e.target.value as AppearanceValue['vehicleSize'])}>
              {SIZES.map((x) => (
                <option key={x.value} value={x.value}>{x.label}</option>
              ))}
            </select>
          </label>
          <span className="flex items-center gap-3 rounded border border-line bg-[#dfe7dc] px-3 py-2" aria-label="Aperçu des véhicules">
            {(['URBAN', 'INTERCITY'] as const).map((k) => (
              <span
                key={k}
                // Aperçu : même rendu que sur la carte.
                dangerouslySetInnerHTML={{
                  __html: vehicleMarker(
                    { icon: draft.vehicleIcon, size: draft.vehicleSize, hex: a.vehicleColors?.[draft.vehicleColor]?.hex ?? c.brand },
                    k,
                  ).html,
                }}
              />
            ))}
          </span>
        </div>
      </Section>
      <Section title="Menu de recherche">
        <label className="grid max-w-xs gap-1 text-sm">
          <span>Choix présélectionné</span>
          <select className="field" value={draft.defaultTripKind} onChange={(e) => set('defaultTripKind', e.target.value as AppearanceValue['defaultTripKind'])}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </label>
      </Section>
      <Section title="Aperçu">
        <div className="max-w-sm overflow-hidden rounded-[var(--radius-card)] border border-line" aria-label="Aperçu de l’accueil">
          <div className="p-4 text-white" style={{ background: draft.homeLayout === 'CARTE' ? '#dfe7dc' : c.night }}>
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-full text-white" style={{ background: c.night }}>☰</span>
              <span className="rounded-full px-3 py-1 text-sm font-extrabold" style={{ background: c.night }}>
                Ivoire<span style={{ color: c.accent }}>Covoit</span>
              </span>
            </div>
            {draft.homeLayout === 'CARTE' && <p className="mt-6 text-center text-2xl" aria-hidden>📍</p>}
          </div>
          <div className="grid gap-2 bg-surface p-4">
            <p className="font-display text-lg font-extrabold text-ink">Où allez-vous ?</p>
            <p className="text-sm text-ink-muted">Menu : {KINDS.find((k) => k.value === draft.defaultTripKind)!.label}</p>
            <span className="rounded-[var(--radius-control)] py-3 text-center font-semibold text-white" style={{ background: c.brand }}>
              Rechercher
            </span>
            <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: c.brandSoft, color: c.brandStrong }}>
              🚗 En ville
            </span>
          </div>
        </div>
      </Section>
      {writer ? (
        <ReasonAction
          label="Enregistrer ces réglages"
          title="Enregistrer l’apparence"
          run={(reason) => adminCall('settings/ui.appearance', 'PUT', { value: draft, reason })}
          onDone={() => {
            setOk('Apparence enregistrée.');
            setDraft(null);
            current.reload();
          }}
        />
      ) : (
        <p className="text-sm text-ink-muted">Lecture seule : il faut le droit de modifier les paramètres.</p>
      )}
    </>
  );
}
