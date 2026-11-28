import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:ivoirecovoit/features/auth/auth_controller.dart';
import 'package:ivoirecovoit/features/auth/models.dart';
import 'package:ivoirecovoit/features/driver/driver_home_screen.dart';
import 'package:ivoirecovoit/features/driver/driver_repository.dart';
import 'package:ivoirecovoit/features/trips/models.dart';
import 'package:ivoirecovoit/features/trips/trips_repository.dart';
import 'package:ivoirecovoit/providers.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _Auth extends AuthController {
  @override
  Future<Me?> build() async => Me.fromJson({
    'id': 'u1', 'phone': '+2250000000021', 'email': null, 'firstName': 'Ibrahim', 'lastName': 'Koné',
    'displayName': 'Ibrahim K.', 'bio': null, 'preferences': {}, 'status': 'ACTIVE',
    'profileComplete': true, 'isDemo': true, 'consents': [], 'requiredConsents': [],
  });
}

class _Driver implements DriverRepository {
  @override
  Future<DriverProfile?> me() async => DriverProfile.fromJson({
    'status': 'APPROVED', 'rejectionReason': null, 'license': null, 'documents': [], 'requirements': [],
    'canEdit': false, 'canSubmit': false, 'canPublish': true, 'publishBlockers': [],
  });
  @override
  dynamic noSuchMethod(Invocation i) => super.noSuchMethod(i);
}

class _Trips implements ApiTripsRepository {
  @override
  Future<({List<MyTrip> trips, String? next})> mine(String status, {String? cursor}) async => (
    trips: status == 'upcoming'
        ? [
            MyTrip.fromJson({
              'id': 't2', 'status': 'PUBLISHED', 'departureAt': '2026-11-30T07:00:00.000Z', 'origin': 'Angré', 'destination': 'Plateau',
              'intermediateStops': 0, 'priceXof': 800, 'seatsOffered': 3, 'seatsOccupied': 1, 'vehicle': 'Toyota Yaris',
            }),
          ]
        : <MyTrip>[],
    next: null,
  );
  @override
  dynamic noSuchMethod(Invocation i) => super.noSuchMethod(i);
}

class _Requests implements DriverHomeRepository {
  final accepted = <String>[];
  var pending = [
    DriverRequest.fromJson({
      'id': 'b1', 'seats': 1, 'driverNetXof': 720, 'answerBefore': '2026-11-29T18:00:00.000Z', 'passengerName': 'Kevin A.',
      'trip': {'id': 't2', 'kind': 'URBAN', 'departureAt': '2026-11-30T07:00:00.000Z'}, 'pickup': 'Angré', 'dropoff': 'Plateau',
    }),
  ];
  @override
  Future<List<DriverRequest>> requests() async => pending;
  @override
  Future<void> accept(String id) async {
    accepted.add(id);
    pending = [];
  }

  @override
  Future<void> reject(String id) async => pending = [];
}

void main() {
  setUpAll(() => initializeDateFormatting('fr'));

  testWidgets('mode conducteur : demandes des passagers, acceptation, prochains départs', (tester) async {
    SharedPreferences.setMockInitialValues({'mode.driver': true});
    final prefs = await SharedPreferences.getInstance();
    final requests = _Requests();
    await tester.pumpWidget(ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(prefs),
        authControllerProvider.overrideWith(_Auth.new),
        driverRepositoryProvider.overrideWithValue(_Driver()),
        apiTripsRepositoryProvider.overrideWithValue(_Trips()),
        driverHomeRepositoryProvider.overrideWithValue(requests),
      ],
      child: MaterialApp.router(
        routerConfig: GoRouter(routes: [GoRoute(path: '/', builder: (_, _) => const DriverHomeScreen())]),
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Bonne route, Ibrahim'), findsOneWidget);
    expect(find.text('1 demande de passager à traiter.'), findsOneWidget);
    expect(find.text('Kevin A.'), findsOneWidget);
    expect(find.text('Angré → Plateau'), findsOneWidget); // prochain départ
    await tester.tap(find.byKey(const Key('accept-b1')));
    await tester.pumpAndSettle();
    expect(requests.accepted, ['b1']);
    expect(find.text('Aucune demande en attente.'), findsOneWidget);
    // Retour au mode passager depuis la bascule.
    await tester.tap(find.text('Passager'));
    await tester.pumpAndSettle();
    expect(prefs.getBool('mode.driver'), isFalse);
  });
}
