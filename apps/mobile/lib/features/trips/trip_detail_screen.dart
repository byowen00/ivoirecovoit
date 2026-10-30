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

/// Écran 6 : détail d'un trajet, choix du segment (montée, descente), prix et places pour ce segment.
class TripDetailScreen extends ConsumerStatefulWidget {
  const TripDetailScreen({super.key, required this.tripId, this.pickupStopId, this.dropoffStopId, this.seats = 1});
  final String tripId;
  final String? pickupStopId;
  final String? dropoffStopId;
  final int seats;

  @override
  ConsumerState<TripDetailScreen> createState() => _TripDetailScreenState();
}

class _TripDetailScreenState extends ConsumerState<TripDetailScreen> {
  TripDetail? _trip;
  String? _error;
  String? _pickup;
  String? _dropoff;
  Availability? _availability;
  int _request = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final t = await ref.read(tripsRepositoryProvider).detail(widget.tripId);
      if (!mounted) return;
      setState(() {
        _trip = t;
        _pickup = t.stops.any((s) => s.id == widget.pickupStopId && s.isPickup)
            ? widget.pickupStopId
            : t.stops.first.id;
        _dropoff = t.stops.any((s) => s.id == widget.dropoffStopId && s.isDropoff)
            ? widget.dropoffStopId
            : t.stops.last.id;
      });
      await _quote();
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => _error = e.status == 404 ? 'Ce trajet n’existe pas ou n’est plus visible.' : e.message);
      }
    }
  }

  int _seq(String? id) => _trip?.stops.where((s) => s.id == id).firstOrNull?.seq ?? 0;
  bool get _validSegment => _seq(_dropoff) > _seq(_pickup);

  Future<void> _quote() async {
    final id = ++_request;
    setState(() => _availability = null);
    if (!_validSegment) return;
    try {
      final a = await ref.read(tripsRepositoryProvider).availability(widget.tripId, _pickup!, _dropoff!);
      if (mounted && id == _request) setState(() => _availability = a);
    } on ApiException {
      // Prix indisponible : l'écran reste utilisable, sans montant.
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = _trip;
    if (_error != null) {
      return Scaffold(
        appBar: AppBar(),
        body: Center(
          child: Padding(padding: const EdgeInsets.all(24), child: Text(_error!)),
        ),
      );
    }
    if (t == null) {
      return Scaffold(
        appBar: AppBar(),
        body: const Center(child: CircularProgressIndicator()),
      );
    }
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(color: AppColors.textMuted);
    final a = _availability;
    final pickupSeq = _seq(_pickup);
    final dropoffSeq = _seq(_dropoff);

    return Scaffold(
      appBar: AppBar(title: Text('${t.stops.first.label} → ${t.stops.last.label}', overflow: TextOverflow.ellipsis)),
      bottomNavigationBar: SafeArea(
        child: Container(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          decoration: const BoxDecoration(
            color: AppColors.surface,
            border: Border(top: BorderSide(color: AppColors.border)),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (a == null)
                      const Text('—', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800))
                    else
                      PriceText(a.unitPriceXof * widget.seats, size: 24),
                    Text(
                      a == null
                          ? 'Calcul du prix…'
                          : '${a.seatsAvailable} place${a.seatsAvailable > 1 ? 's' : ''} libre(s) sur ce segment',
                      style: muted,
                    ),
                  ],
                ),
              ),
              FilledButton(
                onPressed: t.bookable && _validSegment && a != null && a.seatsAvailable >= widget.seats
                    ? () => context.push(
                        '/trajets/${t.id}/reserver?pickup=$_pickup&dropoff=$_dropoff&seats=${widget.seats}',
                      )
                    : null,
                child: Text(
                  !t.bookable
                      ? 'Réservation fermée'
                      : a != null && a.seatsAvailable < widget.seats
                      ? 'Plus assez de places'
                      : 'Réserver',
                ),
              ),
            ],
          ),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('${formatDay(t.departureAt)} · Réf. ${t.publicRef}${t.isDemo ? '  [DEMO]' : ''}', style: muted),
          if (!t.bookable)
            Container(
              margin: const EdgeInsets.only(top: 8),
              padding: const EdgeInsets.all(8),
              color: AppColors.warningSoft,
              child: Text(
                'Trajet ${tripStatusLabel[t.status]?.toLowerCase()}.${t.cancellationReason != null ? ' Motif : ${t.cancellationReason}' : ''}',
              ),
            ),
          const SizedBox(height: 12),
          TripMap(
            semanticLabel: 'Carte de l’itinéraire estimé du trajet',
            route: t.geometry,
            points: [
              for (final (i, s) in t.stops.indexed)
                MapPoint(
                  s.point,
                  '${formatTime(s.plannedAt)} · ${s.label}',
                  i == 0 ? PointTone.origin : (i == t.stops.length - 1 ? PointTone.destination : PointTone.stop),
                ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            '${routeSourceNote(t.routeSource)} ${formatDistance(t.distanceM)}, ${formatDuration(t.durationS)}.'
            '${t.roundedCoordinates ? ' Les points précis sont communiqués aux passagers confirmés.' : ''}',
            style: muted,
          ),
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('Votre trajet', style: theme.textTheme.titleMedium),
                  const SizedBox(height: 8),
                  DropdownButtonFormField<String>(
                    initialValue: _pickup,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Je monte à'),
                    items: [
                      for (final s in t.stops.where((s) => s.isPickup))
                        DropdownMenuItem(
                          value: s.id,
                          child: Text('${formatTime(s.plannedAt)} · ${s.label}', overflow: TextOverflow.ellipsis),
                        ),
                    ],
                    onChanged: (v) {
                      setState(() => _pickup = v);
                      _quote();
                    },
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    initialValue: _dropoff,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Je descends à'),
                    items: [
                      for (final s in t.stops.where((s) => s.isDropoff))
                        DropdownMenuItem(
                          value: s.id,
                          enabled: s.seq > pickupSeq,
                          child: Text('${formatTime(s.plannedAt)} · ${s.label}', overflow: TextOverflow.ellipsis),
                        ),
                    ],
                    onChanged: (v) {
                      setState(() => _dropoff = v);
                      _quote();
                    },
                  ),
                  if (!_validSegment)
                    const Padding(
                      padding: EdgeInsets.only(top: 6),
                      child: Text(
                        'Le point de descente doit venir après le point de montée.',
                        style: TextStyle(color: AppColors.danger),
                      ),
                    ),
                  if (a != null && widget.seats > 1)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Text('${widget.seats} places × ${formatXof(a.unitPriceXof)}', style: muted),
                    ),
                ],
              ),
            ),
          ),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Itinéraire et arrêts', style: theme.textTheme.titleMedium),
                  const SizedBox(height: 14),
                  for (final (i, s) in t.stops.indexed)
                    _StopRow(
                      stop: s,
                      first: i == 0,
                      last: i == t.stops.length - 1,
                      inSegment: _validSegment && s.seq >= pickupSeq && s.seq <= dropoffSeq,
                    ),
                  const SizedBox(height: 6),
                  Text('Heures de passage estimées, susceptibles de varier selon la circulation.', style: muted),
                ],
              ),
            ),
          ),
          if (t.driver case final d?)
            Card(
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                onTap: () => context.push('/conducteurs/${d.id}'),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Avatar(name: d.displayName, url: d.photoUrl, radius: 26),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(d.displayName, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                                Text(
                                  '${d.ratingAvg != null ? '★ ${d.ratingAvg!.toStringAsFixed(1)} · ${d.ratingCount} avis' : 'Pas encore d’avis'} · ${d.completedTrips} trajet(s)',
                                  style: const TextStyle(fontSize: 13, color: AppColors.textMuted),
                                ),
                              ],
                            ),
                          ),
                          const Icon(Icons.chevron_right, color: AppColors.textMuted),
                        ],
                      ),
                      const SizedBox(height: 12),
                      const Pill('Conducteur vérifié', icon: Icons.verified_outlined, tone: PillTone.success),
                    ],
                  ),
                ),
              ),
            ),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Informations pratiques', style: theme.textTheme.titleMedium),
                  const SizedBox(height: 6),
                  Text('Véhicule : ${t.vehicle}${t.plateNumber != null ? ' · ${t.plateNumber}' : ''}'),
                  Text('Bagages : ${luggageLabel[t.luggagePolicy] ?? t.luggagePolicy}'),
                  Text(t.autoAccept ? 'Réservation confirmée immédiatement' : 'Le conducteur accepte chaque demande'),
                  Text('Annulation : ${t.cancellationPolicy}'),
                  if (t.allowsCash) const Text('Paiement en espèces accepté par le conducteur'),
                  if (t.description != null)
                    Padding(padding: const EdgeInsets.only(top: 6), child: Text(t.description!)),
                  if (t.instructions != null) Text('Consignes : ${t.instructions}', style: muted),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Une étape de la frise : heure estimée, repère, lieu et prix depuis le départ.
