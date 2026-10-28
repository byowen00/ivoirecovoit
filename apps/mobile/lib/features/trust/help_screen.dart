import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/format.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import '../auth/auth_controller.dart';
import 'models.dart';

const _faq = [
  (
    'Comment payer ?',
    'Par Mobile Money (Wave, Orange Money, MTN MoMo, Moov Money). La réservation est confirmée quand l’opérateur a validé le paiement.',
  ),
  (
    'Comment annuler ?',
    'Depuis la réservation, bouton « Annuler ». Le montant remboursé dépend des conditions d’annulation affichées avant de réserver.',
  ),
  (
    'Le conducteur ne vient pas ?',
    'Attendez le délai indiqué, écrivez-lui depuis la réservation, puis ouvrez une réclamation : nous examinons chaque cas.',
  ),
  (
    'Mes coordonnées sont-elles visibles ?',
    'Non : la messagerie masque les numéros et e-mails tant que la réservation n’est pas confirmée.',
  ),
];

/// Écran 16 : aide, numéros d'urgence, mes réclamations et signalements.
class HelpScreen extends ConsumerWidget {
  const HelpScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final signedIn = ref.watch(authControllerProvider).value != null;
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Aide et sécurité')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const EmergencyNumbersCard(),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Voyager en sécurité', style: theme.textTheme.titleMedium),
                  const SizedBox(height: 4),
                  const Text(
                    '• Vérifiez la plaque et le véhicule avant de monter.\n'
                    '• Partagez votre trajet avec un proche depuis la réservation.\n'
                    '• Restez dans la messagerie de l’application avant la confirmation.\n'
                    '• Ne communiquez jamais votre code secret Mobile Money.',
                  ),
                ],
              ),
            ),
          ),
          Card(
            child: Column(
              children: [
                for (final (q, a) in _faq)
                  ExpansionTile(
                    title: Text(q),
                    children: [Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 16), child: Text(a))],
                  ),
              ],
            ),
          ),
          if (signedIn) const _MyCases(),
        ],
      ),
    );
  }
}

class EmergencyNumbersCard extends ConsumerWidget {
  const EmergencyNumbersCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return FutureBuilder<EmergencyNumbers>(
      future: ref.read(trustRepositoryProvider).emergencyNumbers(),
      builder: (context, snap) {
        final n = snap.data;
        return Card(
          color: AppColors.dangerSoft,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Numéros d’urgence', style: Theme.of(context).textTheme.titleMedium),
                if (n == null)
                  Text(snap.hasError ? 'Numéros indisponibles hors connexion.' : 'Chargement…')
                else ...[
                  if (!n.validated)
                    Text(
                      n.notice ?? 'Numéros à confirmer auprès des autorités.',
                      style: const TextStyle(color: AppColors.textMuted),
                    ),
                  for (final e in n.numbers)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(e.label),
                      trailing: TextButton.icon(
                        icon: const Icon(Icons.call),
                        label: Text(e.phone),
                        onPressed: () => launchUrl(Uri(scheme: 'tel', path: e.phone)),
                      ),
                    ),
                ],
              ],
            ),
          ),
        );
      },
    );
  }
}

class _MyCases extends ConsumerWidget {
  const _MyCases();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final repo = ref.read(trustRepositoryProvider);
    final muted = Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textMuted);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Mes réclamations', style: Theme.of(context).textTheme.titleMedium),
            FutureBuilder<List<DisputeSummary>>(
              future: repo.myDisputes(),
              builder: (context, snap) {
                final list = snap.data;
                if (list == null) return const SizedBox(height: 24);
                if (list.isEmpty) {
                  return Text('Aucune. Une réclamation s’ouvre depuis la réservation concernée.', style: muted);
                }
                return Column(
                  children: [
                    for (final d in list)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text('${d.reference} · ${d.reasonLabel}'),
                        subtitle: Text(
                          '${disputeStatusLabel[d.status] ?? d.status} · réservation ${d.bookingReference}',
                        ),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () => context.push('/aide/reclamations/${d.id}'),
                      ),
                  ],
                );
              },
            ),
            const SizedBox(height: 12),
            Text('Mes signalements', style: Theme.of(context).textTheme.titleMedium),
            FutureBuilder<List<MyReport>>(
              future: repo.myReports(),
              builder: (context, snap) {
                final list = snap.data;
                if (list == null) return const SizedBox(height: 24);
                if (list.isEmpty) return Text('Aucun.', style: muted);
                return Column(
                  children: [
                    for (final r in list)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(reportCategoryLabel[r.category] ?? r.category),
                        subtitle: Text('${reportStatusLabel[r.status] ?? r.status} · ${formatDay(r.createdAt)}'),
                      ),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}
