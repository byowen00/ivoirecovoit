DateTime _date(Object? v) => DateTime.parse(v as String);
DateTime? _dateOrNull(Object? v) => v == null ? null : DateTime.parse(v as String);

// ------------------------------------------------------------------ notifications (écran 13)

class AppNotification {
  AppNotification.fromJson(Map<String, dynamic> j)
    : id = j['id'] as String,
      title = j['title'] as String,
      body = j['body'] as String,
      link = j['link'] as String?,
      readAt = _dateOrNull(j['readAt']),
      createdAt = _date(j['createdAt']);
  final String id;
  final String title;
  final String body;
  final String? link;
  final DateTime? readAt;
  final DateTime createdAt;
}

class NotificationCategory {
  NotificationCategory.fromJson(Map<String, dynamic> j)
    : code = j['code'] as String,
      label = j['label'] as String,
      mandatory = j['mandatory'] == true,
      enabled = j['enabled'] == true;
  final String code;
  final String label;
  final bool mandatory;
  final bool enabled;
}

class NotificationPreferences {
  NotificationPreferences.fromJson(Map<String, dynamic> j)
    : pushAvailable = j['pushAvailable'] == true,
      categories = [for (final c in j['categories'] as List) NotificationCategory.fromJson(c as Map<String, dynamic>)];
  final bool pushAvailable;
  final List<NotificationCategory> categories;
}

// ------------------------------------------------------------------ messagerie

class ChatMessage {
  ChatMessage.fromJson(Map<String, dynamic> j)
    : id = j['id'] as String,
      mine = j['mine'] == true,
      body = j['body'] as String,
      wasRedacted = j['wasRedacted'] == true,
      hidden = j['hidden'] == true,
      createdAt = _date(j['createdAt']);
  final String id;
  final bool mine;
  final String body;
  final bool wasRedacted;
  final bool hidden;
  final DateTime createdAt;
}

class Conversation {
  Conversation.fromJson(Map<String, dynamic> j)
    : reference = j['reference'] as String,
      otherName = (j['other'] as Map)['firstName'] as String?,
      otherRole = (j['other'] as Map)['role'] as String,
      canSend = j['canSend'] == true,
      closedReason = j['closedReason'] as String?,
      contactsMasked = j['contactsMasked'] == true,
      messages = [for (final m in j['data'] as List) ChatMessage.fromJson(m as Map<String, dynamic>)];
  final String reference;
  final String? otherName;
  final String otherRole;
  final bool canSend;
  final String? closedReason;
  final bool contactsMasked;
  final List<ChatMessage> messages;
}

// ------------------------------------------------------------------ avis

class ReviewStatus {
  ReviewStatus.fromJson(Map<String, dynamic> j)
    : canReview = j['canReview'] == true,
      deadline = _dateOrNull(j['deadline']),
      subjectRole = j['subjectRole'] as String,
      mineRating = j['mine'] == null ? null : ((j['mine'] as Map)['rating'] as num).toInt(),
      mineComment = j['mine'] == null ? null : (j['mine'] as Map)['comment'] as String?,
      minePublished = j['mine'] != null && (j['mine'] as Map)['published'] == true;
  final bool canReview;
  final DateTime? deadline;
  final String subjectRole;
  final int? mineRating;
  final String? mineComment;
  final bool minePublished;
}

// ------------------------------------------------------------------ signalements

const reportCategoryLabel = {
  'DANGEROUS_DRIVING': 'Conduite dangereuse',
  'HARASSMENT': 'Harcèlement ou menace',
  'FRAUD': 'Fraude ou arnaque',
  'NO_SHOW': 'Absence au rendez-vous',
  'INAPPROPRIATE': 'Contenu ou comportement inapproprié',
  'OTHER': 'Autre',
};

const reportStatusLabel = {
  'OPEN': 'Reçu',
  'IN_REVIEW': 'En cours d’examen',
  'ACTION_TAKEN': 'Traité, mesure prise',
  'DISMISSED': 'Classé sans suite',
};

class MyReport {
  MyReport.fromJson(Map<String, dynamic> j)
    : category = j['category'] as String,
      status = j['status'] as String,
      createdAt = _date(j['createdAt']);
  final String category;
  final String status;
  final DateTime createdAt;
}

