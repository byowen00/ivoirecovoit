import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import 'models.dart';
import 'trip_map.dart';
import 'trips_repository.dart';

const _sortLabel = {
  'departure': 'Départ le plus tôt',
  'price': 'Prix le plus bas',
  'distance': 'Plus proche',
  'rating': 'Mieux noté',
};

/// Adresse de l'écran de résultats (lien partageable).
String resultsLocation(SearchQuery q) => Uri(
  path: '/recherche',
  queryParameters: {
    'from': q.fromId,
    'fromLabel': q.fromLabel,
    'to': q.toId,
    'toLabel': q.toLabel,
    'seats': '${q.seats}',
    if (q.date != null) 'date': isoDay(q.date!),
  },
).toString();

SearchQuery? queryFromUri(Uri uri) {
  final p = uri.queryParameters;
  if (p['from'] == null || p['to'] == null) return null;
  return SearchQuery(
    fromId: p['from']!,
    fromLabel: p['fromLabel'] ?? 'Départ',
    toId: p['to']!,
    toLabel: p['toLabel'] ?? 'Arrivée',
    date: p['date'] == null ? null : DateTime.tryParse('${p['date']}T00:00:00Z'),
    seats: (int.tryParse(p['seats'] ?? '') ?? 1).clamp(1, 8),
  );
}

/// Écran 5 : résultats en liste ou sur carte, tri et filtres, pagination.
class SearchResultsScreen extends ConsumerStatefulWidget {
  const SearchResultsScreen({super.key, required this.query});
  final SearchQuery query;

  @override
  ConsumerState<SearchResultsScreen> createState() => _SearchResultsScreenState();
}

