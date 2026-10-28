import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { EmergencyNumbersCard } from './EmergencyNumbersCard';
import { MyCases } from './MyCases';

export const metadata: Metadata = { title: 'Aide et sécurité' };

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Comment payer une réservation ?',
    a: 'Par Mobile Money (Wave, Orange Money, MTN MoMo, Moov Money) depuis la page de la réservation. Vos places restent bloquées quelques minutes le temps du paiement ; sans paiement, la réservation expire et rien n’est débité.',
  },
  {
    q: 'Que se passe-t-il si j’annule ?',
    a: 'Le remboursement dépend de la politique d’annulation affichée avant de réserver et du délai avant le départ. Le montant exact est indiqué avant que vous confirmiez l’annulation. Si le conducteur annule, vous êtes remboursé intégralement.',
  },
  {
    q: 'Quand suis-je remboursé ?',
    a: 'Le remboursement est demandé à l’opérateur sur le numéro qui a payé. Son état est visible dans la réservation et dans « Paiements ». Un remboursement n’est annoncé comme effectué qu’une fois confirmé par l’opérateur.',
  },
  {
    q: 'Le conducteur n’est pas venu, ou le trajet s’est mal passé.',
    a: 'Ouvrez une réclamation depuis la réservation, dans les 7 jours suivant le trajet. L’autre personne peut donner sa version, puis notre équipe décide. Pendant l’examen, les gains du conducteur pour ce trajet sont bloqués.',
  },
  {
    q: 'Puis-je échanger mon numéro avec le conducteur ?',
    a: 'Utilisez la messagerie de la réservation. Les numéros et liens y sont masqués tant que la réservation n’est pas confirmée, pour éviter les arnaques et les paiements hors plateforme.',
  },
  {
    q: 'Les heures affichées sont-elles exactes ?',
    a: 'Non : ce sont des estimations calculées à partir du trajet prévu. Elles peuvent varier selon la circulation. Il n’y a pas de suivi GPS en direct.',
  },
  {
    q: 'Comment fonctionnent les avis ?',
    a: 'Après un trajet effectué, passager et conducteur peuvent se noter. Un avis n’est publié que lorsque les deux ont noté, ou à la fin du délai, pour que personne ne réponde à l’avis de l’autre.',
  },
];

/** Écran 16 : aide, sécurité, réclamations et signalements. */
export default async function HelpPage() {
  const signedIn = (await cookies()).has('ic_signed_in');
  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <div>
        <h1 className="text-2xl font-bold">Aide et sécurité</h1>
        <p className="text-ink-muted">Questions fréquentes, numéros d’urgence et suivi de vos demandes.</p>
      </div>

      <EmergencyNumbersCard />

      <section className="card grid gap-2" aria-labelledby="safety-title">
        <h2 id="safety-title" className="text-lg font-semibold">
          Voyager en sécurité
        </h2>
        <ul className="grid list-disc gap-1 pl-5 text-sm">
          <li>Vérifiez l’immatriculation et le véhicule avant de monter : ils figurent dans la réservation confirmée.</li>
          <li>Partagez votre trajet avec un proche depuis la réservation (lien valable jusqu’après l’arrivée).</li>
          <li>Payez uniquement dans l’application : ne donnez jamais votre code secret Mobile Money à quelqu’un.</li>
          <li>Signalez tout comportement dangereux ou inapproprié : notre équipe examine chaque signalement.</li>
        </ul>
      </section>

      {signedIn ? (
        <MyCases />
      ) : (
        <p className="card text-sm">
          <a href="/connexion?next=/aide" className="font-semibold text-brand">
            Connectez-vous
          </a>{' '}
          pour suivre vos réclamations et signalements.
        </p>
      )}

      <section className="card grid gap-2" aria-labelledby="faq-title">
        <h2 id="faq-title" className="text-lg font-semibold">
          Questions fréquentes
        </h2>
        {FAQ.map((f) => (
          <details key={f.q} className="border-t border-line pt-2 first-of-type:border-t-0 first-of-type:pt-0">
            <summary className="cursor-pointer font-medium">{f.q}</summary>
            <p className="mt-1 text-sm text-ink-muted">{f.a}</p>
          </details>
        ))}
      </section>
    </div>
  );
}
