import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import '../bookings/models.dart';
import '../bookings/widgets.dart';
import 'models.dart';
import 'trip_map.dart';
import 'trips_repository.dart';

const _tabs = [('upcoming', 'À venir'), ('in_progress', 'En cours'), ('past', 'Passés'), ('draft', 'Brouillons')];
const _empty = {
  'upcoming': 'Aucun trajet publié à venir.',
  'in_progress': 'Aucun trajet en cours.',
  'past': 'Aucun trajet passé.',
  'draft': 'Aucun brouillon enregistré.',
};

/// Écran 11 : trajets du conducteur, par onglets.
class MyTripsScreen extends StatelessWidget {
  const MyTripsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: _tabs.length,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Mes trajets'),
          bottom: TabBar(isScrollable: true, tabs: [for (final t in _tabs) Tab(text: t.$2)]),
        ),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: () => context.push('/conducteur/publier'),
          icon: const Icon(Icons.add),
          label: const Text('Publier'),
        ),
        body: TabBarView(children: [for (final t in _tabs) _TripList(status: t.$1)]),
      ),
    );
  }
}

class _TripList extends ConsumerStatefulWidget {
  const _TripList({required this.status});
  final String status;
  @override
  ConsumerState<_TripList> createState() => _TripListState();
}

class _TripListState extends ConsumerState<_TripList> {
  List<MyTrip>? _trips;
  String? _next;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool more = false}) async {
    try {
      final res = await ref.read(apiTripsRepositoryProvider).mine(widget.status, cursor: more ? _next : null);
      if (!mounted) return;
      setState(() {
        _trips = more ? [...?_trips, ...res.trips] : res.trips;
        _next = res.next;
        _error = null;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) {
      return Center(
        child: Padding(padding: const EdgeInsets.all(24), child: Text(_error!)),
      );
    }
    final trips = _trips;
    if (trips == null) return const Center(child: CircularProgressIndicator());
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
        children: [
          if (trips.isEmpty)
            Padding(
              padding: const EdgeInsets.all(24),
              child: Text(_empty[widget.status]!, textAlign: TextAlign.center),
            ),
          for (final t in trips)
            Card(
              child: ListTile(
                title: Text('${t.origin} → ${t.destination}'),
                subtitle: Text(
                  '${formatDay(t.departureAt)} à ${formatTime(t.departureAt)} · ${formatXof(t.priceXof)}\n'
                  '${t.seatsOccupied}/${t.seatsOffered} places réservées · ${t.vehicle}',
                ),
                isThreeLine: true,
                trailing: Chip(label: Text(tripStatusLabel[t.status] ?? t.status)),
                onTap: () async {
                  await context.push('/conducteur/trajets/${t.id}');
                  _load();
                },
              ),
            ),
          if (_next != null) OutlinedButton(onPressed: () => _load(more: true), child: const Text('Voir plus')),
        ],
      ),
    );
  }
}

/// Détail d'un trajet côté conducteur et actions selon son statut.
class ManageTripScreen extends ConsumerStatefulWidget {
  const ManageTripScreen({super.key, required this.tripId});
  final String tripId;
  @override
  ConsumerState<ManageTripScreen> createState() => _ManageTripScreenState();
}

class _ManageTripScreenState extends ConsumerState<ManageTripScreen> {
  ManagedTrip? _trip;
  String? _error;
  bool _busy = false;

  ApiTripsRepository get _repo => ref.read(apiTripsRepositoryProvider);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final t = await _repo.manage(widget.tripId);
      if (mounted) setState(() => _trip = t);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _act(Future<ManagedTrip> Function() fn, String done) async {
    setState(() => _busy = true);
    try {
      final t = await fn();
      if (!mounted) return;
      setState(() => _trip = t);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(done)));
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _cancel() async {
    final reason = await _ask(
      'Motif de l’annulation (visible des passagers, qui seront remboursés intégralement)',
      minLength: 5,
    );
    if (reason != null) await _act(() => _repo.cancel(_trip!.id, reason, newIdempotencyKey()), 'Trajet annulé.');
  }

