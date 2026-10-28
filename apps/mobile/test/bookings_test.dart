import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:ivoirecovoit/core/api_client.dart';
import 'package:ivoirecovoit/features/bookings/booking_detail_screen.dart';
import 'package:ivoirecovoit/features/bookings/booking_screen.dart';
import 'package:ivoirecovoit/features/bookings/bookings_repository.dart';
import 'package:ivoirecovoit/features/bookings/models.dart';
import 'package:ivoirecovoit/features/bookings/my_bookings_screen.dart';
import 'package:ivoirecovoit/providers.dart';

import 'trust_fakes.dart';

const _policy = {
  'code': 'STANDARD',
  'label': 'Standard',
  'summary': 'Remboursement de la part trajet : 100 % jusqu’à 24 h avant le départ.',
};
const _pickup = {'stopId': 's0', 'label': 'Riviera 2', 'meetingPoint': null, 'plannedAt': '2026-10-30T07:00:00.000Z'};
const _dropoff = {
  'stopId': 's1',
  'label': 'Yamoussoukro',
  'meetingPoint': null,
  'plannedAt': '2026-10-30T11:04:00.000Z',
};

Map<String, dynamic> quoteJson({String mode = 'AUTO', int seatsAvailable = 3}) => {
  'tripId': 't1',
  'pickup': _pickup,
  'dropoff': _dropoff,
  'seats': 1,
  'unitPriceXof': 5000,
  'subtotalXof': 5000,
  'serviceFeeXof': 300,
  'discountXof': 0,
  'totalXof': 5300,
  'seatsAvailable': seatsAvailable,
  'acceptanceMode': mode,
  'acceptanceDeadline': mode == 'MANUAL' ? '2026-10-30T05:00:00.000Z' : null,
  'holdMinutes': 15,
  'cashAllowed': false,
  'cancellationPolicy': _policy,
};

Map<String, dynamic> bookingJson({
  String status = 'PENDING_PAYMENT',
  String role = 'PASSENGER',
  bool canCancel = true,
}) => {
  'id': 'b1',
  'reference': 'IC-ABC123',
  'status': status,
  'paymentStatus': 'UNPAID',
  'paymentMethod': null,
  'seats': 1,
  'unitPriceXof': 5000,
  'subtotalXof': 5000,
  'serviceFeeXof': 300,
  'discountXof': 0,
  'totalXof': 5300,
  if (role == 'DRIVER') 'commissionXof': 500,
  if (role == 'DRIVER') 'driverNetXof': 4500,
  'holdExpiresAt': '2026-10-28T18:09:00.000Z',
  'acceptanceDeadline': null,
  'confirmedAt': null,
  'cancelledAt': null,
  'cancellationReason': null,
  'refundDueXof': null,
  'freeCancellation': false,
  'createdAt': '2026-10-28T17:54:00.000Z',
  'isDemo': true,
  'viewerRole': role,
  'cancellationPolicy': _policy,
  'trip': {
    'id': 't1',
    'publicRef': 'T-XYZ',
    'status': 'PUBLISHED',
    'departureAt': '2026-10-30T07:00:00.000Z',
    'origin': 'Riviera 2',
    'destination': 'Yamoussoukro',
    'driver': {'id': 'd1', 'displayName': 'Koffi K.'},
    'vehicle': {'make': 'Toyota', 'model': 'Corolla', 'color': 'Gris', 'plateNumber': null},
  },
  'passenger': {'displayName': 'Aya T.', 'ratingAvg': null},
  'pickup': _pickup,
  'dropoff': _dropoff,
  'history': [
    {'from': null, 'to': 'PENDING_PAYMENT', 'at': '2026-10-28T17:54:00.000Z', 'by': 'PASSENGER', 'reason': null},
  ],
  'actions': {
    'canCancel': canCancel,
    'canAccept': status == 'PENDING_ACCEPTANCE' && role == 'DRIVER',
    'canReject': status == 'PENDING_ACCEPTANCE' && role == 'DRIVER',
    'canMarkNoShow': false,
    'canPay': false,
  },
};

