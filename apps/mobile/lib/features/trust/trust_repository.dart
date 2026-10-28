import '../../core/api_client.dart';
import '../auth/auth_session.dart';
import 'models.dart';

/// Notifications, messagerie, avis, signalements, réclamations et sécurité.
abstract class TrustRepository {
  Future<({List<AppNotification> items, String? next, int unread})> notifications({String? cursor});
  Future<int> unreadCount();
  Future<void> markAllRead();
  Future<void> markRead(List<String> ids);
  Future<NotificationPreferences> preferences();
  Future<NotificationPreferences> setPreference(String category, bool enabled);

  Future<Conversation> conversation(String bookingId);
  Future<void> sendMessage(String bookingId, String body);

  Future<ReviewStatus> reviewStatus(String bookingId);
  Future<ReviewStatus> review(String bookingId, int rating, String? comment);

  Future<void> report({
    required String targetType,
    required String targetId,
    String? bookingId,
    required String category,
    required String description,
    required String idempotencyKey,
  });
  Future<List<MyReport>> myReports();

  Future<DisputeEligibility> disputeEligibility(String bookingId);
  Future<Dispute> openDispute(String bookingId, String reasonCode, String description, String idempotencyKey);
  Future<List<DisputeSummary>> myDisputes();
  Future<Dispute> dispute(String id);
  Future<Dispute> replyDispute(String id, String body);

  Future<EmergencyNumbers> emergencyNumbers();
  Future<({bool active, DateTime? expiresAt})> shareStatus(String bookingId);
  Future<ShareLink> createShare(String bookingId);
  Future<void> revokeShare(String bookingId);
}

class ApiTrustRepository implements TrustRepository {
  ApiTrustRepository(this._api, this._session);
  final ApiClient _api;
  final AuthSession _session;

  @override
  Future<({List<AppNotification> items, String? next, int unread})> notifications({String? cursor}) async {
    final q = Uri(queryParameters: {'limit': '30', 'cursor': ?cursor}).query;
    final res = await _session.send('GET', '/notifications?$q');
    return (
      items: [for (final n in res['data'] as List) AppNotification.fromJson(n as Map<String, dynamic>)],
      next: res['nextCursor'] as String?,
      unread: (res['unreadCount'] as num? ?? 0).toInt(),
    );
  }

  @override
  Future<int> unreadCount() async =>
      ((await _session.send('GET', '/notifications/unread-count'))['unreadCount'] as num).toInt();

  @override
  Future<void> markAllRead() => _session.send('POST', '/notifications/read', body: {'all': true});

  @override
  Future<void> markRead(List<String> ids) => _session.send('POST', '/notifications/read', body: {'ids': ids});

  @override
  Future<NotificationPreferences> preferences() async =>
      NotificationPreferences.fromJson(await _session.send('GET', '/me/notification-preferences'));

  @override
  Future<NotificationPreferences> setPreference(String category, bool enabled) async =>
      NotificationPreferences.fromJson(
        await _session.send('PUT', '/me/notification-preferences', body: {category: enabled}),
      );

  @override
  Future<Conversation> conversation(String bookingId) async =>
      Conversation.fromJson(await _session.send('GET', '/bookings/$bookingId/messages'));

  @override
  Future<void> sendMessage(String bookingId, String body) =>
      _session.send('POST', '/bookings/$bookingId/messages', body: {'body': body});

  @override
  Future<ReviewStatus> reviewStatus(String bookingId) async =>
      ReviewStatus.fromJson(await _session.send('GET', '/bookings/$bookingId/review'));

  @override
  Future<ReviewStatus> review(String bookingId, int rating, String? comment) async => ReviewStatus.fromJson(
    await _session.send('POST', '/bookings/$bookingId/reviews', body: {'rating': rating, 'comment': ?comment}),
  );

  @override
  Future<void> report({
    required String targetType,
    required String targetId,
    String? bookingId,
    required String category,
    required String description,
    required String idempotencyKey,
  }) => _session.send(
    'POST',
    '/reports',
    body: {
      'targetType': targetType,
      'targetId': targetId,
      'bookingId': ?bookingId,
      'category': category,
      'description': description,
    },
    headers: {'Idempotency-Key': idempotencyKey},
  );

  @override
  Future<List<MyReport>> myReports() async => [
    for (final r in (await _session.send('GET', '/reports/mine'))['data'] as List)
      MyReport.fromJson(r as Map<String, dynamic>),
  ];

  @override
  Future<DisputeEligibility> disputeEligibility(String bookingId) async =>
      DisputeEligibility.fromJson(await _session.send('GET', '/bookings/$bookingId/dispute'));

  @override
  Future<Dispute> openDispute(String bookingId, String reasonCode, String description, String idempotencyKey) async =>
      Dispute.fromJson(
        await _session.send(
          'POST',
          '/disputes',
          body: {'bookingId': bookingId, 'reasonCode': reasonCode, 'description': description},
          headers: {'Idempotency-Key': idempotencyKey},
        ),
      );

  @override
  Future<List<DisputeSummary>> myDisputes() async => [
    for (final d in (await _session.send('GET', '/disputes/mine'))['data'] as List)
      DisputeSummary.fromJson(d as Map<String, dynamic>),
  ];

  @override
  Future<Dispute> dispute(String id) async => Dispute.fromJson(await _session.send('GET', '/disputes/$id'));

  @override
  Future<Dispute> replyDispute(String id, String body) async =>
      Dispute.fromJson(await _session.send('POST', '/disputes/$id/messages', body: {'body': body}));

  @override
  Future<EmergencyNumbers> emergencyNumbers() async =>
      EmergencyNumbers.fromJson(await _api.get('/safety/emergency-numbers'));

  @override
  Future<({bool active, DateTime? expiresAt})> shareStatus(String bookingId) async {
    final r = await _session.send('GET', '/bookings/$bookingId/share');
    final exp = r['expiresAt'] as String?;
    return (active: r['active'] == true, expiresAt: exp == null ? null : DateTime.parse(exp));
  }

  @override
  Future<ShareLink> createShare(String bookingId) async =>
      ShareLink.fromJson(await _session.send('POST', '/bookings/$bookingId/share', body: {}));

  @override
  Future<void> revokeShare(String bookingId) => _session.send('DELETE', '/bookings/$bookingId/share');
}
