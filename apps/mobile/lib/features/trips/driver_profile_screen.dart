import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/api_client.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import 'models.dart';
import 'trip_detail_screen.dart';

final publicDriverProvider = FutureProvider.autoDispose.family<PublicDriver, String>(
  (ref, id) => ref.watch(tripsRepositoryProvider).driver(id),
);

const _chat = {'QUIET': 'Plutôt calme', 'SOME': 'Discute selon l’humeur', 'CHATTY': 'Aime discuter'};

/// Écran 7 : profil public d'un conducteur vérifié (aucune coordonnée ni pièce justificative).
class DriverProfileScreen extends ConsumerWidget {
  const DriverProfileScreen({super.key, required this.driverId});
  final String driverId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: const Text('Profil conducteur')),
      body: ref
          .watch(publicDriverProvider(driverId))
          .when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => Center(
              child: Text(
                e is ApiException && e.status == 404
                    ? 'Ce profil n’existe pas ou n’est pas public.'
                    : 'Impossible de charger ce profil.',
              ),
            ),
            data: _Body.new,
          ),
    );
  }
}

class _Body extends StatelessWidget {
  const _Body(this.d);
  final PublicDriver d;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final p = d.preferences;
    final prefs = [
      if (p['music'] is bool) p['music'] == true ? 'Musique' : 'Pas de musique',
      if (p['pets'] is bool) p['pets'] == true ? 'Animaux acceptés' : 'Pas d’animaux',
      if (p['smoking'] is bool) p['smoking'] == true ? 'Fumeur (pauses)' : 'Non-fumeur',
      ?_chat[p['chat']],
    ];
    Widget stat(String v, String label) => Expanded(
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            children: [
              Text(v, style: theme.textTheme.titleLarge),
              Text(label, textAlign: TextAlign.center, style: theme.textTheme.bodySmall),
            ],
          ),
        ),
      ),
    );
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Row(
          children: [
            Avatar(name: d.displayName, url: d.photoUrl, radius: 36),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${d.displayName}${d.isDemo ? '  [DEMO]' : ''}', style: theme.textTheme.titleLarge),
                  Text(
                    '✓ Identité et permis vérifiés${d.verificationLevel >= 2 ? ', véhicule vérifié' : ''}',
                    style: const TextStyle(color: AppColors.success),
                  ),
                  Text(
                    'Membre depuis ${DateFormat('MMMM y', 'fr').format(d.memberSince)}',
                    style: const TextStyle(color: AppColors.textMuted),
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            stat(d.ratingAvg != null ? '★ ${d.ratingAvg!.toStringAsFixed(1)}' : '—', '${d.ratingCount} avis'),
            stat('${d.completedTrips}', 'trajets effectués'),
            stat('${d.upcomingTrips}', 'trajets à venir'),
          ],
        ),
        if (d.bio != null || prefs.isNotEmpty)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('À propos', style: theme.textTheme.titleMedium),
                  if (d.bio != null) Text(d.bio!),
                  const SizedBox(height: 8),
                  Wrap(spacing: 8, runSpacing: 8, children: [for (final x in prefs) Chip(label: Text(x))]),
                ],
              ),
            ),
          ),
        if (d.vehicles.isNotEmpty)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Véhicule', style: theme.textTheme.titleMedium),
                  for (final v in d.vehicles) Text(v),
                ],
              ),
            ),
          ),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Avis des passagers', style: theme.textTheme.titleMedium),
                if (d.reviews.isEmpty)
                  const Text('Pas encore d’avis publié.', style: TextStyle(color: AppColors.textMuted)),
                for (final r in d.reviews)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text('${'★' * r.rating}${'☆' * (5 - r.rating)}  ${r.author ?? 'Passager'}'),
                    subtitle: r.comment != null ? Text(r.comment!) : null,
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
