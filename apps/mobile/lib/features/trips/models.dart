import 'package:latlong2/latlong.dart';

import '../bookings/models.dart';

DateTime _date(Object? v) => DateTime.parse(v! as String);
double _d(Object? v) => (v! as num).toDouble();
int _i(Object? v) => (v! as num).toInt();
double? _dn(Object? v) => v == null ? null : (v as num).toDouble();

List<LatLng> _geometry(Object? v) => [
  for (final p in (v as List? ?? const [])) LatLng(((p as List)[0] as num).toDouble(), (p[1] as num).toDouble()),
];

const tripStatusLabel = {
  'DRAFT': 'Brouillon',
  'PUBLISHED': 'Publié',
  'FULL': 'Complet',
  'IN_PROGRESS': 'En cours',
  'COMPLETED': 'Terminé',
  'CANCELLED': 'Annulé',
};

const luggageLabel = {'NONE': 'Pas de bagage', 'SMALL': 'Petit sac', 'MEDIUM': 'Bagage moyen', 'LARGE': 'Gros bagage'};

/// Rappelle qu'un itinéraire est une estimation (jamais présenté comme un tracé GPS).
String routeSourceNote(String? source) => source == 'OSRM'
    ? 'Distance et durée estimées d’après le réseau routier, sans tenir compte du trafic.'
    : 'Distance et durée estimées à vol d’oiseau (service d’itinéraire indisponible) : à titre indicatif.';

class SearchResult {
  SearchResult.fromJson(Map<String, dynamic> j)
    : tripId = j['tripId'] as String,
      pickupStopId = (j['pickup'] as Map)['stopId'] as String,
      pickupLabel = (j['pickup'] as Map)['label'] as String,
      pickupAt = _date((j['pickup'] as Map)['plannedAt']),
      pickupDistanceM = _i((j['pickup'] as Map)['distanceFromQueryM']),
      pickup = LatLng(_d((j['pickup'] as Map)['lat']), _d((j['pickup'] as Map)['lng'])),
      dropoffStopId = (j['dropoff'] as Map)['stopId'] as String,
      dropoffLabel = (j['dropoff'] as Map)['label'] as String,
      dropoffAt = _date((j['dropoff'] as Map)['plannedAt']),
      dropoffDistanceM = _i((j['dropoff'] as Map)['distanceFromQueryM']),
      durationS = _i(j['estimatedDurationS']),
      distanceM = (j['estimatedDistanceM'] as num?)?.toInt(),
      unitPriceXof = _i(j['unitPriceXof']),
      seatsAvailable = _i(j['seatsAvailable']),
      autoAccept = j['acceptanceMode'] == 'AUTO',
      driverId = (j['driver'] as Map)['id'] as String,
      driverName = (j['driver'] as Map)['displayName'] as String,
      driverRating = _dn((j['driver'] as Map)['ratingAvg']),
      driverRatingCount = _i((j['driver'] as Map)['ratingCount']),
      vehicle = '${(j['vehicle'] as Map)['make']} ${(j['vehicle'] as Map)['model']}',
      stopsCount = _i(j['stopsCount']),
      isDemo = (j['isDemo'] as bool?) ?? false;

  final String tripId;
  final String pickupStopId;
  final String pickupLabel;
  final DateTime pickupAt;
  final int pickupDistanceM;
  final LatLng pickup;
  final String dropoffStopId;
  final String dropoffLabel;
  final DateTime dropoffAt;
  final int dropoffDistanceM;
  final int durationS;
  final int? distanceM;
  final int unitPriceXof;
  final int seatsAvailable;
  final bool autoAccept;
  final String driverId;
  final String driverName;
  final double? driverRating;
  final int driverRatingCount;
  final String vehicle;
  final int stopsCount;
  final bool isDemo;
}

class SearchPage {
  SearchPage(this.results, this.nextCursor, this.from, this.to);
  factory SearchPage.fromJson(Map<String, dynamic> j) {
    final q = j['query'] as Map<String, dynamic>;
    LatLng point(Map m) => LatLng(_d(m['lat']), _d(m['lng']));
    return SearchPage(
      [for (final r in j['data'] as List) SearchResult.fromJson(r as Map<String, dynamic>)],
      j['nextCursor'] as String?,
      point(q['from'] as Map),
      point(q['to'] as Map),
    );
  }
  final List<SearchResult> results;
  final String? nextCursor;
  final LatLng from;
  final LatLng to;
}

class TripStop {
  TripStop.fromJson(Map<String, dynamic> j)
    : id = j['id'] as String,
      seq = _i(j['seq']),
      label = j['label'] as String,
      meetingPoint = j['meetingPoint'] as String?,
      point = LatLng(_d(j['lat']), _d(j['lng'])),
      approximate = j['locationPrecision'] == 'APPROX',
      plannedAt = _date(j['plannedAt']),
      priceFromOriginXof = _i(j['priceFromOriginXof']),
      isPickup = j['isPickup'] as bool,
      isDropoff = j['isDropoff'] as bool;

