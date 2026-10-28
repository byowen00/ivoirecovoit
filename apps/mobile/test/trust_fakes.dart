import 'package:ivoirecovoit/core/api_client.dart';
import 'package:ivoirecovoit/features/trust/models.dart';
import 'package:ivoirecovoit/features/trust/trust_repository.dart';

/// Faux dépôt « confiance » pour les tests d'écrans (aucun appel réseau).
class FakeTrust implements TrustRepository {
  final sent = <String>[];
  final reports = <Map<String, String?>>[];
  final reviews = <(int, String?)>[];
  final read = <String>[];
  final disputes = <(String, String, String)>[];
  bool reviewed = false;
  List<Map<String, dynamic>> messages = [
    {
      'id': 'm1',
      'mine': false,
      'body': 'Bonjour, je pars à 7 h.',
      'wasRedacted': false,
      'hidden': false,
      'createdAt': '2026-10-29T06:00:00.000Z',
    },
  ];

  @override
  Future<({List<AppNotification> items, String? next, int unread})> notifications({String? cursor}) async => (
    items: [
      AppNotification.fromJson({
        'id': 'n1',
        'title': 'Réservation confirmée',
        'body': 'Votre paiement a été validé.',
        'link': '/reservations/b1',
        'readAt': read.contains('n1') ? '2026-10-29T06:00:00.000Z' : null,
        'createdAt': '2026-10-29T05:00:00.000Z',
      }),
    ],
    next: null,
    unread: read.contains('n1') ? 0 : 1,
  );

  @override
  Future<int> unreadCount() async => read.contains('n1') ? 0 : 1;

  @override
  Future<void> markAllRead() async => read.add('n1');

  @override
  Future<void> markRead(List<String> ids) async => read.addAll(ids);

  @override
  Future<NotificationPreferences> preferences() async => NotificationPreferences.fromJson({
    'pushAvailable': false,
    'categories': [
      {'code': 'TRANSACTIONAL', 'label': 'Réservations et paiements', 'mandatory': true, 'enabled': true},
      {'code': 'REMINDERS', 'label': 'Rappels avant le départ', 'mandatory': false, 'enabled': true},
    ],
  });

  @override
  Future<NotificationPreferences> setPreference(String category, bool enabled) => preferences();

  @override
  Future<Conversation> conversation(String bookingId) async => Conversation.fromJson({
    'reference': 'IC-ABC123',
    'other': {'firstName': 'Koffi', 'role': 'DRIVER'},
    'canSend': true,
    'closedReason': null,
    'contactsMasked': true,
    'data': messages,
  });

  @override
  Future<void> sendMessage(String bookingId, String body) async {
    sent.add(body);
    messages = [
      ...messages,
      {
        'id': 'm${messages.length + 1}',
        'mine': true,
        'body': body,
        'wasRedacted': false,
        'hidden': false,
        'createdAt': '2026-10-29T06:01:00.000Z',
      },
    ];
  }

  Map<String, dynamic> _review() => {
    'canReview': !reviewed,
    'deadline': '2026-11-12T00:00:00.000Z',
    'subjectRole': 'DRIVER',
    'mine': reviewed
        ? {
            'rating': reviews.last.$1,
            'comment': reviews.last.$2,
            'published': false,
            'createdAt': '2026-10-29T12:00:00.000Z',
          }
        : null,
  };

  @override
  Future<ReviewStatus> reviewStatus(String bookingId) async => ReviewStatus.fromJson(_review());

  @override
  Future<ReviewStatus> review(String bookingId, int rating, String? comment) async {
    reviews.add((rating, comment));
    reviewed = true;
    return ReviewStatus.fromJson(_review());
  }

  @override
  Future<void> report({
    required String targetType,
    required String targetId,
    String? bookingId,
    required String category,
    required String description,
    required String idempotencyKey,
  }) async =>
      reports.add({'targetType': targetType, 'targetId': targetId, 'category': category, 'description': description});

  @override
  Future<List<MyReport>> myReports() async => [];

  @override
  Future<DisputeEligibility> disputeEligibility(String bookingId) async => DisputeEligibility.fromJson({
    'allowed': true,
    'deadline': '2026-11-05T00:00:00.000Z',
    'openDisputeId': null,
    'reasons': [
      {'code': 'DRIVER_NO_SHOW', 'label': 'Conducteur absent'},
      {'code': 'DRIVER_LATE', 'label': 'Retard important'},
    ],
  });

  Map<String, dynamic> disputeJson() => {
    'id': 'd1',
    'reference': 'R-ABCDEF',
    'bookingId': 'b1',
    'bookingReference': 'IC-ABC123',
    'route': 'Riviera 2 → Yamoussoukro',
    'departureAt': '2026-10-29T07:00:00.000Z',
    'reasonCode': 'DRIVER_LATE',
    'reasonLabel': 'Retard important',
    'description': 'Arrivé avec 45 minutes de retard.',
    'status': 'AWAITING_RESPONSE',
    'openedByMe': true,
    'responseDeadline': '2026-10-31T07:00:00.000Z',
    'decision': null,
    'decisionNote': null,
    'decidedRefundXof': null,
    'resolvedAt': null,
    'createdAt': '2026-10-29T12:00:00.000Z',
    'canReply': true,
    'messages': [
      {'id': 'x1', 'from': 'SUPPORT', 'body': 'Nous examinons votre demande.', 'createdAt': '2026-10-29T12:05:00.000Z'},
    ],
  };

  @override
  Future<Dispute> openDispute(String bookingId, String reasonCode, String description, String key) async {
    disputes.add((bookingId, reasonCode, description));
    return Dispute.fromJson(disputeJson());
  }

  @override
  Future<List<DisputeSummary>> myDisputes() async => [];

  @override
  Future<Dispute> dispute(String id) async => Dispute.fromJson(disputeJson());

  @override
  Future<Dispute> replyDispute(String id, String body) async {
    sent.add(body);
    return Dispute.fromJson(disputeJson());
  }

  @override
  Future<EmergencyNumbers> emergencyNumbers() async => EmergencyNumbers.fromJson({
    'validated': false,
    'notice': 'Numéros à faire valider avant la mise en service.',
    'numbers': [
      {'label': 'Police secours', 'phone': '110'},
    ],
  });

  @override
  Future<({bool active, DateTime? expiresAt})> shareStatus(String bookingId) async => (active: false, expiresAt: null);

  @override
  Future<ShareLink> createShare(String bookingId) async =>
      ShareLink.fromJson({'url': 'https://ivoirecovoit.example/partage/tok', 'expiresAt': '2026-10-30T12:00:00.000Z'});

  @override
  Future<void> revokeShare(String bookingId) async {}
}

/// Erreur d'API prête à l'emploi.
ApiException apiError(String code, String message) => ApiException(code, message, status: 400);
