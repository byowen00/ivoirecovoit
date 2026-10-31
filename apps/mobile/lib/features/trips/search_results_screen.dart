import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
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
    if (q.fromPosition) ...{'fromLat': '${q.fromLat}', 'fromLng': '${q.fromLng}'} else 'from': q.fromId,
    'fromLabel': q.fromLabel,
    'to': q.toId,
    'toLabel': q.toLabel,
    'seats': '${q.seats}',
    if (q.date != null) 'date': isoDay(q.date!),
    'timeFrom': ?q.timeFrom,
    'timeTo': ?q.timeTo,
  },
).toString();

SearchQuery? queryFromUri(Uri uri) {
  final p = uri.queryParameters;
  final lat = double.tryParse(p['fromLat'] ?? '');
  final lng = double.tryParse(p['fromLng'] ?? '');
  final position = lat != null && lng != null;
  if ((p['from'] == null && !position) || p['to'] == null) return null;
  final hhmm = RegExp(r'^\d{2}:\d{2}$');
  return SearchQuery(
    fromId: position ? '' : p['from']!,
    fromLat: position ? lat : null,
    fromLng: position ? lng : null,
    timeFrom: hhmm.hasMatch(p['timeFrom'] ?? '') ? p['timeFrom'] : null,
    timeTo: hhmm.hasMatch(p['timeTo'] ?? '') ? p['timeTo'] : null,
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
              '${q.date == null ? 'Toutes dates' : formatDay(q.date!)}'
              '${q.timeFrom != null && q.timeTo != null ? ', ${q.timeFrom}–${q.timeTo}' : ''}'
              ' · ${q.seats} place${q.seats > 1 ? 's' : ''}',
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
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    for (final (sort, label) in const [
                      ('departure', 'Plus tôt'),
                      ('price', 'Moins cher'),
                      ('rating', 'Mieux noté'),
                    ]) ...[
                      ChoiceButton(
                        label: label,
                        selected: q.sort == sort,
                        onTap: () {
                          if (q.sort == sort) return;
                          _query = q.copyWith(sort: sort);
                          _load();
                        },
                      ),
                      const SizedBox(width: 8),
                    ],
                    ChoiceButton(
                      label: _map ? 'Liste' : 'Carte',
                      icon: _map ? Icons.list : Icons.map_outlined,
                      selected: false,
                      onTap: () => setState(() => _map = !_map),
                    ),
                  ],
                ),
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
                      : q.timeFrom != null
                      ? 'Aucun départ dans les prochaines heures. Essayez « Aujourd’hui » ou « Demain ».'
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
    String? walk(int m) => m < 300 ? null : 'à ${formatDistance(m).replaceFirst('env. ', '')} du point demandé';
    const muted = TextStyle(fontSize: 12, color: AppColors.textMuted);
    const time = TextStyle(
      fontFamily: AppTheme.displayFont,
      fontWeight: FontWeight.w800,
      fontSize: 17,
      fontFeatures: [FontFeature.tabularFigures()],
    );
    const place = TextStyle(fontSize: 15, fontWeight: FontWeight.w600);
    return Card(
      margin: const EdgeInsets.only(top: 12),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Column(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(formatTime(r.pickupAt), style: time),
                        Text(formatTime(r.dropoffAt), style: time.copyWith(color: AppColors.textMuted)),
                      ],
                    ),
                    const SizedBox(width: 12),
                    const RouteLine(),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(r.pickupLabel, style: place, maxLines: 2, overflow: TextOverflow.ellipsis),
                          if (walk(r.pickupDistanceM) case final w?) Text(w, style: muted),
                          const SizedBox(height: 14),
                          Text(r.dropoffLabel, style: place, maxLines: 2, overflow: TextOverflow.ellipsis),
                          if (walk(r.dropoffDistanceM) case final w?) Text(w, style: muted),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        PriceText(r.unitPriceXof, size: 18),
                        const Text('par place', style: muted),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Durée estimée ${formatDuration(r.durationS)} · '
                '${r.stopsCount == 0 ? 'direct' : '${r.stopsCount} arrêt${r.stopsCount > 1 ? 's' : ''}'} · ${r.vehicle}',
                style: muted,
              ),
              const Padding(padding: EdgeInsets.symmetric(vertical: 12), child: Divider(height: 1)),
              Row(
                children: [
                  CircleAvatar(
                    radius: 18,
                    backgroundColor: AppColors.brandSoft,
                    child: Text(
                      r.driverName.isEmpty ? '?' : r.driverName.substring(0, 1).toUpperCase(),
                      style: const TextStyle(color: Color(0xFF8A3C05), fontWeight: FontWeight.w700),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          r.driverName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
                        ),
                        Text(
                          r.driverRating != null
                              ? '★ ${r.driverRating!.toStringAsFixed(1)} (${r.driverRatingCount})'
                              : 'Nouveau conducteur',
                          style: muted,
                        ),
                      ],
                    ),
                  ),
                  Wrap(
                    spacing: 6,
                    runSpacing: 4,
                    alignment: WrapAlignment.end,
                    children: [
                      const Pill('Vérifié', tone: PillTone.success),
                      Pill(
                        '${r.seatsAvailable} place${r.seatsAvailable > 1 ? 's' : ''}',
                        tone: r.seatsAvailable <= 1 ? PillTone.brand : PillTone.neutral,
                      ),
                      if (r.isDemo) const Pill('[DEMO]', tone: PillTone.warning),
                    ],
                  ),
                ],
              ),
              if (r.autoAccept)
                const Padding(
                  padding: EdgeInsets.only(top: 10),
                  child: Pill('Réservation immédiate', icon: Icons.bolt, tone: PillTone.brand),
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