class FakeBookings implements BookingsRepository {
  FakeBookings({this.quoteData, this.booking});
  Map<String, dynamic>? quoteData;
  Map<String, dynamic>? booking;
  final created = <String>[];
  final cancelled = <String>[];
  final accepted = <String>[];
  final quotedPromos = <String?>[];
  final createdPromos = <String?>[];

  @override
  Future<BookingQuote> quote(String tripId, String p, String d, int seats, {String? promoCode}) async {
    quotedPromos.add(promoCode);
    if (promoCode == 'NUL') throw ApiException('PROMO_INVALID', 'Ce code promo n’existe pas.', status: 400);
    return BookingQuote.fromJson({
      ...quoteData!,
      'promoCode': ?promoCode,
      if (promoCode != null) 'discountXof': 500,
    });
  }

  @override
  Future<Booking> create(
    String tripId,
    String p,
    String d,
    int seats, {
    required String idempotencyKey,
    bool cash = false,
    String? promoCode,
  }) async {
    created.add(idempotencyKey);
    createdPromos.add(promoCode);
    if (created.length > 1) throw ApiException('ALREADY_BOOKED', 'Déjà réservé', status: 409);
    return Booking.fromJson(booking!);
  }

  @override
  Future<({List<BookingSummary> bookings, String? next})> mine(String scope, {String? cursor}) async => (
    bookings: scope == 'upcoming'
        ? [
            BookingSummary.fromJson({
              'id': 'b1',
              'reference': 'IC-ABC123',
              'status': 'PENDING_ACCEPTANCE',
              'seats': 2,
              'totalXof': 10600,
              'isDemo': false,
              'trip': {
                'id': 't1',
                'status': 'PUBLISHED',
                'departureAt': '2026-10-30T07:00:00.000Z',
                'driverName': 'Koffi K.',
              },
              'pickup': {'label': 'Riviera 2', 'plannedAt': '2026-10-30T07:00:00.000Z'},
              'dropoff': {'label': 'Yamoussoukro', 'plannedAt': '2026-10-30T11:04:00.000Z'},
            }),
          ]
        : <BookingSummary>[],
    next: null,
  );

  @override
  Future<Booking> get(String id) async => Booking.fromJson(booking!);

  @override
  Future<Booking> accept(String id) async {
    accepted.add(id);
    return Booking.fromJson({
      ...booking!,
      'status': 'PENDING_PAYMENT',
      'actions': {'canCancel': true},
    });
  }

  @override
  Future<Booking> reject(String id) => throw UnimplementedError();

  @override
  Future<CancelPreview> cancelPreview(String id) async => CancelPreview(refundXof: 0, basis: 'NOTHING_PAID');

  @override
  Future<Booking> cancel(String id, String reason, String key) async {
    cancelled.add(reason);
    return Booking.fromJson({
      ...booking!,
      'status': 'CANCELLED_BY_PASSENGER',
      'cancellationReason': reason,
      'actions': <String, bool>{},
    });
  }

  @override
  Future<void> noShow(String tripId, String bookingId) => throw UnimplementedError();
}

Widget app(FakeBookings fake, String initial, Widget Function(GoRouterState) screen, {FakeTrust? trust}) => ProviderScope(
  overrides: [
    bookingsRepositoryProvider.overrideWithValue(fake),
    trustRepositoryProvider.overrideWithValue(trust ?? FakeTrust()),
  ],
  child: MaterialApp.router(
    routerConfig: GoRouter(
      initialLocation: initial,
      routes: [
        GoRoute(path: '/r', builder: (_, s) => screen(s)),
        GoRoute(path: '/reservations/:id', builder: (_, s) => Text('détail ${s.pathParameters['id']}')),
        GoRoute(path: '/', builder: (_, _) => const Text('accueil')),
        GoRoute(path: '/aide/reclamations/nouvelle', builder: (_, s) => Text('réclamation ${s.uri.queryParameters['reservation']}')),
      ],
    ),
  ),
);