class _StopRow extends StatelessWidget {
  const _StopRow({required this.stop, required this.first, required this.last, required this.inSegment});
  final TripStop stop;
  final bool first;
  final bool last;
  final bool inSegment;

  @override
  Widget build(BuildContext context) {
    final s = stop;
    final Widget mark = first
        ? const RouteMark.origin(size: 12)
        : last
        ? const RouteMark.destination(size: 12)
        : Container(
            width: 10,
            height: 10,
            decoration: BoxDecoration(color: inSegment ? AppColors.brand : AppColors.border, shape: BoxShape.circle),
          );
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: 56,
            child: Text(
              first ? formatTime(s.plannedAt) : '≈ ${formatTime(s.plannedAt)}',
              style: TextStyle(
                fontFamily: AppTheme.displayFont,
                fontWeight: first ? FontWeight.w800 : FontWeight.w700,
                fontSize: first ? 16 : 14,
                color: first ? AppColors.text : AppColors.textMuted,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
          ),
          SizedBox(
            width: 20,
            child: Column(
              children: [
                Padding(padding: const EdgeInsets.only(top: 4), child: mark),
                if (!last)
                  Expanded(
                    child: Container(
                      width: 2,
                      margin: const EdgeInsets.symmetric(vertical: 3),
                      color: inSegment ? AppColors.brand.withValues(alpha: 0.5) : AppColors.border,
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: last ? 0 : 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(s.label, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                  if (s.meetingPoint != null)
                    Text(s.meetingPoint!, style: const TextStyle(fontSize: 13, color: AppColors.textMuted)),
                  Text(
                    '${s.seq == 0 ? 'Départ' : '${formatXof(s.priceFromOriginXof)} depuis le départ'}${s.approximate ? ' · point approximatif' : ''}',
                    style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Photo de profil (URL signée temporaire) ou initiale.
class Avatar extends StatelessWidget {
  const Avatar({super.key, required this.name, this.url, this.radius = 22});
  final String name;
  final String? url;
  final double radius;
  @override
  Widget build(BuildContext context) => CircleAvatar(
    radius: radius,
    backgroundColor: AppColors.brandSoft,
    foregroundImage: url != null ? NetworkImage(url!) : null,
    child: Text(
      name.isEmpty ? '?' : name.substring(0, 1).toUpperCase(),
      style: const TextStyle(color: AppColors.brandStrong, fontWeight: FontWeight.bold),
    ),
  );
}
