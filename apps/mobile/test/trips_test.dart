import 'dart:math';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:ivoirecovoit/core/api_client.dart';
import 'package:ivoirecovoit/core/upload.dart';
import 'package:ivoirecovoit/features/places/places_repository.dart';
import 'package:ivoirecovoit/features/trips/models.dart';
import 'package:ivoirecovoit/features/trips/search_results_screen.dart';
import 'package:ivoirecovoit/features/trips/trip_draft.dart';
import 'package:ivoirecovoit/features/trips/trips_repository.dart';
import 'package:ivoirecovoit/providers.dart';
import 'package:shared_preferences/shared_preferences.dart';

Map<String, dynamic> resultJson({String id = 't1', int price = 5000}) => {
  'tripId': id,
  'pickup': {
    'stopId': 's0',
    'label': 'Abidjan, Adjamé',
    'plannedAt': '2026-11-02T07:00:00.000Z',
    'distanceFromQueryM': 300,
    'lat': 5.35,
    'lng': -4.02,
  },
  'dropoff': {
    'stopId': 's1',
    'label': 'Yamoussoukro',
    'plannedAt': '2026-11-02T10:00:00.000Z',
    'distanceFromQueryM': 0,
    'lat': 6.82,
    'lng': -5.28,
  },
  'estimatedDurationS': 10800,
  'estimatedDistanceM': 240000,
  'unitPriceXof': price,
  'seatsAvailable': 3,
  'acceptanceMode': 'AUTO',
  'driver': {'id': 'd1', 'displayName': 'Awa K.', 'ratingAvg': 4.6, 'ratingCount': 12},
  'vehicle': {'make': 'Toyota', 'model': 'Corolla'},
  'stopsCount': 2,
  'isDemo': true,
};

Map<String, dynamic> pageJson(List<Map<String, dynamic>> data, {String? next}) => {
  'data': data,
  'nextCursor': next,
  'query': {
    'from': {'lat': 5.35, 'lng': -4.02},
    'to': {'lat': 6.82, 'lng': -5.28},
  },
};

class FakeTrips implements TripsRepository {
  FakeTrips(this.pages);
  final List<SearchPage> pages;
  final calls = <(SearchQuery, String?)>[];
  @override
  Future<SearchPage> search(SearchQuery q, {String? cursor}) async {
    calls.add((q, cursor));
    return pages[calls.length - 1];
  }

  @override
  Future<TripDetail> detail(String id) => throw UnimplementedError();
  @override
  Future<Availability> availability(String id, String p, String d) => throw UnimplementedError();
  @override
  Future<PublicDriver> driver(String id) => throw UnimplementedError();
  @override
  Future<List<PopularRoute>> popularRoutes() async => [];
}

Place place(String id) => Place(id: id, kind: 'CITY', label: 'Lieu $id', lat: 5.3, lng: -4.0, isApproximate: false);

