import '../auth/auth_session.dart';
import 'models.dart';

/// Paiement mobile, historique et gains (toutes les routes demandent une session).
abstract class PaymentsRepository {
  Future<PaymentMethods> methods();
  Future<Payment> initiate(String bookingId, String method, String payerPhone, String idempotencyKey);
  Future<Payment> get(String paymentId);
  Future<({List<Transaction> items, String? next})> transactions({String? cursor});
  Future<Earnings> earnings();
}

class ApiPaymentsRepository implements PaymentsRepository {
  ApiPaymentsRepository(this._session);
  final AuthSession _session;

  @override
  Future<PaymentMethods> methods() async => PaymentMethods.fromJson(await _session.send('GET', '/payments/methods'));

  @override
  Future<Payment> initiate(String bookingId, String method, String payerPhone, String idempotencyKey) async =>
      Payment.fromJson(
        await _session.send(
          'POST',
          '/bookings/$bookingId/payments',
          body: {'method': method, 'payerPhone': payerPhone},
          headers: {'Idempotency-Key': idempotencyKey},
        ),
      );

  @override
  Future<Payment> get(String paymentId) async => Payment.fromJson(await _session.send('GET', '/payments/$paymentId'));

  @override
  Future<({List<Transaction> items, String? next})> transactions({String? cursor}) async {
    final q = cursor == null ? '' : '?${Uri(queryParameters: {'cursor': cursor}).query}';
    final res = await _session.send('GET', '/me/transactions$q');
    return (
      items: [for (final t in res['data'] as List) Transaction.fromJson(t as Map<String, dynamic>)],
      next: res['nextCursor'] as String?,
    );
  }

  @override
  Future<Earnings> earnings() async => Earnings.fromJson(await _session.send('GET', '/me/earnings'));
}