  final String id;
  final int seq;
  final String label;
  final String? meetingPoint;
  final LatLng point;
  final bool approximate;
  final DateTime plannedAt;
  final int priceFromOriginXof;
  final bool isPickup;
  final bool isDropoff;
}

class TripDetail {
  TripDetail.fromJson(Map<String, dynamic> j)
    : id = j['id'] as String,
      publicRef = j['publicRef'] as String,
      status = j['status'] as String,
      departureAt = _date(j['departureAt']),
      distanceM = _i(j['estimatedDistanceM']),
      durationS = _i(j['estimatedDurationS']),
      routeSource = j['routeSource'] as String?,
      roundedCoordinates = j['coordinatesPrecision'] == 'ROUNDED',
      geometry = _geometry(j['geometry']),
      stops = [for (final s in j['stops'] as List) TripStop.fromJson(s as Map<String, dynamic>)],
      driver = j['driver'] == null ? null : TripDriver.fromJson(j['driver'] as Map<String, dynamic>),
      vehicle = '${(j['vehicle'] as Map)['make']} ${(j['vehicle'] as Map)['model']}, ${(j['vehicle'] as Map)['color']}',
      plateNumber = (j['vehicle'] as Map)['plateNumber'] as String?,
      autoAccept = j['acceptanceMode'] == 'AUTO',
      cancellationPolicy = (j['cancellationPolicy'] as Map)['label'] as String,
      allowsCash = j['allowsCash'] as bool,
      luggagePolicy = j['luggagePolicy'] as String,
      description = j['description'] as String?,
      instructions = j['instructions'] as String?,
      cancellationReason = j['cancellationReason'] as String?,
      isDemo = (j['isDemo'] as bool?) ?? false;

  final String id;
  final String publicRef;
  final String status;
  final DateTime departureAt;
  final int distanceM;
  final int durationS;
  final String? routeSource;
  final bool roundedCoordinates;
  final List<LatLng> geometry;
  final List<TripStop> stops;
  final TripDriver? driver;
  final String vehicle;
  final String? plateNumber;
  final bool autoAccept;
  final String cancellationPolicy;
  final bool allowsCash;
  final String luggagePolicy;
  final String? description;
  final String? instructions;
  final String? cancellationReason;
  final bool isDemo;

  bool get bookable => status == 'PUBLISHED' || status == 'FULL';
}

class TripDriver {
  TripDriver.fromJson(Map<String, dynamic> j)
    : id = j['id'] as String,
      displayName = j['displayName'] as String,
      photoUrl = j['photoUrl'] as String?,
      ratingAvg = _dn(j['ratingAvg']),
      ratingCount = _i(j['ratingCount']),
      completedTrips = _i(j['completedTripsCount']);
  final String id;
  final String displayName;
  final String? photoUrl;
  final double? ratingAvg;
  final int ratingCount;
  final int completedTrips;
}

class Availability {
  Availability.fromJson(Map<String, dynamic> j)
    : unitPriceXof = _i(j['unitPriceXof']),
      seatsAvailable = _i(j['seatsAvailable']),
      bookable = j['bookable'] as bool;
  final int unitPriceXof;
  final int seatsAvailable;
  final bool bookable;
}

class PublicDriver {
  PublicDriver.fromJson(Map<String, dynamic> j)
    : id = j['id'] as String,
      displayName = j['displayName'] as String,
      photoUrl = j['photoUrl'] as String?,
      bio = j['bio'] as String?,
      preferences = Map<String, dynamic>.from((j['preferences'] as Map?) ?? {}),
      memberSince = _date(j['memberSince']),
      verificationLevel = _i(j['verificationLevel']),
      ratingAvg = _dn(j['ratingAvg']),
      ratingCount = _i(j['ratingCount']),
      completedTrips = _i(j['completedTripsCount']),
      upcomingTrips = _i(j['upcomingTripsCount']),
      isDemo = (j['isDemo'] as bool?) ?? false,
      vehicles = [
        for (final v in j['vehicles'] as List)
          '${(v as Map)['make']} ${v['model']}, ${v['color']} · ${v['seats']} places passagers',
      ],
      reviews = [
        for (final r in j['reviews'] as List)
          (rating: _i((r as Map)['rating']), comment: r['comment'] as String?, author: r['author'] as String?),
      ];
  final String id;
  final String displayName;
  final String? photoUrl;
  final String? bio;
  final Map<String, dynamic> preferences;
  final DateTime memberSince;
  final int verificationLevel;
  final double? ratingAvg;
  final int ratingCount;
  final int completedTrips;
  final int upcomingTrips;
  final bool isDemo;
  final List<String> vehicles;
  final List<({int rating, String? comment, String? author})> reviews;
}

class PopularRoute {
  PopularRoute.fromJson(Map<String, dynamic> j)
    : fromId = (j['from'] as Map)['id'] as String,
      fromLabel = (j['from'] as Map)['label'] as String,
      toId = (j['to'] as Map)['id'] as String,
      toLabel = (j['to'] as Map)['label'] as String,
      upcomingTrips = _i(j['upcomingTrips']);
  final String fromId;
  final String fromLabel;
  final String toId;
  final String toLabel;
  final int upcomingTrips;
}