void main() {
  setUpAll(() => initializeDateFormatting('fr'));

  group('modèles', () {
    test('un résultat de recherche se lit depuis la réponse de l’API', () {
      final p = SearchPage.fromJson(pageJson([resultJson()], next: 'c2'));
      final r = p.results.single;
      expect(r.pickupLabel, 'Abidjan, Adjamé');
      expect(r.pickupAt, DateTime.utc(2026, 11, 2, 7));
      expect(r.unitPriceXof, 5000);
      expect(r.autoAccept, isTrue);
      expect(r.vehicle, 'Toyota Corolla');
      expect(r.driverRating, 4.6);
      expect(r.isDemo, isTrue);
      expect(p.nextCursor, 'c2');
    });

    test('la note d’itinéraire dit toujours qu’il s’agit d’une estimation', () {
      expect(routeSourceNote('OSRM'), contains('estimées'));
      expect(routeSourceNote('HAVERSINE_FALLBACK'), contains('vol d’oiseau'));
    });
  });

  group('requête de recherche', () {
    test('paramètres envoyés à l’API', () {
      final q = SearchQuery(fromId: 'a', fromLabel: 'A', toId: 'b', toLabel: 'B', date: DateTime.utc(2026, 11, 2), seats: 2);
      expect(q.toParams(), {'fromPlaceId': 'a', 'toPlaceId': 'b', 'date': '2026-11-02', 'seats': '2', 'sort': 'departure'});
      final f = q.copyWith(sort: 'price', maxPriceXof: 6000, directOnly: true);
      expect(f.toParams(cursor: 'x'), containsPair('maxPriceXof', '6000'));
      expect(f.toParams(cursor: 'x'), containsPair('directOnly', 'true'));
      expect(f.toParams(cursor: 'x'), containsPair('cursor', 'x'));
      expect(f.copyWith(clearMaxPrice: true).maxPriceXof, isNull);
    });

    test('l’adresse de résultats se relit à l’identique', () {
      final q = SearchQuery(fromId: 'a', fromLabel: 'Abidjan', toId: 'b', toLabel: 'Bouaké', date: DateTime.utc(2026, 11, 2), seats: 3);
      final back = queryFromUri(Uri.parse(resultsLocation(q)))!;
      expect([back.fromId, back.fromLabel, back.toId, back.toLabel, back.seats], ['a', 'Abidjan', 'b', 'Bouaké', 3]);
      expect(back.date, DateTime.utc(2026, 11, 2));
      expect(queryFromUri(Uri.parse('/recherche?from=a')), isNull);
      expect(queryFromUri(Uri.parse('/recherche?from=a&to=b&seats=99'))!.seats, 8);
    });

    test('clé d’idempotence au format UUID v4', () {
      final k = newIdempotencyKey(Random(1));
      expect(k, matches(RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')));
      expect(newIdempotencyKey(), isNot(newIdempotencyKey()));
    });
  });

  group('fichiers à déposer', () {
    test('type détecté d’après le contenu, pas d’après le nom', () {
      expect(detectMime(Uint8List.fromList([0xFF, 0xD8, 0xFF, 0xE0])), 'image/jpeg');
      expect(detectMime(Uint8List.fromList([0x89, 0x50, 0x4E, 0x47, 0x0D])), 'image/png');
      expect(detectMime(Uint8List.fromList([0x25, 0x50, 0x44, 0x46, 0x2D])), 'application/pdf');
      expect(
        detectMime(Uint8List.fromList([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])),
        'image/webp',
      );
      expect(detectMime(Uint8List.fromList('<html>'.codeUnits)), isNull);
    });

    test('refus des formats et tailles non acceptés, empreinte SHA-256', () {
      final pdf = Uint8List.fromList([0x25, 0x50, 0x44, 0x46]);
      expect(() => prepareFile(pdf, maxBytes: 100, allowPdf: false), throwsA(isA<ApiException>()));
      expect(() => prepareFile(Uint8List(10), maxBytes: 100), throwsA(isA<ApiException>()));
      final big = Uint8List(200)..setAll(0, [0xFF, 0xD8, 0xFF]);
      expect(
        () => prepareFile(big, maxBytes: 100),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', 'FILE_TOO_LARGE')),
      );
      final f = prepareFile(pdf, maxBytes: 100);
      expect(f.meta, {
        'mimeType': 'application/pdf',
        'sizeBytes': 4,
        'sha256': sha256.convert(pdf).toString(),
      });
    });
  });

  group('brouillon de publication', () {
    final now = DateTime.utc(2026, 11, 1, 8);

    test('les erreurs bloquantes dépendent de l’étape', () {
      final d = TripDraft(idempotencyKey: 'k', departure: now.add(const Duration(minutes: 10)));
      expect(d.errors(1, now: now), hasLength(3));
      d
        ..origin = place('a')
        ..destination = place('a')
        ..departure = now.add(const Duration(hours: 2));
      expect(d.errors(1, now: now), ['Un même lieu apparaît deux fois.']);
      d.destination = place('b');
      expect(d.errors(1, now: now), isEmpty);
      expect(d.errors(2, now: now), ['Choisissez un véhicule validé.']);
      d.vehicleId = 'v';
      expect(d.errors(3, now: now), ['Calculez le prix du trajet.']);
      d.stopPrices = [0, 5000];
      expect(d.errors(4, now: now), isEmpty);
    });

    test('conservé sur l’appareil puis oublié après 14 jours', () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final d = TripDraft(idempotencyKey: 'k1', departure: now, origin: place('a'), stops: [null], seats: 2, step: 3);
      await saveDraft(prefs, d);
      final back = loadDraft(prefs)!;
      expect([back.idempotencyKey, back.origin?.id, back.stops.length, back.seats, back.step], ['k1', 'a', 1, 2, 3]);
      expect(back.departure, now);
      expect(loadDraft(prefs, now: DateTime.now().add(const Duration(days: 15))), isNull);
      expect(prefs.getString(draftKey), isNull);
      await prefs.setString(draftKey, '{pas du json');
      expect(loadDraft(prefs), isNull);
    });
  });

  testWidgets('résultats : liste, mention DEMO, pagination puis résultat vide', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final fake = FakeTrips([
      SearchPage.fromJson(pageJson([resultJson()], next: 'c2')),
      SearchPage.fromJson(pageJson([resultJson(id: 't2', price: 4500)])),
    ]);
    final q = SearchQuery(fromId: 'a', fromLabel: 'Abidjan', toId: 'b', toLabel: 'Yamoussoukro');
    final router = GoRouter(
      initialLocation: '/r',
      routes: [GoRoute(path: '/r', builder: (_, _) => SearchResultsScreen(query: q))],
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          sharedPreferencesProvider.overrideWithValue(prefs),
          tripsRepositoryProvider.overrideWithValue(fake),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('1+ trajet'), findsOneWidget);
    expect(find.text('[DEMO]'), findsOneWidget);
    expect(find.text('Awa K.'), findsOneWidget);
    expect(find.text('Vérifié'), findsOneWidget);
    final list = find.byType(Scrollable).first; // la rangée de tri défile aussi
    await tester.scrollUntilVisible(find.text('Voir plus de trajets'), 200, scrollable: list);
    await tester.tap(find.text('Voir plus de trajets'));
    await tester.pumpAndSettle();
    expect(fake.calls.last.$2, 'c2');
    expect(find.text('2 trajets'), findsOneWidget);
    expect(find.text('Voir plus de trajets'), findsNothing);
  });

  testWidgets('résultats : message clair quand rien ne correspond', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final fake = FakeTrips([SearchPage.fromJson(pageJson([]))]);
    final q = SearchQuery(fromId: 'a', fromLabel: 'A', toId: 'b', toLabel: 'B', date: DateTime.utc(2026, 11, 2));
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          sharedPreferencesProvider.overrideWithValue(prefs),
          tripsRepositoryProvider.overrideWithValue(fake),
        ],
        child: MaterialApp(home: SearchResultsScreen(query: q)),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('Aucun conducteur ne propose ce trajet ce jour-là'), findsOneWidget);
  });
}
