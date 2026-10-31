import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

import '../../core/api_client.dart';
import '../../core/location.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import 'models.dart';
import 'trip_map.dart';

/// Délai minimal entre deux envois de position par le conducteur.
const shareEvery = Duration(seconds: 10);

/// Délai entre deux lectures de la position par le passager.
const followEvery = Duration(seconds: 10);

String _ago(int s) => s < 60 ? 'il y a $s s' : 'il y a ${s ~/ 60} min';

/// Conducteur, trajet en cours : partage de sa position avec les passagers confirmés, tant que l'appli est ouverte.
class ShareLocationCard extends ConsumerStatefulWidget {
  const ShareLocationCard({super.key, required this.tripId});
  final String tripId;

  @override
  ConsumerState<ShareLocationCard> createState() => _ShareLocationCardState();
}

class _ShareLocationCardState extends ConsumerState<ShareLocationCard> {
  StreamSubscription<Position>? _sub;
  DateTime? _lastSent;
  String? _error;
  bool _starting = false;

  bool get _on => _sub != null;

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  Future<void> _toggle(bool on) async {
    if (!on) {
      await _sub?.cancel();
      setState(() => _sub = null);
      return;
    }
    setState(() {
      _starting = true;
      _error = null;
    });
    try {
      final stream = await drivingPositions();
      if (!mounted) return;
      setState(() => _sub = stream.listen(_send, onError: (_) => setState(() => _error = 'Position indisponible.')));
    } on LocationUnavailable catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _starting = false);
    }
  }

  Future<void> _send(Position p) async {
    final now = DateTime.now();
    if (_lastSent != null && now.difference(_lastSent!) < shareEvery) return;
    _lastSent = now;
    try {
      await ref
          .read(apiTripsRepositoryProvider)
          .shareLocation(widget.tripId, lat: p.latitude, lng: p.longitude, accuracyM: p.accuracy, heading: p.heading);
      if (mounted) setState(() => _error = null);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 8, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: _on,
            onChanged: _starting ? null : _toggle,
            title: const Text('Partager ma position', style: TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text(
              _on
                  ? (_lastSent == null
                        ? 'Recherche de la position…'
                        : 'Envoyée ${_ago(DateTime.now().difference(_lastSent!).inSeconds)}.')
                  : 'Vos passagers confirmés vous voient arriver sur la carte.',
            ),
          ),
          const Text(
            'Gardez l’appli ouverte pendant le trajet. Seule la dernière position est gardée, et elle est effacée à la fin du trajet.',
            style: TextStyle(fontSize: 12, color: AppColors.textMuted),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(_error!, style: const TextStyle(color: AppColors.danger)),
            ),
        ],
      ),
    ),
  );
}

/// Passager confirmé, trajet en cours : position du conducteur sur la carte, mise à jour toutes les 10 s.
class LiveTripCard extends ConsumerStatefulWidget {
  const LiveTripCard({super.key, required this.tripId, this.pickup});
  final String tripId;
  final MapPoint? pickup;

  @override
  ConsumerState<LiveTripCard> createState() => _LiveTripCardState();
}

class _LiveTripCardState extends ConsumerState<LiveTripCard> {
  Timer? _timer;
  LiveLocation? _live;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
    _timer = Timer.periodic(followEvery, (_) => _load());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final l = await ref.read(apiTripsRepositoryProvider).liveLocation(widget.tripId);
      if (mounted) setState(() => (_live = l, _error = null));
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = _live;
    final pos = l?.position;
    final note = pos == null
        ? 'Le conducteur n’a pas encore partagé sa position.'
        : l!.stale
        ? 'Dernière position connue ${_ago(l.ageS ?? 0)} : le conducteur n’est peut-être plus connecté.'
        : 'Position partagée par le conducteur ${_ago(l.ageS ?? 0)}.';
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Container(
                  width: 10,
                  height: 10,
                  decoration: BoxDecoration(
                    color: pos != null && !l!.stale ? AppColors.online : AppColors.border,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 8),
                Text('Trajet en cours', style: Theme.of(context).textTheme.titleMedium),
              ],
            ),
            const SizedBox(height: 10),
            TripMap(
              height: 220,
              semanticLabel: 'Carte de la position du conducteur',
              note: _error ?? note,
              points: [if (pos != null) MapPoint(pos, 'Conducteur', PointTone.vehicle), ?widget.pickup],
            ),
          ],
        ),
      ),
    );
  }
}
