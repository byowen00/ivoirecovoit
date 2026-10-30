import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/config.dart';
import '../../core/theme.dart';
import '../trust/notifications_screen.dart';
import '../../providers.dart';
import '../places/place_field.dart';
import '../places/places_repository.dart';
import '../auth/auth_controller.dart';
import '../trips/models.dart';
import '../trips/search_results_screen.dart';
import '../trips/trips_repository.dart';

final popularRoutesProvider = FutureProvider.autoDispose<List<PopularRoute>>(
  (ref) => ref.watch(tripsRepositoryProvider).popularRoutes().catchError((_) => <PopularRoute>[]),
);

/// Écran 4 : accueil et recherche, axes populaires, accès à l'espace conducteur.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  Place? _from;
  Place? _to;
  DateTime? _date = DateTime.now();
  int _seats = 1;
  String? _error;

  void _search() {
    if (_from == null || _to == null) {
      setState(() => _error = 'Choisissez le départ et l’arrivée dans la liste des suggestions.');
      return;
    }
    if (_from!.id == _to!.id) return;
    setState(() => _error = null);
    final d = _date;
    context.push(
      resultsLocation(
        SearchQuery(
          fromId: _from!.id,
          fromLabel: _from!.label,
          toId: _to!.id,
          toLabel: _to!.label,
          date: d == null ? null : DateTime.utc(d.year, d.month, d.day),
          seats: _seats,
        ),
      ),
    );
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _date ?? now,
      firstDate: DateTime(now.year, now.month, now.day),
      lastDate: now.add(const Duration(days: 90)),
    );
    if (picked != null) setState(() => _date = picked);
  }

  @override
  Widget build(BuildContext context) {
    final repo = ref.watch(placesRepositoryProvider);
    final theme = Theme.of(context);
    final samePlace = _from != null && _to != null && _from!.id == _to!.id;
    final signedIn = ref.watch(authControllerProvider).value != null;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.night,
        foregroundColor: Colors.white,
        title: const Text.rich(
          TextSpan(
            text: 'Ivoire',
            children: [TextSpan(text: 'Covoit', style: TextStyle(color: AppColors.accent))],
          ),
          style: TextStyle(fontFamily: AppTheme.displayFont, fontWeight: FontWeight.w800, fontSize: 22, color: Colors.white),
        ),
        actions: [
          if (signedIn) const NotificationBell(),
          IconButton(
            tooltip: 'Aide et urgence',
            icon: const Icon(Icons.help_outline),
            onPressed: () => context.push('/aide'),
          ),
          IconButton(
            tooltip: 'État du service',
            icon: const Icon(Icons.monitor_heart_outlined),
            onPressed: () => context.push('/statut'),
          ),
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: IconButton(
              tooltip: signedIn ? 'Mon compte (connecté)' : 'Se connecter',
              onPressed: () => context.push('/compte'),
              icon: Stack(
                clipBehavior: Clip.none,
                children: [
                  CircleAvatar(
                    radius: 16,
                    backgroundColor: signedIn ? AppColors.accent : Colors.white24,
                    foregroundColor: AppColors.night,
                    child: Icon(Icons.person, size: 20, color: signedIn ? AppColors.night : Colors.white),
                  ),
                  if (signedIn)
                    Positioned(
                      right: -1,
                      bottom: -1,
                      child: Container(
                        key: const Key('online-dot'),
                        width: 12,
                        height: 12,
                        decoration: BoxDecoration(
                          color: AppColors.online,
                          shape: BoxShape.circle,
                          border: Border.all(color: AppColors.night, width: 2),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (!AppConfig.isProduction)
              Container(
                padding: const EdgeInsets.all(8),
                margin: const EdgeInsets.only(bottom: 12),
                decoration: BoxDecoration(color: AppColors.warningSoft, borderRadius: BorderRadius.circular(8)),
                child: const Text(
                  'Environnement de développement : données de démonstration, aucun paiement réel.',
                  textAlign: TextAlign.center,
                ),
              ),
            Text(
              'Voyagez ensemble, partagez les frais.',
              style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 16),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    PlaceField(label: 'Départ', repository: repo, onSelected: (p) => setState(() => _from = p)),
                    const SizedBox(height: 12),
                    PlaceField(label: 'Arrivée', repository: repo, onSelected: (p) => setState(() => _to = p)),
                    if (samePlace)
                      const Padding(
                        padding: EdgeInsets.only(top: 4),
                        child: Text(
                          'Le départ et l’arrivée doivent être différents.',
                          style: TextStyle(color: AppColors.danger),
                        ),
                      ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: _pickDate,
                            icon: const Icon(Icons.calendar_today_outlined),
                            label: Text(_date == null ? 'Toutes dates' : DateFormat('EEE d MMM', 'fr').format(_date!)),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: DropdownButtonFormField<int>(
                            initialValue: _seats,
                            decoration: const InputDecoration(labelText: 'Places'),
                            items: [
                              for (final n in [1, 2, 3, 4])
                                DropdownMenuItem(value: n, child: Text('$n ${n > 1 ? 'places' : 'place'}')),
                            ],
                            onChanged: (n) => setState(() => _seats = n ?? 1),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    if (_error != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Text(_error!, style: const TextStyle(color: AppColors.danger)),
                      ),
                    FilledButton(onPressed: samePlace ? null : _search, child: const Text('Rechercher')),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text('Trajets populaires', style: theme.textTheme.titleSmall?.copyWith(color: AppColors.textMuted)),
            const SizedBox(height: 8),
            ref
                .watch(popularRoutesProvider)
                .when(
                  loading: () => const LinearProgressIndicator(),
                  error: (_, _) => const SizedBox.shrink(),
                  data: (routes) => Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final r in routes)
                        ActionChip(
                          backgroundColor: AppColors.brandSoft,
                          label: Text(
                            '${r.fromLabel} → ${r.toLabel} · ${r.upcomingTrips == 0 ? 'aucun trajet' : '${r.upcomingTrips} trajet${r.upcomingTrips > 1 ? 's' : ''}'}',
                          ),
                          onPressed: () => context.push(
                            resultsLocation(
                              SearchQuery(fromId: r.fromId, fromLabel: r.fromLabel, toId: r.toId, toLabel: r.toLabel),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
            const SizedBox(height: 16),
            Card(
              child: ListTile(
                leading: const Icon(Icons.event_seat_outlined),
                title: const Text('Mes réservations'),
                subtitle: Text(
                  ref.watch(authControllerProvider).value != null
                      ? 'Vos demandes et réservations à venir ou passées.'
                      : 'Connectez-vous pour retrouver vos réservations ici.',
                ),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push('/reservations'),
              ),
            ),
            Card(
              child: ListTile(
                leading: const Icon(Icons.receipt_long_outlined),
                title: const Text('Historique des paiements'),
                subtitle: const Text('Paiements, remboursements et gains de conducteur.'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push('/paiements'),
              ),
            ),
            Card(
              child: ListTile(
                leading: const Icon(Icons.directions_car_outlined),
                title: const Text('Vous conduisez ?'),
                subtitle: const Text('Proposez vos places libres et partagez les frais de route.'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push('/conducteur'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