class MyTrip {
  MyTrip.fromJson(Map<String, dynamic> j)
    : id = j['id'] as String,
      status = j['status'] as String,
      departureAt = _date(j['departureAt']),
      origin = j['origin'] as String,
      destination = j['destination'] as String,
      intermediateStops = _i(j['intermediateStops']),
      priceXof = _i(j['priceXof']),
      seatsOffered = _i(j['seatsOffered']),
      seatsOccupied = _i(j['seatsOccupied']),
      vehicle = j['vehicle'] as String;
  final String id;
  final String status;
  final DateTime departureAt;
  final String origin;
  final String destination;
  final int intermediateStops;
  final int priceXof;
  final int seatsOffered;
  final int seatsOccupied;
  final String vehicle;
}

class ManagedTrip {
  ManagedTrip.fromJson(Map<String, dynamic> j)
    : id = j['id'] as String,
      publicRef = j['publicRef'] as String,
      status = j['status'] as String,
      version = _i(j['version']),
      departureAt = _date(j['departureAt']),
      distanceM = _i(j['estimatedDistanceM']),
      durationS = _i(j['estimatedDurationS']),
      routeSource = j['routeSource'] as String?,
      geometry = _geometry(j['geometry']),
      seatsOffered = _i(j['seatsOffered']),
      seatsOccupied = _i(j['seatsOccupied']),
      seatsCapacity = _i((j['vehicle'] as Map)['seatsCapacity']),
      vehicle =
          '${(j['vehicle'] as Map)['make']} ${(j['vehicle'] as Map)['model']} · ${(j['vehicle'] as Map)['plateNumber']}',
      stops = [for (final s in j['stops'] as List) TripStop.fromJson(s as Map<String, dynamic>)],
      bookings = [for (final b in j['bookings'] as List) ManagedBooking.fromJson(b as Map<String, dynamic>)],
      cancellationReason = j['cancellationReason'] as String?,
      isDemo = (j['isDemo'] as bool?) ?? false,
      actions = Map<String, bool>.from(j['actions'] as Map);
  final String id;
  final String publicRef;
  final String status;
  final int version;
  final DateTime departureAt;
  final int distanceM;
  final int durationS;
  final String? routeSource;
  final List<LatLng> geometry;
  final int seatsOffered;
  final int seatsOccupied;
  final int seatsCapacity;
  final String vehicle;
  final List<TripStop> stops;
  final List<ManagedBooking> bookings;
  final String? cancellationReason;
  final bool isDemo;
  final Map<String, bool> actions;

  bool can(String action) => actions[action] ?? false;
}

class TripPreview {
  TripPreview.fromJson(Map<String, dynamic> j)
    : distanceM = _i(j['estimatedDistanceM']),
      durationS = _i(j['estimatedDurationS']),
      routeSource = j['routeSource'] as String?,
      geometry = _geometry(j['geometry']),
      arrivalAt = _date(j['estimatedArrivalAt']),
      stopPrices = [for (final s in j['stops'] as List) _i((s as Map)['priceFromOriginXof'])],
      stopPoints = [for (final s in j['stops'] as List) LatLng(_d((s as Map)['lat']), _d(s['lng']))],
      suggestedPriceXof = _i((j['price'] as Map)['suggestedPriceXof']),
      minXof = _i((j['price'] as Map)['minXof']),
      maxXof = _i((j['price'] as Map)['maxXof']),
      problems = [for (final p in (j['price'] as Map)['problems'] as List) Map<String, dynamic>.from(p as Map)];
  final int distanceM;
  final int durationS;
  final String? routeSource;
  final List<LatLng> geometry;
  final DateTime arrivalAt;
  final List<int> stopPrices;
  final List<LatLng> stopPoints;
  final int suggestedPriceXof;
  final int minXof;
  final int maxXof;
  final List<Map<String, dynamic>> problems;
}

/// Explication en clair d'un problème de prix renvoyé par l'API.
String priceProblemText(Map<String, dynamic> p, List<String> labels, int minXof, int maxXof) {
  String name(Object? i) => i is num && i.toInt() < labels.length ? labels[i.toInt()] : 'l’arrêt';
  switch (p['code']) {
    case 'NOT_MULTIPLE_OF_50':
      return 'Le prix jusqu’à ${name(p['index'])} doit être un multiple de 50 FCFA.';
    case 'NOT_INCREASING':
      return 'Le prix jusqu’à ${name(p['index'])} doit être supérieur à celui de l’arrêt précédent.';
    case 'BELOW_MIN':
      return 'De ${name(p['from'])} à ${name(p['to'])} : ${p['priceXof']} FCFA, en dessous du minimum de $minXof FCFA.';
    case 'ABOVE_MAX':
      return 'Prix complet de ${p['priceXof']} FCFA, au-dessus du maximum de $maxXof FCFA.';
    case 'ABOVE_KM_CAP':
      return 'De ${name(p['from'])} à ${name(p['to'])} : ${p['priceXof']} FCFA dépasse le plafond de ${p['capXof']} FCFA.';
    default:
      return 'Le prix au point de départ doit être 0.';
  }
}
