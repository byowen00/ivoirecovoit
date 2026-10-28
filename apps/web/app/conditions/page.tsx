import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Conditions générales d’utilisation' };

/*
 * Texte juridique NON RÉDIGÉ : il doit être écrit et validé par un juriste (droit ivoirien, protection des
 * données personnelles) avant tout lancement public. La version affichée correspond au paramètre legal.*_version.
 */
export default function LegalPage() {
  return (
    <article className="card mx-auto grid max-w-2xl gap-3">
      <h1 className="text-2xl font-bold">Conditions générales d’utilisation</h1>
      <p role="note" className="rounded-[var(--radius-control)] bg-warning-soft px-3 py-2 text-sm">
        Version 0.1-brouillon. Ce document n’est pas encore rédigé : il sera écrit et validé par un juriste avant
        l’ouverture du service au public.
      </p>
    </article>
  );
}
