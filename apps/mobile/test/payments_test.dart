import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:ivoirecovoit/core/api_client.dart';
import 'package:ivoirecovoit/core/format.dart';
import 'package:ivoirecovoit/features/bookings/booking_detail_screen.dart';
import 'package:ivoirecovoit/features/bookings/bookings_repository.dart';
import 'package:ivoirecovoit/features/bookings/models.dart';
import 'package:ivoirecovoit/features/payments/models.dart';
import 'package:ivoirecovoit/features/payments/payment_history_screen.dart';
import 'package:ivoirecovoit/features/payments/payment_screen.dart';
import 'package:ivoirecovoit/features/payments/payments_repository.dart';
import 'package:ivoirecovoit/providers.dart';

const _point = {'stopId': 's', 'label': 'Riviera 2', 'meetingPoint': null, 'plannedAt': '2026-10-30T07:00:00.000Z'};

Map<String, dynamic> bookingJson({
  String status = 'PENDING_PAYMENT',
  bool canPay = true,
  String paymentStatus = 'UNPAID',
}) => {
  'id': 'b1',
  'reference': 'IC-ABC123',
  'status': status,
  'paymentStatus': paymentStatus,
  'paymentMethod': null,
  'seats': 1,
  'unitPriceXof': 5000,
  'subtotalXof': 5000,
  'serviceFeeXof': 300,
  'discountXof': 0,
  'totalXof': 5300,
  'holdExpiresAt': DateTime.now().add(const Duration(minutes: 10)).toUtc().toIso8601String(),
  'acceptanceDeadline': null,
  'confirmedAt': null,
  'cancelledAt': null,
  'cancellationReason': null,
  'refundDueXof': null,
  'freeCancellation': false,
  'createdAt': '2026-10-28T17:54:00.000Z',
  'isDemo': true,
  'viewerRole': 'PASSENGER',
  'cancellationPolicy': {'code': 'STANDARD', 'label': 'Standard', 'summary': '…'},
  'payment': null,
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
  'pickup': _point,
  'dropoff': {..._point, 'label': 'Yamoussoukro'},
  'history': <Object>[],
  'actions': {'canCancel': true, 'canPay': canPay},
};

Map<String, dynamic> paymentJson(String status, {String bookingStatus = 'PENDING_PAYMENT', String? failure}) => {
  'id': 'p1',
  'bookingId': 'b1',
  'status': status,
  'method': 'WAVE',
  'amountXof': 5300,
  'payerPhoneMasked': '+225 07 •• •• •• 07',
  'expiresAt': DateTime.now().add(const Duration(minutes: 20)).toUtc().toIso8601String(),
  'failureMessage': failure,
  'sandbox': true,
  'booking': {'status': bookingStatus, 'paymentStatus': 'PROCESSING'},
  'nextAction': status == 'PENDING'
      ? {
          'type': 'REDIRECT',
          'url': 'http://localhost:3000/api/v1/sandbox/pay/SBX-1',
          'instructions': 'Bac à sable : aucun argent réel.',
        }
      : null,
};

class FakeBookings implements BookingsRepository {
  Map<String, dynamic> booking = bookingJson();
  @override
  Future<Booking> get(String id) async => Booking.fromJson(booking);
  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

class FakePayments implements PaymentsRepository {
  final initiated = <(String, String, String)>[];
  final statuses = <Map<String, dynamic>>[];
  ApiException? initiateError;

  @override
  Future<PaymentMethods> methods() async => PaymentMethods.fromJson({
    'provider': 'sandbox',
    'sandbox': true,
    'cashEnabled': false,
    'methods': [
      for (final m in ['WAVE', 'ORANGE_MONEY', 'MTN_MOMO', 'MOOV_MONEY']) {'code': m, 'label': methodLabel[m]},
    ],
  });

  @override
  Future<Payment> initiate(String bookingId, String method, String payerPhone, String key) async {
    if (initiateError != null) throw initiateError!;
    initiated.add((method, payerPhone, key));
    return Payment.fromJson(paymentJson('PENDING'));
  }

  @override
  Future<Payment> get(String id) async => Payment.fromJson(statuses.length > 1 ? statuses.removeAt(0) : statuses.first);

  @override
  Future<({List<Transaction> items, String? next})> transactions({String? cursor}) async => (
    items: [
      Transaction.fromJson({
        'kind': 'REFUND',
        'id': 'r1',
        'bookingId': 'b1',
        'bookingReference': 'IC-ABC123',
        'amountXof': 5300,
        'status': 'SUCCEEDED',
        'method': null,
        'reason': 'DRIVER_CANCELLED',
        'createdAt': '2026-10-28T19:00:00.000Z',
        'route': 'Riviera 2 → Yamoussoukro',
      }),
      Transaction.fromJson({
        'kind': 'PAYMENT',
        'id': 'p1',
        'bookingId': 'b1',
        'bookingReference': 'IC-ABC123',
        'amountXof': 5300,
        'status': 'SUCCEEDED',
        'method': 'WAVE',
        'reason': null,
        'createdAt': '2026-10-28T18:00:00.000Z',
        'route': 'Riviera 2 → Yamoussoukro',
      }),
    ],
    next: null,
  );

