import '../auth/auth_session.dart';
import 'models.dart';

/// Réservations (toutes les routes demandent une session).
abstract class BookingsRepository {
  Future<BookingQuote> quote(String tripId, String pickupStopId, String dropoffStopId, int seats, {String? promoCode});
  Future<Booking> create(
    String tripId,
    String pickupStopId,
    String dropoffStopId,
    int seats, {
    required String idempotencyKey,
    bool cash = false,
    String? promoCode,
  });
  Future<({List<BookingSummary> bookings, String? next})> mine(String scope, {String? cursor});
  Future<Booking> get(String id);
  Future<Booking> accept(String id);
  Future<Booking> reject(String id);
  Future<CancelPreview> cancelPreview(String id);
  Future<Booking> cancel(String id, String reason, String idempotencyKey);
  Future<void> noShow(String tripId, String bookingId);
}

class ApiBookingsRepository implements BookingsRepository {
  ApiBookingsRepository(this._session);
  final AuthSession _session;

  Map<String, Object?> _segment(String tripId, String pickupStopId, String dropoffStopId, int seats) => {
    'tripId': tripId,
    'pickupStopId': pickupStopId,
    'dropoffStopId': dropoffStopId,
    'seats': seats,
  };

  @override
  Future<BookingQuote> quote(
    String tripId,
    String pickupStopId,
    String dropoffStopId,
    int seats, {
    String? promoCode,
  }) async => BookingQuote.fromJson(
    await _session.send(
      'POST',
      '/bookings/quote',
      body: {..._segment(tripId, pickupStopId, dropoffStopId, seats), 'promoCode': ?promoCode},
    ),
  );

  @override
  Future<Booking> create(
    String tripId,
    String pickupStopId,
    String dropoffStopId,
    int seats, {
    required String idempotencyKey,
    bool cash = false,
    String? promoCode,
  }) async => Booking.fromJson(
    await _session.send(
      'POST',
      '/bookings',
      body: {
        ..._segment(tripId, pickupStopId, dropoffStopId, seats),
        'acceptCancellationPolicy': true,
        if (cash) 'paymentMethod': 'CASH',
        'promoCode': ?promoCode,
      },
      headers: {'Idempotency-Key': idempotencyKey},
    ),
  );

  @override
  Future<({List<BookingSummary> bookings, String? next})> mine(String scope, {String? cursor}) async {
    final q = Uri(queryParameters: {'scope': scope, 'cursor': ?cursor}).query;
    final res = await _session.send('GET', '/bookings/mine?$q');
    return (
      bookings: [for (final b in res['data'] as List) BookingSummary.fromJson(b as Map<String, dynamic>)],
      next: res['nextCursor'] as String?,
    );
  }

  @override
  Future<Booking> get(String id) async => Booking.fromJson(await _session.send('GET', '/bookings/$id'));

  @override
  Future<Booking> accept(String id) async =>
      Booking.fromJson(await _session.send('POST', '/bookings/$id/accept', body: {}));

  @override
  Future<Booking> reject(String id) async =>
      Booking.fromJson(await _session.send('POST', '/bookings/$id/reject', body: {}));

  @override
  Future<CancelPreview> cancelPreview(String id) async =>
      CancelPreview.fromJson(await _session.send('POST', '/bookings/$id/cancel/preview', body: {}));

  @override
  Future<Booking> cancel(String id, String reason, String idempotencyKey) async => Booking.fromJson(
    (await _session.send(
          'POST',
          '/bookings/$id/cancel',
          body: {'reason': reason},
          headers: {'Idempotency-Key': idempotencyKey},
        ))['booking']
        as Map<String, dynamic>,
  );

  @override
  Future<void> noShow(String tripId, String bookingId) async =>
      _session.send('POST', '/trips/$tripId/bookings/$bookingId/no-show', body: {});
}