// ------------------------------------------------------------------ réclamations (écran 16)

const disputeStatusLabel = {
  'OPEN': 'Ouverte',
  'AWAITING_RESPONSE': 'En attente de la réponse de l’autre partie',
  'IN_REVIEW': 'En cours d’examen par le support',
  'RESOLVED': 'Décision rendue',
  'REJECTED': 'Rejetée',
  'CLOSED': 'Close',
};

const disputeDecisionLabel = {
  'NO_REFUND': 'Pas de remboursement',
  'PARTIAL_REFUND': 'Remboursement partiel',
  'FULL_REFUND': 'Remboursement intégral',
  'DRIVER_PENALTY': 'Mesure envers le conducteur',
};

class DisputeSummary {
  DisputeSummary.fromJson(Map<String, dynamic> j)
    : id = j['id'] as String,
      reference = j['reference'] as String,
      status = j['status'] as String,
      reasonLabel = j['reasonLabel'] as String,
      bookingReference = j['bookingReference'] as String,
      createdAt = _date(j['createdAt']);
  final String id;
  final String reference;
  final String status;
  final String reasonLabel;
  final String bookingReference;
  final DateTime createdAt;
}

class DisputeMessage {
  DisputeMessage.fromJson(Map<String, dynamic> j)
    : from = j['from'] as String,
      body = j['body'] as String,
      createdAt = _date(j['createdAt']);
  final String from;
  final String body;
  final DateTime createdAt;
}

class Dispute {
  Dispute.fromJson(Map<String, dynamic> j)
    : id = j['id'] as String,
      reference = j['reference'] as String,
      bookingId = j['bookingId'] as String,
      bookingReference = j['bookingReference'] as String,
      route = j['route'] as String,
      reasonLabel = j['reasonLabel'] as String,
      description = j['description'] as String,
      status = j['status'] as String,
      responseDeadline = _dateOrNull(j['responseDeadline']),
      decision = j['decision'] as String?,
      decisionNote = j['decisionNote'] as String?,
      decidedRefundXof = j['decidedRefundXof'] == null ? null : (j['decidedRefundXof'] as num).toInt(),
      canReply = j['canReply'] == true,
      messages = [for (final m in j['messages'] as List) DisputeMessage.fromJson(m as Map<String, dynamic>)];
  final String id;
  final String reference;
  final String bookingId;
  final String bookingReference;
  final String route;
  final String reasonLabel;
  final String description;
  final String status;
  final DateTime? responseDeadline;
  final String? decision;
  final String? decisionNote;
  final int? decidedRefundXof;
  final bool canReply;
  final List<DisputeMessage> messages;
}

class DisputeEligibility {
  DisputeEligibility.fromJson(Map<String, dynamic> j)
    : allowed = j['allowed'] == true,
      deadline = _dateOrNull(j['deadline']),
      openDisputeId = j['openDisputeId'] as String?,
      reasons = [
        for (final r in j['reasons'] as List) (code: (r as Map)['code'] as String, label: r['label'] as String),
      ];
  final bool allowed;
  final DateTime? deadline;
  final String? openDisputeId;
  final List<({String code, String label})> reasons;
}

// ------------------------------------------------------------------ sécurité

class EmergencyNumbers {
  EmergencyNumbers.fromJson(Map<String, dynamic> j)
    : validated = j['validated'] == true,
      notice = j['notice'] as String?,
      numbers = [
        for (final n in j['numbers'] as List) (label: (n as Map)['label'] as String, phone: n['phone'] as String),
      ];
  final bool validated;
  final String? notice;
  final List<({String label, String phone})> numbers;
}

class ShareLink {
  ShareLink.fromJson(Map<String, dynamic> j) : url = j['url'] as String, expiresAt = _date(j['expiresAt']);
  final String url;
  final DateTime expiresAt;
}

/// Texte prêt à envoyer par SMS ou WhatsApp à un proche.
String shareMessage(String url, String route) =>
    'Je voyage avec IvoireCovoit ($route). Suivez mon trajet ici : $url (horaires estimés, pas de position GPS).';

/// Lien « sms: » avec le texte prérempli (le destinataire se choisit dans l'application SMS).
Uri smsUri(String text) => Uri.parse('sms:?body=${Uri.encodeComponent(text)}');