/// Fait défiler jusqu'à l'élément puis le centre (la barre du bas peut masquer le bord de la liste).
Future<void> reveal(WidgetTester tester, Finder finder) async {
  await tester.scrollUntilVisible(finder, 200, scrollable: find.byType(Scrollable).first);
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(() => initializeDateFormatting('fr'));

  group('textes', () {
    test('libellé du statut selon le point de vue', () {
      expect(bookingStatusText('CANCELLED_BY_PASSENGER'), 'Annulée par vous');
      expect(bookingStatusText('CANCELLED_BY_PASSENGER', driver: true), 'Annulée par le passager');
      expect(bookingStatusText('PENDING_ACCEPTANCE', driver: true), 'Demande à traiter');
      expect(bookingTone('CONFIRMED'), BookingTone.success);
      expect(bookingTone('EXPIRED'), BookingTone.muted);
    });

    test('remboursement annoncé avant annulation', () {
      expect(refundText(CancelPreview(refundXof: 0, basis: 'NOTHING_PAID')), contains('gratuite'));
      final policy = refundText(CancelPreview(refundXof: 2500, refundPercent: 50, basis: 'POLICY'));
      expect(policy, contains('2'));
      expect(policy, contains('50 %'));
      expect(
        refundText(CancelPreview(refundXof: 0, refundPercent: 0, basis: 'POLICY')),
        contains('aucun remboursement'),
      );
    });

    test('lecture d’une réservation vue par le conducteur', () {
      final b = Booking.fromJson(bookingJson(role: 'DRIVER'));
      expect(b.isDriver, isTrue);
      expect(b.driverNetXof, 4500);
      expect(b.vehicle, 'Toyota Corolla, Gris');
      expect(b.history.single.by, 'PASSENGER');
    });
  });

  testWidgets('écran 8 : montants, acceptation des conditions obligatoire, une seule clé', (tester) async {
    final fake = FakeBookings(quoteData: quoteJson(), booking: bookingJson());
    await tester.pumpWidget(
      app(fake, '/r', (_) => const BookingScreen(tripId: 't1', pickupStopId: 's0', dropoffStopId: 's1')),
    );
    await tester.pumpAndSettle();
    expect(find.text('Total'), findsOneWidget);
    expect(find.textContaining('Vous payez ensuite par Mobile Money'), findsOneWidget);
    final button = find.widgetWithText(FilledButton, 'Réserver');
    expect(tester.widget<FilledButton>(button).onPressed, isNull);
    await reveal(tester, find.text('J’accepte les conditions d’annulation'));
    await tester.tap(find.text('J’accepte les conditions d’annulation'));
    await tester.pump();
    expect(tester.widget<FilledButton>(button).onPressed, isNotNull);
    await tester.tap(button);
    await tester.pumpAndSettle();
    expect(find.text('détail b1'), findsOneWidget);
    expect(fake.created, hasLength(1));
  });

  testWidgets('écran 8 : trajet à acceptation manuelle', (tester) async {
    final fake = FakeBookings(
      quoteData: quoteJson(mode: 'MANUAL'),
      booking: bookingJson(),
    );
    await tester.pumpWidget(
      app(fake, '/r', (_) => const BookingScreen(tripId: 't1', pickupStopId: 's0', dropoffStopId: 's1')),
    );
    await tester.pumpAndSettle();
    expect(find.text('Envoyer la demande'), findsOneWidget);
    expect(find.textContaining('Le conducteur accepte chaque demande'), findsOneWidget);
  });

  testWidgets('écran 12 : liste des réservations à venir', (tester) async {
    final fake = FakeBookings();
    await tester.pumpWidget(app(fake, '/r', (_) => const MyBookingsScreen()));
    await tester.pumpAndSettle();
    expect(find.text('Riviera 2 → Yamoussoukro'), findsOneWidget);
    expect(find.text('En attente du conducteur'), findsOneWidget);
    await tester.tap(find.text('Passées'));
    await tester.pumpAndSettle();
    expect(find.text('Aucune réservation passée.'), findsOneWidget);
  });

  testWidgets('détail : annulation avec aperçu du remboursement et motif', (tester) async {
    final fake = FakeBookings(booking: bookingJson());
    await tester.pumpWidget(app(fake, '/r', (_) => const BookingDetailScreen(bookingId: 'b1')));
    await tester.pumpAndSettle();
    expect(find.text('En attente de paiement'), findsOneWidget);
    await reveal(tester, find.text('Annuler ma réservation'));
    await tester.tap(find.text('Annuler ma réservation'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Rien n’a été payé'), findsOneWidget);
    final confirm = find.widgetWithText(FilledButton, 'Confirmer l’annulation');
    expect(tester.widget<FilledButton>(confirm).onPressed, isNull);
    await tester.enterText(find.byType(TextField), 'Changement de programme');
    await tester.pump();
    await tester.tap(confirm);
    await tester.pumpAndSettle();
    expect(fake.cancelled, ['Changement de programme']);
    await tester.drag(find.byType(Scrollable).first, const Offset(0, 2000));
    await tester.pumpAndSettle();
    expect(find.text('Annulée par vous'), findsOneWidget);
  });

  testWidgets('détail : le conducteur accepte une demande', (tester) async {
    final fake = FakeBookings(
      booking: bookingJson(status: 'PENDING_ACCEPTANCE', role: 'DRIVER'),
    );
    await tester.pumpWidget(app(fake, '/r', (_) => const BookingDetailScreen(bookingId: 'b1')));
    await tester.pumpAndSettle();
    expect(find.text('Demande à traiter'), findsOneWidget);
    expect(find.text('Vous recevrez'), findsOneWidget);
    await tester.tap(find.text('Accepter'));
    await tester.pumpAndSettle();
    expect(fake.accepted, ['b1']);
    expect(find.text('En attente de paiement'), findsOneWidget);
  });

  testWidgets('écran 8 : code promo appliqué par le devis puis transmis à la réservation', (tester) async {
    final fake = FakeBookings(quoteData: quoteJson(), booking: bookingJson());
    await tester.pumpWidget(
      app(fake, '/r', (_) => const BookingScreen(tripId: 't1', pickupStopId: 's0', dropoffStopId: 's1')),
    );
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'Code promo (facultatif)'), 'nul');
    await tester.tap(find.text('Appliquer'));
    await tester.pumpAndSettle();
    expect(find.text('Ce code promo n’existe pas.'), findsOneWidget);
    expect(fake.quotedPromos.last, isNull); // devis recalculé sans le code refusé
    await tester.enterText(find.widgetWithText(TextField, 'Code promo (facultatif)'), 'bienvenue');
    await tester.tap(find.text('Appliquer'));
    await tester.pumpAndSettle();
    expect(find.text('Code promo BIENVENUE'), findsOneWidget);
    expect(find.text('Code BIENVENUE appliqué.'), findsOneWidget);
    await reveal(tester, find.text('J’accepte les conditions d’annulation'));
    await tester.tap(find.text('J’accepte les conditions d’annulation'));
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Réserver'));
    await tester.pumpAndSettle();
    expect(fake.createdPromos, ['BIENVENUE']);
  });

  testWidgets('détail d’un trajet effectué : avis, réclamation et signalement', (tester) async {
    final json = bookingJson(status: 'COMPLETED', canCancel: false);
    json['trip'] = {...json['trip'] as Map<String, dynamic>, 'status': 'COMPLETED'};
    json['actions'] = {...json['actions'] as Map<String, dynamic>, 'canMessage': false, 'canShare': false};
    final trust = FakeTrust();
    await tester.pumpWidget(app(FakeBookings(booking: json), '/r', (_) => const BookingDetailScreen(bookingId: 'b1'), trust: trust));
    await tester.pumpAndSettle();
    await reveal(tester, find.text('Votre avis sur le conducteur'));
    final publish = find.widgetWithText(FilledButton, 'Publier mon avis');
    expect(tester.widget<FilledButton>(publish).onPressed, isNull);
    await tester.tap(find.byTooltip('4 sur 5 : Bien'));
    await tester.enterText(find.widgetWithText(TextField, 'Commentaire (facultatif, public)'), 'Ponctuel');
    await tester.pump();
    await tester.tap(publish);
    await tester.pumpAndSettle();
    expect(trust.reviews, [(4, 'Ponctuel')]);
    expect(find.textContaining('Vous avez donné 4/5'), findsOneWidget);
    expect(find.text('Revoir les messages'), findsOneWidget);
    await reveal(tester, find.text('Un problème avec ce trajet ?'));
    await tester.tap(find.text('Un problème avec ce trajet ?'));
    await tester.pumpAndSettle();
    expect(find.text('réclamation b1'), findsOneWidget);
  });
}
