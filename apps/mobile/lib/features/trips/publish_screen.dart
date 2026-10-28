import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import '../driver/driver_repository.dart';
import '../places/place_field.dart';
import 'models.dart';
import 'trip_draft.dart';
import 'trip_map.dart';
import 'trips_repository.dart';

const _steps = ['Itinéraire', 'Véhicule', 'Prix', 'Vérification'];

/// Écran 10 : publication d'un trajet en 4 étapes, brouillon conservé sur l'appareil.
class PublishScreen extends ConsumerStatefulWidget {
  const PublishScreen({super.key});
  @override
  ConsumerState<PublishScreen> createState() => _PublishScreenState();
}

class _PublishScreenState extends ConsumerState<PublishScreen> {
  late TripDraft _d;
  bool _restored = false;
  String? _blocked;
  List<Vehicle>? _vehicles;
  List<String> _errors = const [];
  TripPreview? _preview;
  String? _previewError;
  bool _busy = false;
  Timer? _debounce;
  int _previewSeq = 0;
  late final _fullPrice = TextEditingController();

  @override
  void initState() {
    super.initState();
    final prefs = ref.read(sharedPreferencesProvider);
    final saved = loadDraft(prefs);
    _restored = saved != null && (saved.step > 1 || saved.origin != null);
    _d = saved ?? _empty();
    _fullPrice.text = _d.stopPrices.isNotEmpty ? '${_d.stopPrices.last}' : '';
    _loadDriver();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _fullPrice.dispose();
    super.dispose();
  }

  TripDraft _empty() {
    final tomorrow = DateTime.now().toUtc().add(const Duration(days: 1));
    return TripDraft(
      idempotencyKey: newIdempotencyKey(),
      departure: DateTime.utc(tomorrow.year, tomorrow.month, tomorrow.day, 7),
    );
  }