class _SearchResultsScreenState extends ConsumerState<SearchResultsScreen> {
  late SearchQuery _query = widget.query;
  List<SearchResult>? _results;
  SearchPage? _page;
  String? _error;
  bool _map = false;
  bool _loadingMore = false;
  int _request = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final id = ++_request;
    setState(() {
      _results = null;
      _error = null;
    });
    try {
      final page = await ref.read(tripsRepositoryProvider).search(_query);
      if (!mounted || id != _request) return;
      setState(() {
        _page = page;
        _results = page.results;
      });
    } on ApiException catch (e) {
      if (mounted && id == _request) setState(() => _error = e.message);
    }
  }

  Future<void> _more() async {
    final cursor = _page?.nextCursor;
    if (cursor == null) return;
    setState(() => _loadingMore = true);
    try {
      final page = await ref.read(tripsRepositoryProvider).search(_query, cursor: cursor);
      if (!mounted) return;
      setState(() {
        _page = page;
        _results = [...?_results, ...page.results];
      });
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  Future<void> _filters() async {
    final next = await showModalBottomSheet<SearchQuery>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _FiltersSheet(query: _query),
    );
    if (next != null) {
      _query = next;
      await _load();
    }
  }

  void _open(SearchResult r) => context.push(
    Uri(
      path: '/trajets/${r.tripId}',
      queryParameters: {'pickup': r.pickupStopId, 'dropoff': r.dropoffStopId, 'seats': '${_query.seats}'},
    ).toString(),
  );

  @override
  Widget build(BuildContext context) {
    final results = _results;
    final q = _query;
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('${q.fromLabel} → ${q.toLabel}', overflow: TextOverflow.ellipsis),
            Text(
              '${q.date == null ? 'Toutes dates' : formatDay(q.date!)} · ${q.seats} place${q.seats > 1 ? 's' : ''}',
              style: const TextStyle(fontSize: 13, color: AppColors.textMuted),
            ),
          ],
        ),
        actions: [IconButton(tooltip: 'Filtres et tri', icon: const Icon(Icons.tune), onPressed: _filters)],
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _load,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              SegmentedButton<bool>(
                segments: const [
                  ButtonSegment(value: false, label: Text('Liste'), icon: Icon(Icons.list)),
                  ButtonSegment(value: true, label: Text('Carte'), icon: Icon(Icons.map_outlined)),
                ],
                selected: {_map},
                onSelectionChanged: (s) => setState(() => _map = s.first),
              ),
              const SizedBox(height: 12),
              if (_error != null)
                _Message(
                  text: _error!,
                  action: TextButton(onPressed: _load, child: const Text('Réessayer')),
                )
              else if (results == null)
                for (var i = 0; i < 3; i++) const _Skeleton()
              else if (results.isEmpty)
                _Message(
                  text: q.maxPriceXof != null || q.directOnly
                      ? 'Aucun trajet trouvé. Essayez d’assouplir les filtres.'
                      : q.date != null
                      ? 'Aucun conducteur ne propose ce trajet ce jour-là. Essayez une autre date ou une ville proche.'
                      : 'Aucun trajet à venir sur cet axe pour le moment.',
                )
              else ...[
                if (_map)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: TripMap(
                      height: 320,
                      semanticLabel: 'Carte des points de montée des trajets trouvés',
                      onSelect: (id) => _open(results.firstWhere((r) => r.tripId == id)),
                      points: [
                        MapPoint(_page!.from, 'Départ demandé', PointTone.origin),
                        MapPoint(_page!.to, 'Arrivée demandée', PointTone.destination),
                        for (final r in results)
                          MapPoint(
                            r.pickup,
                            '${r.pickupLabel} · ${formatXof(r.unitPriceXof)}',
                            PointTone.result,
                            id: r.tripId,
                          ),
                      ],
                    ),
                  ),
                Text(
                  '${results.length}${_page?.nextCursor != null ? '+' : ''} trajet${results.length > 1 ? 's' : ''}',
                  style: const TextStyle(color: AppColors.textMuted),
                ),
                for (final r in results) TripResultCard(result: r, onTap: () => _open(r)),
                if (_page?.nextCursor != null)
                  OutlinedButton(
                    onPressed: _loadingMore ? null : _more,
                    child: Text(_loadingMore ? 'Chargement…' : 'Voir plus de trajets'),
                  ),
              ],
              const SizedBox(height: 8),
              const Text(
                'Horaires, distances et durées sont des estimations.',
                style: TextStyle(fontSize: 12, color: AppColors.textMuted),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class TripResultCard extends StatelessWidget {
  const TripResultCard({super.key, required this.result, required this.onTap});
  final SearchResult result;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final r = result;
    final theme = Theme.of(context);
    String? walk(int m) => m < 300 ? null : 'à ${formatDistance(m).replaceFirst('env. ', '')} du point demandé';
    final muted = theme.textTheme.bodySmall?.copyWith(color: AppColors.textMuted);
    return Card(
      margin: const EdgeInsets.only(top: 12),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${formatTime(r.pickupAt)}  ${r.pickupLabel}',
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        if (walk(r.pickupDistanceM) case final w?) Text(w, style: muted),
                        Text(formatDuration(r.durationS), style: muted),
                        Text(
                          '${formatTime(r.dropoffAt)}  ${r.dropoffLabel}',
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        if (walk(r.dropoffDistanceM) case final w?) Text(w, style: muted),
                      ],
                    ),
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        formatXof(r.unitPriceXof),
                        style: theme.textTheme.titleMedium?.copyWith(
                          color: AppColors.brandStrong,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      Text('par place', style: muted),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 12,
                runSpacing: 4,
                children: [
                  Text('${r.driverName} ✓', style: const TextStyle(fontWeight: FontWeight.w500)),
                  Text(
                    r.driverRating != null
                        ? '★ ${r.driverRating!.toStringAsFixed(1)} (${r.driverRatingCount})'
                        : 'Nouveau conducteur',
                    style: muted,
                  ),
                  Text(r.vehicle, style: muted),
                  Text(
                    r.stopsCount == 0 ? 'Direct' : '${r.stopsCount} arrêt${r.stopsCount > 1 ? 's' : ''}',
                    style: muted,
                  ),
                  Text(
                    '${r.seatsAvailable} place${r.seatsAvailable > 1 ? 's' : ''} libre${r.seatsAvailable > 1 ? 's' : ''}',
                    style: muted?.copyWith(color: r.seatsAvailable <= 1 ? AppColors.danger : null),
                  ),
                  if (r.isDemo)
                    Container(
                      color: AppColors.warningSoft,
                      padding: const EdgeInsets.symmetric(horizontal: 4),
                      child: const Text('[DEMO]', style: TextStyle(fontSize: 12)),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _FiltersSheet extends StatefulWidget {
  const _FiltersSheet({required this.query});
  final SearchQuery query;
  @override
  State<_FiltersSheet> createState() => _FiltersSheetState();
}

class _FiltersSheetState extends State<_FiltersSheet> {
  late String _sort = widget.query.sort;
  late bool _direct = widget.query.directOnly;
  late final _price = TextEditingController(text: widget.query.maxPriceXof?.toString() ?? '');

  @override
  void dispose() {
    _price.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Filtres et tri', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _sort,
            decoration: const InputDecoration(labelText: 'Trier par'),
            items: [for (final e in _sortLabel.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
            onChanged: (v) => setState(() => _sort = v ?? 'departure'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _price,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(labelText: 'Prix maximum (FCFA)', hintText: 'Aucun'),
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Trajets directs uniquement'),
            value: _direct,
            onChanged: (v) => setState(() => _direct = v),
          ),
          FilledButton(
            onPressed: () {
              final price = int.tryParse(_price.text.replaceAll(RegExp(r'\D'), ''));
              Navigator.pop(
                context,
                widget.query.copyWith(
                  sort: _sort,
                  directOnly: _direct,
                  maxPriceXof: price,
                  clearMaxPrice: price == null || price <= 0,
                ),
              );
            },
            child: const Text('Appliquer'),
          ),
        ],
      ),
    );
  }
}

class _Skeleton extends StatelessWidget {
  const _Skeleton();
  @override
  Widget build(BuildContext context) => Card(
    margin: const EdgeInsets.only(top: 12),
    child: Padding(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final w in [0.7, 0.5, 0.9])
            FractionallySizedBox(
              widthFactor: w,
              child: Container(height: 14, margin: const EdgeInsets.symmetric(vertical: 4), color: AppColors.border),
            ),
        ],
      ),
    ),
  );
}

class _Message extends StatelessWidget {
  const _Message({required this.text, this.action});
  final String text;
  final Widget? action;
  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        children: [
          Text(text, textAlign: TextAlign.center),
          ?action,
        ],
      ),
    ),
  );
}
