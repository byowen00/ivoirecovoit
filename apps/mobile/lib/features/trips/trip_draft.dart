import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../places/places_repository.dart';

/// Brouillon de l'assistant de publication (écran 10), conservé sur l'appareil seulement.
class TripDraft {
  TripDraft({
    required this.idempotencyKey,
    required this.departure,
    this.step = 1,
    this.kind = 'INTERCITY',
    this.origin,
    this.destination,
    List<Place?>? stops,
    this.meetingPoint = '',
    this.vehicleId,
    this.seats = 3,
    this.autoAccept = true,
    this.luggagePolicy = 'MEDIUM',
    this.allowsCash = false,
    this.description = '',
    List<int>? stopPrices,
    DateTime? savedAt,
  }) : stops = stops ?? [],
       stopPrices = stopPrices ?? [],
       savedAt = savedAt ?? DateTime.now();

  int step;
  String kind;
  Place? origin;
  Place? destination;
  List<Place?> stops;
  String meetingPoint;

  /// Départ à l'heure d'Abidjan (UTC+0).
  DateTime departure;
  String? vehicleId;
  int seats;
  bool autoAccept;
  String luggagePolicy;
  bool allowsCash;
  String description;

  /// Prix cumulés depuis le départ, un par point (départ = 0). Vide tant que l'aperçu n'est pas calculé.
  List<int> stopPrices;
  final String idempotencyKey;
  DateTime savedAt;

  List<Place> get points => [origin, ...stops, destination].whereType<Place>().toList();

  static Map<String, Object?>? _place(Place? p) => p == null
      ? null
      : {
          'id': p.id,
          'kind': p.kind,
          'label': p.label,
          'lat': p.lat,
          'lng': p.lng,
          'locationPrecision': p.isApproximate ? 'APPROX' : 'EXACT',
        };
  static Place? _readPlace(Object? j) => j == null ? null : Place.fromJson(Map<String, dynamic>.from(j as Map));

  Map<String, Object?> toJson() => {
    'version': 1,
    'step': step,
    'kind': kind,
    'origin': _place(origin),
    'destination': _place(destination),
    'stops': [for (final s in stops) _place(s)],
    'meetingPoint': meetingPoint,
    'departure': departure.toUtc().toIso8601String(),
    'vehicleId': vehicleId,
    'seats': seats,
    'autoAccept': autoAccept,
    'luggagePolicy': luggagePolicy,
    'allowsCash': allowsCash,
    'description': description,
    'stopPrices': stopPrices,
    'idempotencyKey': idempotencyKey,
    'savedAt': savedAt.toUtc().toIso8601String(),
  };

  static TripDraft? fromJson(Map<String, dynamic> j) {
    if (j['version'] != 1 || j['idempotencyKey'] is! String) return null;
    return TripDraft(
      idempotencyKey: j['idempotencyKey'] as String,
      departure: DateTime.parse(j['departure'] as String),
      step: (j['step'] as num).toInt().clamp(1, 4),
      kind: j['kind'] as String,
      origin: _readPlace(j['origin']),
      destination: _readPlace(j['destination']),
      stops: [for (final s in j['stops'] as List) _readPlace(s)],
      meetingPoint: (j['meetingPoint'] as String?) ?? '',
      vehicleId: j['vehicleId'] as String?,
      seats: (j['seats'] as num).toInt(),
      autoAccept: j['autoAccept'] as bool,
      luggagePolicy: j['luggagePolicy'] as String,
      allowsCash: j['allowsCash'] as bool,
      description: (j['description'] as String?) ?? '',
      stopPrices: [for (final p in j['stopPrices'] as List) (p as num).toInt()],
      savedAt: DateTime.parse(j['savedAt'] as String),
    );
  }

  /// Problèmes bloquants pour quitter l'étape [upTo] (et les précédentes).
  List<String> errors(int upTo, {DateTime? now}) {
    final e = <String>[];
    final n = now ?? DateTime.now();
    if (origin == null) e.add('Choisissez le lieu de départ.');
    if (destination == null) e.add('Choisissez le lieu d’arrivée.');
    if (stops.any((s) => s == null)) e.add('Choisissez chaque arrêt intermédiaire ou retirez-le.');
    final ids = points.map((p) => p.id).toList();
    if (ids.toSet().length != ids.length) e.add('Un même lieu apparaît deux fois.');
    if (departure.isBefore(n.add(const Duration(minutes: 30)))) {
      e.add('Le départ doit être au moins 30 minutes après maintenant.');
    }
    if (upTo >= 2 && vehicleId == null) e.add('Choisissez un véhicule validé.');
    if (upTo >= 3 && stopPrices.length != points.length) e.add('Calculez le prix du trajet.');
    return e;
  }
}

const draftKey = 'trip_draft_v1';
const _maxAge = Duration(days: 14);

TripDraft? loadDraft(SharedPreferences prefs, {DateTime? now}) {
  final raw = prefs.getString(draftKey);
  if (raw == null) return null;
  try {
    final d = TripDraft.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    if (d == null || (now ?? DateTime.now()).difference(d.savedAt) > _maxAge) {
      prefs.remove(draftKey);
      return null;
    }
    return d;
  } on Object {
    prefs.remove(draftKey); // brouillon illisible : on repart de zéro
    return null;
  }
}

Future<void> saveDraft(SharedPreferences prefs, TripDraft d) {
  d.savedAt = DateTime.now();
  return prefs.setString(draftKey, jsonEncode(d.toJson()));
}

Future<void> clearDraft(SharedPreferences prefs) => prefs.remove(draftKey);
