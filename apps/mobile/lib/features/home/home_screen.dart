import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/config.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import '../places/place_field.dart';
import '../places/places_repository.dart';

/// Écran d'accueil et de recherche. La saisie des lieux fonctionne ;
/// la recherche de trajets sera branchée à l'étape 6.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  Place? _from;
  Place? _to;
  DateTime _date = DateTime.now();
  int _seats = 1;

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _date,
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

    return Scaffold(
      appBar: AppBar(
        title: const Text('IvoireCovoit', style: TextStyle(color: AppColors.brand, fontWeight: FontWeight.bold)),
        actions: [
          IconButton(
            tooltip: 'Mon compte',
            icon: const Icon(Icons.account_circle_outlined),
            onPressed: () => context.push('/compte'),
          ),
          IconButton(
            tooltip: 'État du service',
            icon: const Icon(Icons.monitor_heart_outlined),
            onPressed: () => context.push('/statut'),
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
                child: const Text('Environnement de développement : données de démonstration, aucun paiement réel.',
                    textAlign: TextAlign.center),
              ),
            Text('Voyagez ensemble, partagez les frais.',
                style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold)),
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
                        child: Text('Le départ et l’arrivée doivent être différents.',
                            style: TextStyle(color: AppColors.danger)),
                      ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: _pickDate,
                            icon: const Icon(Icons.calendar_today_outlined),
                            label: Text(DateFormat('EEE d MMM', 'fr').format(_date)),
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
                    const FilledButton(onPressed: null, child: Text('Rechercher')),
                    const SizedBox(height: 6),
                    Text('La recherche de trajets sera disponible à l’étape 6 du développement.',
                        textAlign: TextAlign.center,
                        style: theme.textTheme.bodySmall?.copyWith(color: AppColors.textMuted)),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