  @override
  Future<Earnings> earnings() async => Earnings.fromJson({
    'totals': {'grossXof': 5000, 'commissionXof': 500, 'pendingXof': 4500, 'payableXof': 0, 'paidXof': 0},
    'payoutsAvailable': false,
    'trips': [
      {
        'tripId': 't1',
        'publicRef': 'T-XYZ',
        'departureAt': '2026-10-30T07:00:00.000Z',
        'tripStatus': 'PUBLISHED',
        'origin': 'Abidjan',
        'destination': 'Yamoussoukro',
        'dueXof': 4500,
        'bookings': [
          {
            'reference': 'IC-ABC123',
            'bookingStatus': 'CONFIRMED',
            'seats': 1,
            'grossXof': 5000,
            'commissionXof': 500,
            'netXof': 4500,
            'adjustmentXof': 0,
            'dueXof': 4500,
            'status': 'PENDING',
            'payableAt': null,
          },
        ],
      },
    ],
  });
}

Widget app(FakeBookings bookings, FakePayments payments, Widget screen) => ProviderScope(
  overrides: [
    bookingsRepositoryProvider.overrideWithValue(bookings),
    paymentsRepositoryProvider.overrideWithValue(payments),
  ],
  child: MaterialApp.router(
    routerConfig: GoRouter(
      initialLocation: '/p',
      routes: [
        GoRoute(path: '/p', builder: (_, _) => screen),
        GoRoute(path: '/reservations/:id', builder: (_, s) => Text('détail ${s.pathParameters['id']}')),
        GoRoute(path: '/paiements', builder: (_, _) => const Text('historique')),
      ],
    ),
  ),
);

final _pay = 'Payer ${formatXof(5300)}';

/// Écran haut : tout le formulaire de paiement reste construit (liste paresseuse).
void _tall(WidgetTester tester) {
  tester.view.physicalSize = const Size(800, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

Future<void> _tap(WidgetTester tester, Finder f) async {
  await tester.ensureVisible(f);
  await tester.tap(f);
}

void main() {
  setUpAll(() => initializeDateFormatting('fr'));

  group('règles', () {
    test('numéro payeur : mobiles ivoiriens seulement', () {
      for (final n in ['0707070707', '07 07 07 07 07', '+225 0505050505']) {
        expect(isCiMobile(n), isTrue, reason: n);
      }
      for (final n in ['2721000000', '070707', '0807070707']) {
        expect(isCiMobile(n), isFalse, reason: n);
      }
    });

    test('le résultat vient du serveur : succès seulement si la réservation est confirmée', () {
      Payment p(String s, String b, [String? f]) => Payment.fromJson(paymentJson(s, bookingStatus: b, failure: f));
      expect(paymentOutcome(p('PENDING', 'PENDING_PAYMENT'), holdOpen: true).kind, OutcomeKind.waiting);
      expect(paymentOutcome(p('SUCCEEDED', 'CONFIRMED'), holdOpen: false).kind, OutcomeKind.confirmed);
      expect(paymentOutcome(p('SUCCEEDED', 'EXPIRED'), holdOpen: false).kind, OutcomeKind.late);
      final failed = paymentOutcome(p('FAILED', 'PENDING_PAYMENT', 'Solde insuffisant.'), holdOpen: true);
      expect(failed.canRetry, isTrue);
      expect(failed.text, contains('Rien ne vous a été débité'));
      expect(paymentOutcome(p('EXPIRED', 'EXPIRED'), holdOpen: false).canRetry, isFalse);
    });
  });

  testWidgets('écran 9 : choix du moyen, numéro, attente puis confirmation par le serveur', (tester) async {
    _tall(tester);
    final bookings = FakeBookings();
    final payments = FakePayments()
      ..statuses.addAll([paymentJson('PENDING'), paymentJson('SUCCEEDED', bookingStatus: 'CONFIRMED')]);
    final opened = <Uri>[];
    await tester.pumpWidget(
      app(
        bookings,
        payments,
        PaymentScreen(
          bookingId: 'b1',
          pollInterval: const Duration(milliseconds: 100),
          openUrl: (u) async {
            opened.add(u);
            return true;
          },
        ),
      ),
    );
    await tester.pumpAndSettle(const Duration(milliseconds: 50));
    expect(find.textContaining('aucun argent réel'), findsOneWidget);
    expect(find.textContaining('jamais votre code secret'), findsOneWidget);

    await _tap(tester, find.text(_pay));
    await tester.pump();
    expect(find.text('Choisissez un moyen de paiement.'), findsOneWidget);
    await _tap(tester, find.text('Wave'));
    await tester.enterText(find.byType(TextField), '123');
    await _tap(tester, find.text(_pay));
    await tester.pump();
    expect(find.textContaining('Numéro mobile ivoirien attendu'), findsOneWidget);
    expect(payments.initiated, isEmpty);

    await tester.enterText(find.byType(TextField), '07 07 07 07 07');
    await _tap(tester, find.text(_pay));
    await tester.pump();
    await tester.pump();
    expect(payments.initiated.single.$1, 'WAVE');
    expect(opened.single.path, '/api/v1/sandbox/pay/SBX-1');
    expect(find.text('En attente de validation'), findsOneWidget);

    bookings.booking = bookingJson(status: 'CONFIRMED', canPay: false, paymentStatus: 'PAID');
    await tester.pump(const Duration(milliseconds: 120));
    await tester.pump(const Duration(milliseconds: 120));
    await tester.pump();
    expect(find.text('Paiement confirmé'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('écran 9 : paiement refusé, nouvel essai avec une nouvelle clé', (tester) async {
    _tall(tester);
    final payments = FakePayments()..statuses.addAll([paymentJson('FAILED', failure: 'Solde insuffisant.')]);
    await tester.pumpWidget(
      app(
        FakeBookings(),
        payments,
        PaymentScreen(bookingId: 'b1', pollInterval: const Duration(milliseconds: 100), openUrl: (_) async => true),
      ),
    );
    await tester.pumpAndSettle(const Duration(milliseconds: 50));
    await _tap(tester, find.text('Orange Money'));
    await tester.enterText(find.byType(TextField), '0707070707');
    await _tap(tester, find.text(_pay));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 120));
    await tester.pump();
    expect(find.text('Paiement non abouti'), findsOneWidget);
    expect(find.textContaining('Solde insuffisant. Rien ne vous a été débité. Vous pouvez réessayer.'), findsOneWidget);
    await _tap(tester, find.text('Réessayer'));
    await tester.pumpAndSettle(const Duration(milliseconds: 50));
    await _tap(tester, find.text('Orange Money'));
    await tester.enterText(find.byType(TextField), '0707070707');
    await _tap(tester, find.text(_pay));
    await tester.pump();
    expect(payments.initiated.length, 2);
    expect(payments.initiated[0].$3, isNot(payments.initiated[1].$3));
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('écran 9 : erreur du serveur affichée telle quelle', (tester) async {
    _tall(tester);
    final payments = FakePayments()
      ..initiateError = ApiException('BOOKING_EXPIRED', 'Le délai de paiement est dépassé.', status: 409);
    await tester.pumpWidget(app(FakeBookings(), payments, PaymentScreen(bookingId: 'b1', openUrl: (_) async => true)));
    await tester.pumpAndSettle(const Duration(milliseconds: 50));
    await _tap(tester, find.text('MTN MoMo'));
    await tester.enterText(find.byType(TextField), '0505050505');
    await _tap(tester, find.text(_pay));
    await tester.pump();
    await tester.pump();
    expect(find.text('Le délai de paiement est dépassé.'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('écran 14 : paiements, remboursements et gains du conducteur', (tester) async {
    await tester.pumpWidget(app(FakeBookings(), FakePayments(), const PaymentHistoryScreen()));
    await tester.pumpAndSettle();
    expect(find.text('Remboursement'), findsOneWidget);
    expect(find.text('+ ${formatXof(5300)}'), findsOneWidget);
    expect(find.textContaining('annulation par le conducteur'), findsOneWidget);
    expect(find.textContaining('Wave'), findsOneWidget);
    await _tap(tester, find.text('Mes gains'));
    await tester.pumpAndSettle();
    expect(find.text('Abidjan → Yamoussoukro'), findsOneWidget);
    expect(find.textContaining('En attente (48 h après le trajet)'), findsOneWidget);
    expect(find.textContaining('n’est pas encore ouvert'), findsOneWidget);
  });

  testWidgets('réservation : bouton Payer, puis état du remboursement après annulation', (tester) async {
    _tall(tester);
    final bookings = FakeBookings();
    await tester.pumpWidget(app(bookings, FakePayments(), const BookingDetailScreen(bookingId: 'b1')));
    await tester.pumpAndSettle();
    expect(find.text(_pay), findsOneWidget);
    expect(find.textContaining('Payez par Mobile Money'), findsOneWidget);

    bookings.booking = {
      ...bookingJson(status: 'CANCELLED_BY_DRIVER', canPay: false, paymentStatus: 'REFUNDED'),
      'refundDueXof': 5300,
      'cancellationReason': 'Panne',
    };
    await tester.pumpWidget(
      app(bookings, FakePayments(), const BookingDetailScreen(bookingId: 'b1', key: ValueKey(2))),
    );
    await tester.pumpAndSettle();
    expect(find.text(_pay), findsNothing);
    expect(find.textContaining('Remboursement de ${formatXof(5300)} effectué'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });
}
