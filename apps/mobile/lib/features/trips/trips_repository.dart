import 'dart:math';

import '../../core/api_client.dart';
import '../auth/auth_session.dart';
import 'models.dart';

class SearchQuery {
  const SearchQuery({
    required this.fromId,
    required this.fromLabel,
    required this.toId,
    required this.toLabel,
    this.date,
    this.seats = 1,
    this.sort = 'departure',
    this.maxPriceXof,
    this.directOnly = false,
  });

  final String fromId;
  final String fromLabel;
  final String toId;
  final String toLabel;
  final DateTime? date;
  final int seats;
  final String sort;
  final int? maxPriceXof;
  final bool directOnly;

  SearchQuery copyWith({String? sort, int? maxPriceXof, bool clearMaxPrice = false, bool? directOnly}) => SearchQuery(
    fromId: fromId,
    fromLabel: fromLabel,
    toId: toId,
    toLabel: toLabel,
    date: date,
    seats: seats,
    sort: sort ?? this.sort,
    maxPriceXof: clearMaxPrice ? null : (maxPriceXof ?? this.maxPriceXof),
    directOnly: directOnly ?? this.directOnly,
  );

  /// Paramètres de GET /trips/search (dates à l'heure d'Abidjan, UTC+0).
  Map<String, String> toParams({String? cursor}) => {
    'fromPlaceId': fromId,
    'toPlaceId': toId,
    if (date != null) 'date': date!.toIso8601String().substring(0, 10),
    'seats': '$seats',
    'sort': sort,
    if (maxPriceXof != null) 'maxPriceXof': '$maxPriceXof',
    if (directOnly) 'directOnly': 'true',
    'cursor': ?cursor,
  };
}

abstract class TripsRepository {
  Future<SearchPage> search(SearchQuery q, {String? cursor});
  Future<TripDetail> detail(String id);
  Future<Availability> availability(String id, String pickupStopId, String dropoffStopId);
  Future<PublicDriver> driver(String id);
  Future<List<PopularRoute>> popularRoutes();
}

/// Clé d'idempotence aléatoire (format UUID v4) : une création rejouée ne crée rien en double.
String newIdempotencyKey([Random? random]) {
  final r = random ?? Random.secure();
  final b = List<int>.generate(16, (_) => r.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  final h = b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();
  return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20)}';
}

class ApiTripsRepository implements TripsRepository {
  ApiTripsRepository(this._api, this._session);
  final ApiClient _api;
  final AuthSession _session;

  @override
  Future<SearchPage> search(SearchQuery q, {String? cursor}) async =>
      SearchPage.fromJson(await _api.get('/trips/search', query: q.toParams(cursor: cursor)));

  @override
  Future<TripDetail> detail(String id) async => TripDetail.fromJson(await _api.get('/trips/$id'));

  @override
  Future<Availability> availability(String id, String pickupStopId, String dropoffStopId) async =>
      Availability.fromJson(
        await _api.get(
          '/trips/$id/availability',
          query: {'pickupStopId': pickupStopId, 'dropoffStopId': dropoffStopId},
          retries: 1,
        ),
      );

  @override
  Future<PublicDriver> driver(String id) async => PublicDriver.fromJson(await _api.get('/drivers/$id'));

  @override
  Future<List<PopularRoute>> popularRoutes() async => [
    for (final r in (await _api.get('/places/popular-routes', retries: 1))['data'] as List)
      PopularRoute.fromJson(r as Map<String, dynamic>),
  ];

  // ------------------------------------------------------------ espace conducteur (authentifié)

  Future<TripPreview> preview(Map<String, Object?> body) async =>
      TripPreview.fromJson(await _session.send('POST', '/trips/preview', body: body));

  Future<ManagedTrip> create(Map<String, Object?> body, String idempotencyKey) async => ManagedTrip.fromJson(
    await _session.send('POST', '/trips', body: body, headers: {'Idempotency-Key': idempotencyKey}),
  );

  Future<({List<MyTrip> trips, String? next})> mine(String status, {String? cursor}) async {
    final q = Uri(queryParameters: {'status': status, 'cursor': ?cursor}).query;
    final res = await _session.send('GET', '/trips/mine?$q');
    return (
      trips: [for (final t in res['data'] as List) MyTrip.fromJson(t as Map<String, dynamic>)],
      next: res['nextCursor'] as String?,
    );
  }

  Future<ManagedTrip> manage(String id) async => ManagedTrip.fromJson(await _session.send('GET', '/trips/$id/manage'));

  Future<ManagedTrip> action(String id, String action) async =>
      ManagedTrip.fromJson(await _session.send('POST', '/trips/$id/$action'));

  Future<ManagedTrip> cancel(String id, String reason, String key) async => ManagedTrip.fromJson(
    await _session.send('POST', '/trips/$id/cancel', body: {'reason': reason}, headers: {'Idempotency-Key': key}),
  );

  Future<ManagedTrip> update(String id, int version, Map<String, Object?> patch) async =>
      ManagedTrip.fromJson(await _session.send('PATCH', '/trips/$id', body: patch, headers: {'If-Match': '$version'}));

  Future<List<Map<String, dynamic>>> duplicate(String id, List<String> dates, bool publish, String key) async {
    final res = await _session.send(
      'POST',
      '/trips/$id/duplicate',
      body: {'dates': dates, 'publish': publish},
      headers: {'Idempotency-Key': key},
    );
    return [for (final r in res['data'] as List) Map<String, dynamic>.from(r as Map)];
  }
}