  Future<void> _loadDriver() async {
    final repo = ref.read(driverRepositoryProvider);
    try {
      final p = await repo.me();
      if (p == null || !p.canPublish) {
        setState(
          () => _blocked = 'Votre profil conducteur et au moins un véhicule doivent être validés avant de publier.',
        );
        return;
      }
      final vehicles = (await repo.vehicles()).where((v) => v.status == 'APPROVED' && v.isActive).toList();
      if (!mounted) return;
      setState(() {
        _vehicles = vehicles;
        if (_d.vehicleId == null && vehicles.length == 1) {
          _d.vehicleId = vehicles.first.id;
          _d.seats = _d.seats.clamp(1, vehicles.first.seatsCapacity);
        }
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _blocked = e.status == 401 ? 'Connectez-vous pour publier un trajet.' : e.message);
    }
  }

  void _change(void Function() fn, {bool route = false}) {
    setState(() {
      fn();
      if (route) {
        _d.stopPrices = [];
        _preview = null;
      }
    });
    saveDraft(ref.read(sharedPreferencesProvider), _d);
  }

  void _go(int step) {
    if (step > _d.step) {
      final e = _d.errors(_d.step);
      setState(() => _errors = e);
      if (e.isNotEmpty) return;
    }
    _change(() {
      _errors = const [];
      _d.step = step;
    });
    if (step == 3) {
      _runPreview(
        _d.stopPrices.length == _d.points.length ? {'stopPricesXof': _d.stopPrices} : {},
        adopt: _d.stopPrices.length != _d.points.length,
      );
    }
  }

  Future<void> _runPreview(Map<String, Object?> price, {required bool adopt}) async {
    final seq = ++_previewSeq;
    try {
      final p = await ref.read(apiTripsRepositoryProvider).preview({
        'kind': _d.kind,
        'departureAt': _d.departure.toUtc().toIso8601String(),
        'stops': [
          for (final p in _d.points) {'placeId': p.id},
        ],
        'vehicleId': ?_d.vehicleId,
        ...price,
      });
      if (!mounted || seq != _previewSeq) return;
      setState(() {
        _preview = p;
        _previewError = null;
      });
      if (adopt) {
        _change(() => _d.stopPrices = p.stopPrices);
        _fullPrice.text = '${p.stopPrices.last}';
      }
    } on ApiException catch (e) {
      if (mounted && seq == _previewSeq) setState(() => _previewError = e.message);
    }
  }

  void _later(VoidCallback fn) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), fn);
  }

  Future<void> _create(bool publish) async {
    setState(() {
      _busy = true;
      _errors = const [];
    });
    try {
      final key = publish ? _d.idempotencyKey : '${_d.idempotencyKey.substring(0, 30)}-draft';
      final trip = await ref.read(apiTripsRepositoryProvider).create({
        'vehicleId': _d.vehicleId,
        'kind': _d.kind,
        'departureAt': _d.departure.toUtc().toIso8601String(),
        'stops': [
          for (final (i, p) in _d.points.indexed)
            {'placeId': p.id, if (i == 0 && _d.meetingPoint.trim().isNotEmpty) 'meetingPoint': _d.meetingPoint.trim()},
        ],
        'pricePerSeatXof': _d.stopPrices.last,
        'stopPricesXof': _d.stopPrices,
        'seatsOffered': _d.seats,
        'acceptanceMode': _d.autoAccept ? 'AUTO' : 'MANUAL',
        'allowsCash': _d.allowsCash,
        'luggagePolicy': _d.luggagePolicy,
        if (_d.description.trim().isNotEmpty) 'description': _d.description.trim(),
        'publish': publish,
      }, key);
      await clearDraft(ref.read(sharedPreferencesProvider));
      if (mounted) context.pushReplacement('/conducteur/trajets/${trip.id}');
    } on ApiException catch (e) {
      if (mounted) setState(() => _errors = [e.message]);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_blocked != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Publier un trajet')),
        body: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              Text(_blocked!),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () => context.pushReplacement('/conducteur'),
                child: const Text('Aller à l’espace conducteur'),
              ),
            ],
          ),
        ),
      );
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Publier un trajet')),
      bottomNavigationBar: _d.step < 4
          ? SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  children: [
                    OutlinedButton(
                      onPressed: _d.step == 1 ? null : () => _go(_d.step - 1),
                      child: const Text('Retour'),
                    ),
                    const Spacer(),
                    FilledButton(onPressed: () => _go(_d.step + 1), child: const Text('Continuer')),
                  ],
                ),
              ),
            )
          : null,
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Row(
            children: [
              for (final (i, label) in _steps.indexed)
                Expanded(
                  child: Container(
                    margin: const EdgeInsets.only(right: 4),
                    padding: const EdgeInsets.only(top: 4),
                    decoration: BoxDecoration(
                      border: Border(
                        top: BorderSide(width: 4, color: _d.step > i ? AppColors.brand : AppColors.border),
                      ),
                    ),
                    child: Text(
                      '${i + 1}. $label',
                      style: TextStyle(fontSize: 12, color: _d.step > i ? AppColors.text : AppColors.textMuted),
                      semanticsLabel: 'Étape ${i + 1} sur 4 : $label${_d.step == i + 1 ? ', en cours' : ''}',
                    ),
                  ),
                ),
            ],
          ),
          if (_restored)
            Container(
              margin: const EdgeInsets.only(top: 12),
              padding: const EdgeInsets.symmetric(horizontal: 12),
              color: AppColors.brandSoft,
              child: Row(
                children: [
                  const Expanded(child: Text('Brouillon retrouvé sur cet appareil.')),
                  TextButton(
                    onPressed: () async {
                      await clearDraft(ref.read(sharedPreferencesProvider));
                      setState(() {
                        _d = _empty();
                        _restored = false;
                        _preview = null;
                        _fullPrice.clear();
                      });
                      _loadDriver();
                    },
                    child: const Text('Recommencer'),
                  ),
                ],
              ),
            ),
          const SizedBox(height: 12),
          switch (_d.step) {
            1 => _routeStep(),
            2 => _vehicleStep(),
            3 => _priceStep(),
            _ => _reviewStep(),
          },
          for (final e in _errors)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(e, style: const TextStyle(color: AppColors.danger)),
            ),
          const SizedBox(height: 8),
          const Text(
            'Le brouillon est conservé 14 jours sur cet appareil uniquement.',
            style: TextStyle(fontSize: 12, color: AppColors.textMuted),
          ),
        ],
      ),
    );
  }

  Widget _routeStep() {
    final repo = ref.read(placesRepositoryProvider);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(value: 'INTERCITY', label: Text('Entre villes')),
            ButtonSegment(value: 'URBAN', label: Text('En ville')),
          ],
          selected: {_d.kind},
          onSelectionChanged: (s) => _change(() => _d.kind = s.first, route: true),
        ),
        const SizedBox(height: 12),
        PlaceField(
          label: 'Départ',
          repository: repo,
          initial: _d.origin,
          onSelected: (p) => _change(() => _d.origin = p, route: true),
        ),
        const SizedBox(height: 8),
        TextFormField(
          initialValue: _d.meetingPoint,
          maxLength: 200,
          decoration: const InputDecoration(labelText: 'Point de rendez-vous au départ (facultatif)'),
          onChanged: (v) => _change(() => _d.meetingPoint = v),
        ),
        for (final (i, s) in _d.stops.indexed)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: PlaceField(
                    key: ValueKey('stop-$i-${_d.stops.length}'),
                    label: 'Arrêt ${i + 1}',
                    repository: repo,
                    initial: s,
                    onSelected: (p) => _change(() => _d.stops[i] = p, route: true),
                  ),
                ),
                IconButton(
                  tooltip: 'Retirer l’arrêt ${i + 1}',
                  icon: const Icon(Icons.close),
                  onPressed: () => _change(() => _d.stops.removeAt(i), route: true),
                ),
              ],
            ),
          ),
        if (_d.stops.length < 5)
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: () => _change(() => _d.stops.add(null), route: true),
              icon: const Icon(Icons.add),
              label: const Text('Ajouter un arrêt intermédiaire'),
            ),
          ),
        PlaceField(
          label: 'Arrivée',
          repository: repo,
          initial: _d.destination,
          onSelected: (p) => _change(() => _d.destination = p, route: true),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                icon: const Icon(Icons.calendar_today_outlined),
                label: Text(formatDay(_d.departure)),
                onPressed: () async {
                  final now = DateTime.now();
                  final picked = await showDatePicker(
                    context: context,
                    initialDate: _d.departure.isBefore(now) ? now : _d.departure,
                    firstDate: DateTime(now.year, now.month, now.day),
                    lastDate: now.add(const Duration(days: 90)),
                  );
                  if (picked != null) {
                    _change(
                      () => _d.departure = DateTime.utc(
                        picked.year,
                        picked.month,
                        picked.day,
                        _d.departure.hour,
                        _d.departure.minute,
                      ),
                      route: true,
                    );
                  }
                },
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: OutlinedButton.icon(
                icon: const Icon(Icons.schedule),
                label: Text('${formatTime(_d.departure)} (Abidjan)'),
                onPressed: () async {
                  final picked = await showTimePicker(
                    context: context,
                    initialTime: TimeOfDay(hour: _d.departure.hour, minute: _d.departure.minute),
                  );
                  if (picked != null) {
                    final d = _d.departure;
                    _change(
                      () => _d.departure = DateTime.utc(d.year, d.month, d.day, picked.hour, picked.minute),
                      route: true,
                    );
                  }
                },
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _vehicleStep() {
    final vehicles = _vehicles;
    if (vehicles == null) return const Center(child: CircularProgressIndicator());
    final vehicle = vehicles.where((v) => v.id == _d.vehicleId).firstOrNull;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        DropdownButtonFormField<String>(
          initialValue: vehicle?.id,
          isExpanded: true,
          decoration: const InputDecoration(labelText: 'Véhicule'),
          items: [
            for (final v in vehicles)
              DropdownMenuItem(value: v.id, child: Text('${v.make} ${v.model} · ${v.plateNumber}')),
          ],
          onChanged: (id) => _change(() {
            _d.vehicleId = id;
            final v = vehicles.firstWhere((x) => x.id == id);
            _d.seats = _d.seats.clamp(1, v.seatsCapacity);
          }),
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<int>(
          key: ValueKey('seats-${vehicle?.id}'),
          initialValue: _d.seats,
          decoration: const InputDecoration(labelText: 'Places proposées'),
          items: [
            for (var n = 1; n <= (vehicle?.seatsCapacity ?? 8); n++) DropdownMenuItem(value: n, child: Text('$n')),
          ],
          onChanged: (n) => _change(() => _d.seats = n ?? 1),
        ),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('Accepter les réservations automatiquement'),
          subtitle: const Text('Sinon, vous acceptez chaque demande vous-même.'),
          value: _d.autoAccept,
          onChanged: (v) => _change(() => _d.autoAccept = v),
        ),
        DropdownButtonFormField<String>(
          initialValue: _d.luggagePolicy,
          decoration: const InputDecoration(labelText: 'Bagages acceptés'),
          items: [for (final e in luggageLabel.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
          onChanged: (v) => _change(() => _d.luggagePolicy = v ?? 'MEDIUM'),
        ),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('J’accepte aussi le paiement en espèces'),
          value: _d.allowsCash,
          onChanged: (v) => _change(() => _d.allowsCash = v),
        ),
        TextFormField(
          initialValue: _d.description,
          maxLength: 1000,
          maxLines: 3,
          decoration: const InputDecoration(labelText: 'Description (facultatif)'),
          onChanged: (v) => _change(() => _d.description = v),
        ),
      ],
    );
  }

  Widget _priceStep() {
    final p = _preview;
    if (p == null) {
      return _previewError != null
          ? Text(_previewError!, style: const TextStyle(color: AppColors.danger))
          : const Center(child: CircularProgressIndicator());
    }
    final labels = _d.points.map((x) => x.label).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TripMap(
          height: 200,
          semanticLabel: 'Aperçu de l’itinéraire estimé',
          route: p.geometry,
          points: [
            for (final (i, pt) in p.stopPoints.indexed)
              MapPoint(
                pt,
                labels[i],
                i == 0 ? PointTone.origin : (i == p.stopPoints.length - 1 ? PointTone.destination : PointTone.stop),
              ),
          ],
        ),
        Text(
          '${formatDistance(p.distanceM)}, ${formatDuration(p.durationS)} · arrivée estimée vers ${formatTime(p.arrivalAt)}. ${routeSourceNote(p.routeSource)}',
          style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
        ),
        const SizedBox(height: 12),
        Text(
          'Prix suggéré : ${formatXof(p.suggestedPriceXof)} par place. Fourchette autorisée : ${formatXof(p.minXof)} à ${formatXof(p.maxXof)}.',
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _fullPrice,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(
            labelText: 'Prix par place, trajet complet (FCFA)',
            helperText: 'Multiple de 50 FCFA, réparti selon la distance.',
          ),
          onChanged: (v) {
            final n = int.tryParse(v.replaceAll(RegExp(r'\D'), ''));
            if (n != null) _later(() => _runPreview({'pricePerSeatXof': n}, adopt: true));
          },
        ),
        for (var i = 1; i < labels.length - 1; i++)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: TextFormField(
              key: ValueKey('price-$i-${_d.stopPrices.join(',')}'),
              initialValue: i < _d.stopPrices.length ? '${_d.stopPrices[i]}' : '',
              keyboardType: TextInputType.number,
              decoration: InputDecoration(labelText: 'Prix jusqu’à ${labels[i]} (FCFA)'),
              onChanged: (v) {
                final n = int.tryParse(v.replaceAll(RegExp(r'\D'), ''));
                if (n == null || i >= _d.stopPrices.length) return;
                _d.stopPrices[i] = n;
                saveDraft(ref.read(sharedPreferencesProvider), _d);
                _later(() => _runPreview({'stopPricesXof': _d.stopPrices}, adopt: false));
              },
            ),
          ),
        for (final pr in p.problems)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              priceProblemText(pr, labels, p.minXof, p.maxXof),
              style: const TextStyle(color: AppColors.danger),
            ),
          ),
      ],
    );
  }

  Widget _reviewStep() {
    final vehicle = _vehicles?.where((v) => v.id == _d.vehicleId).firstOrNull;
    final problems = _d.errors(3);
    Widget row(String label, String value, int step) => ListTile(
      contentPadding: EdgeInsets.zero,
      title: Text(label, style: const TextStyle(fontSize: 13, color: AppColors.textMuted)),
      subtitle: Text(value, style: const TextStyle(color: AppColors.text, fontSize: 15)),
      trailing: TextButton(onPressed: () => _go(step), child: const Text('Modifier')),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        row(
          'Itinéraire',
          [
            for (final (i, p) in _d.points.indexed)
              i == 0 || i >= _d.stopPrices.length ? p.label : '${p.label} (${formatXof(_d.stopPrices[i])})',
          ].join(' → '),
          1,
        ),
        row('Départ', '${formatDay(_d.departure)} à ${formatTime(_d.departure)}', 1),
        row(
          'Véhicule et places',
          '${vehicle != null ? '${vehicle.make} ${vehicle.model}' : '—'} · ${_d.seats} place(s) · ${_d.autoAccept ? 'acceptation automatique' : 'acceptation manuelle'}',
          2,
        ),
        row('Prix par place (trajet complet)', _d.stopPrices.isEmpty ? '—' : formatXof(_d.stopPrices.last), 3),
        for (final e in problems) Text(e, style: const TextStyle(color: AppColors.danger)),
        const SizedBox(height: 12),
        FilledButton(
          onPressed: _busy || problems.isNotEmpty ? null : () => _create(true),
          child: Text(_busy ? 'Envoi…' : 'Publier le trajet'),
        ),
        const SizedBox(height: 8),
        OutlinedButton(
          onPressed: _busy || problems.isNotEmpty ? null : () => _create(false),
          child: const Text('Enregistrer comme brouillon'),
        ),
      ],
    );
  }
}