  Future<void> _editSeats() async {
    final t = _trip!;
    final seats = await showDialog<int>(
      context: context,
      builder: (ctx) => SimpleDialog(
        title: const Text('Places proposées'),
        children: [
          for (var n = 1; n <= t.seatsCapacity; n++)
            SimpleDialogOption(onPressed: n < t.seatsOccupied ? null : () => Navigator.pop(ctx, n), child: Text('$n')),
        ],
      ),
    );
    if (seats == null || seats == t.seatsOffered) return;
    await _act(() => _repo.update(t.id, t.version, {'seatsOffered': seats}), 'Modification enregistrée.');
    // En cas de version périmée (trajet modifié ailleurs), on repart de l'état réel.
    await _load();
  }

  Future<void> _duplicate() async {
    final now = DateTime.now();
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(now.year, now.month, now.day),
      lastDate: now.add(const Duration(days: 90)),
      helpText: 'Dupliquer sur ces dates (14 au maximum)',
    );
    if (picked == null) return;
    final days = picked.end.difference(picked.start).inDays + 1;
    if (days > 14) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('14 dates au maximum.')));
      return;
    }
    final dates = [
      for (var i = 0; i < days; i++) isoDay(DateTime.utc(picked.start.year, picked.start.month, picked.start.day + i)),
    ];
    setState(() => _busy = true);
    try {
      final res = await _repo.duplicate(_trip!.id, dates, true, newIdempotencyKey());
      final ok = res.where((r) => r['tripId'] != null).length;
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              '$ok trajet(s) créé(s)${ok < res.length ? ', ${res.length - ok} refusé(s) (conflit d’horaire ou date invalide)' : ''}.',
            ),
          ),
        );
      }
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Action sur une réservation, puis rechargement du trajet (places, statut).
  Future<void> _bookingAct(Future<Object?> Function() fn, String done) => _act(() async {
    await fn();
    return _repo.manage(widget.tripId);
  }, done);

  Future<void> _noShow(ManagedTrip t, ManagedBooking b) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        content: const Text('Confirmer que ce passager ne s’est pas présenté au point de montée ?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Retour')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Confirmer')),
        ],
      ),
    );
    if (ok == true) {
      await _bookingAct(() => ref.read(bookingsRepositoryProvider).noShow(t.id, b.id), 'Absence enregistrée.');
    }
  }

  Widget _bookingCard(ManagedTrip t, ManagedBooking b) {
    final bookings = ref.read(bookingsRepositoryProvider);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(b.passengerName ?? 'Passager', style: const TextStyle(fontWeight: FontWeight.w600)),
                ),
                BookingStatusChip(status: b.status, driver: true),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              '${b.seats} place${b.seats > 1 ? 's' : ''} · ${b.pickup} → ${b.dropoff}'
              '${b.pickupAt != null ? ' · montée à ${formatTime(b.pickupAt!)}' : ''} · vous recevrez ${formatXof(b.driverNetXof)}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (b.can('canAccept'))
                  FilledButton(
                    onPressed: _busy ? null : () => _bookingAct(() => bookings.accept(b.id), 'Demande acceptée.'),
                    child: const Text('Accepter'),
                  ),
                if (b.can('canReject'))
                  OutlinedButton(
                    onPressed: _busy ? null : () => _bookingAct(() => bookings.reject(b.id), 'Demande refusée.'),
                    child: const Text('Refuser'),
                  ),
                if (b.can('canMarkNoShow'))
                  OutlinedButton(
                    style: OutlinedButton.styleFrom(foregroundColor: AppColors.danger),
                    onPressed: _busy ? null : () => _noShow(t, b),
                    child: const Text('Passager absent'),
                  ),
                OutlinedButton(
                  onPressed: () async {
                    await context.push('/reservations/${b.id}');
                    if (mounted) _load();
                  },
                  child: Text(b.can('canCancel') ? 'Détail et annulation' : 'Détail'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Future<String?> _ask(String label, {int minLength = 1}) {
    final c = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        content: TextField(
          controller: c,
          maxLength: 300,
          maxLines: 2,
          decoration: InputDecoration(labelText: label),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Retour')),
          FilledButton(
            onPressed: () => c.text.trim().length >= minLength ? Navigator.pop(ctx, c.text.trim()) : null,
            child: const Text('Confirmer'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = _trip;
    if (_error != null) {
      return Scaffold(
        appBar: AppBar(),
        body: Center(child: Text(_error!)),
      );
    }
    if (t == null) {
      return Scaffold(
        appBar: AppBar(),
        body: const Center(child: CircularProgressIndicator()),
      );
    }
    final muted = Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textMuted);
    final active = [
      for (final b in t.bookings)
        if (!inactiveBookingStatuses.contains(b.status)) b,
    ];
    final closed = [
      for (final b in t.bookings)
        if (inactiveBookingStatuses.contains(b.status)) b,
    ];
    return Scaffold(
      appBar: AppBar(title: Text('${t.stops.first.label} → ${t.stops.last.label}', overflow: TextOverflow.ellipsis)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            '${formatDay(t.departureAt)} à ${formatTime(t.departureAt)} · ${tripStatusLabel[t.status]} · Réf. ${t.publicRef}${t.isDemo ? '  [DEMO]' : ''}',
          ),
          if (t.cancellationReason != null) Text('Motif d’annulation : ${t.cancellationReason}'),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              if (t.can('canPublish'))
                FilledButton(
                  onPressed: _busy ? null : () => _act(() => _repo.action(t.id, 'publish'), 'Trajet publié.'),
                  child: const Text('Publier'),
                ),
              if (t.can('canStart'))
                FilledButton(
                  onPressed: _busy ? null : () => _act(() => _repo.action(t.id, 'start'), 'Départ enregistré.'),
                  child: const Text('Démarrer'),
                ),
              if (t.can('canComplete'))
                FilledButton(
                  onPressed: _busy ? null : () => _act(() => _repo.action(t.id, 'complete'), 'Trajet terminé.'),
                  child: const Text('Terminer'),
                ),
              if (t.can('canEdit'))
                OutlinedButton(onPressed: _busy ? null : _editSeats, child: const Text('Modifier les places')),
              if (t.can('canDuplicate'))
                OutlinedButton(onPressed: _busy ? null : _duplicate, child: const Text('Dupliquer')),
              if (t.can('canCancel'))
                OutlinedButton(
                  style: OutlinedButton.styleFrom(foregroundColor: AppColors.danger),
                  onPressed: _busy ? null : _cancel,
                  child: const Text('Annuler le trajet'),
                ),
            ],
          ),
          const SizedBox(height: 12),
          TripMap(
            height: 200,
            semanticLabel: 'Carte de l’itinéraire estimé',
            route: t.geometry,
            points: [
              for (final (i, s) in t.stops.indexed)
                MapPoint(
                  s.point,
                  s.label,
                  i == 0 ? PointTone.origin : (i == t.stops.length - 1 ? PointTone.destination : PointTone.stop),
                ),
            ],
          ),
          Text(
            '${formatDistance(t.distanceM)}, ${formatDuration(t.durationS)}. ${routeSourceNote(t.routeSource)}',
            style: muted,
          ),
          Card(
            child: Column(
              children: [
                for (final s in t.stops)
                  ListTile(
                    dense: true,
                    leading: Text(formatTime(s.plannedAt)),
                    title: Text(s.label),
                    subtitle: s.meetingPoint != null ? Text(s.meetingPoint!) : null,
                    trailing: s.seq == 0 ? null : Text(formatXof(s.priceFromOriginXof)),
                  ),
              ],
            ),
          ),
          Card(
            child: ListTile(
              title: Text(t.vehicle),
              subtitle: Text('${t.seatsOccupied} place(s) réservée(s) sur ${t.seatsOffered}'),
            ),
          ),
          const SizedBox(height: 8),
          Text('Passagers', style: Theme.of(context).textTheme.titleMedium),
          if (active.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(t.bookings.isEmpty ? 'Aucune réservation pour l’instant.' : 'Aucune réservation en cours.'),
            ),
          for (final b in active) _bookingCard(t, b),
          if (closed.isNotEmpty)
            ExpansionTile(
              tilePadding: EdgeInsets.zero,
              title: Text('Demandes expirées, refusées ou annulées (${closed.length})', style: muted),
              children: [for (final b in closed) _bookingCard(t, b)],
            ),
        ],
      ),
    );
  }
}
