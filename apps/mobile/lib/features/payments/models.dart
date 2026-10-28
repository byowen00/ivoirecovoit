int _i(Object? v) => (v as num).toInt();
DateTime _date(Object? v) => DateTime.parse(v as String);
DateTime? _dateOrNull(Object? v) => v == null ? null : DateTime.parse(v as String);

const methodLabel = {
  'WAVE': 'Wave',
  'ORANGE_MONEY': 'Orange Money',
  'MTN_MOMO': 'MTN MoMo',
  'MOOV_MONEY': 'Moov Money',
};

const _paymentStatusLabel = {
  'CREATED': 'En préparation',
  'PENDING': 'En attente de validation',
  'SUCCEEDED': 'Réussi',
  'FAILED': 'Refusé',
  'EXPIRED': 'Expiré',
  'CANCELLED': 'Annulé',
};

const _refundStatusLabel = {
  'REQUESTED': 'Demandé',
  'APPROVED': 'Approuvé',
  'PROCESSING': 'En cours',
  'SUCCEEDED': 'Remboursé',
  'FAILED': 'Échec, nouvel essai prévu',
  'REJECTED': 'Refusé',
  'MANUAL_REQUIRED': 'Traitement manuel par l’équipe',
};

const refundReasonLabel = {
  'DRIVER_CANCELLED': 'annulation par le conducteur',
  'PASSENGER_CANCELLED': 'votre annulation',
  'TRIP_CHANGED': 'trajet modifié',
  'DRIVER_LATE': 'retard du conducteur',
  'LATE_PAYMENT': 'paiement arrivé après expiration',
  'TRIP_NOT_STARTED': 'trajet non effectué',
  'DISPUTE': 'réclamation',
  'ADMIN': 'décision d’IvoireCovoit',
};

const earningStatusLabel = {
  'PENDING': 'En attente (48 h après le trajet)',
  'PAYABLE': 'Disponible',
  'IN_PAYOUT': 'Versement en cours',
  'PAID': 'Versé',
  'VOID': 'Annulé (passager remboursé)',
};

/// Numéro mobile ivoirien à 10 chiffres (01, 05, 07), avec ou sans +225 et espaces.
bool isCiMobile(String input) {
  final digits = input.replaceAll(RegExp(r'[\s.-]'), '').replaceFirst(RegExp(r'^(\+225|00225)'), '');
  return RegExp(r'^0[157]\d{8}$').hasMatch(digits);
}

class PaymentMethods {
  PaymentMethods.fromJson(Map<String, dynamic> j)
    : sandbox = j['sandbox'] == true,
      cashEnabled = j['cashEnabled'] == true,
      methods = [for (final m in j['methods'] as List) (m as Map<String, dynamic>)['code'] as String];
  final bool sandbox;
  final bool cashEnabled;
  final List<String> methods;
}

class NextAction {
  NextAction.fromJson(Map<String, dynamic> j)
    : type = j['type'] as String,
      url = j['url'] as String?,
      instructions = j['instructions'] as String;
  final String type;
  final String? url;
  final String instructions;
}

class Payment {
  Payment.fromJson(Map<String, dynamic> j)
    : id = j['id'] as String,
      bookingId = j['bookingId'] as String,
      status = j['status'] as String,
      method = j['method'] as String,
      amountXof = _i(j['amountXof']),
      payerPhoneMasked = j['payerPhoneMasked'] as String?,
      expiresAt = _date(j['expiresAt']),
      failureMessage = j['failureMessage'] as String?,
      sandbox = j['sandbox'] == true,
      bookingStatus = (j['booking'] as Map<String, dynamic>)['status'] as String,
      nextAction = j['nextAction'] == null ? null : NextAction.fromJson(j['nextAction'] as Map<String, dynamic>);
  final String id;
  final String bookingId;
  final String status;
  final String method;
  final int amountXof;
  final String? payerPhoneMasked;
  final DateTime expiresAt;
  final String? failureMessage;
  final bool sandbox;
  final String bookingStatus;
  final NextAction? nextAction;

  bool get waiting => status == 'CREATED' || status == 'PENDING';
}

enum OutcomeKind { waiting, confirmed, late, failed }

class Outcome {
  const Outcome(this.kind, [this.text = '', this.canRetry = false]);
  final OutcomeKind kind;
  final String text;
  final bool canRetry;
}

/// Ce que l'écran affiche, d'après le statut obtenu par le serveur (jamais d'après le retour du navigateur).
Outcome paymentOutcome(Payment p, {required bool holdOpen}) {
  if (p.waiting) return const Outcome(OutcomeKind.waiting);
  if (p.status == 'SUCCEEDED') {
    if (p.bookingStatus == 'CONFIRMED' || p.bookingStatus == 'COMPLETED') return const Outcome(OutcomeKind.confirmed);
    return const Outcome(
      OutcomeKind.late,
      'Paiement reçu après la fin du délai : les places n’étaient plus disponibles. '
      'Vous êtes remboursé intégralement, automatiquement.',
    );
  }
  final canRetry = p.bookingStatus == 'PENDING_PAYMENT' && holdOpen;
  final reason = p.failureMessage ?? 'Le paiement n’a pas abouti.';
  return Outcome(
    OutcomeKind.failed,
    canRetry ? '$reason Rien ne vous a été débité. Vous pouvez réessayer.' : '$reason Rien ne vous a été débité.',
    canRetry,
  );
}

class Transaction {
  Transaction.fromJson(Map<String, dynamic> j)
    : kind = j['kind'] as String,
      id = j['id'] as String,
      bookingId = j['bookingId'] as String,
      bookingReference = j['bookingReference'] as String,
      amountXof = _i(j['amountXof']),
      status = j['status'] as String,
      method = j['method'] as String?,
      reason = j['reason'] as String?,
      createdAt = _date(j['createdAt']),
      route = j['route'] as String;
  final String kind;
  final String id;
  final String bookingId;
  final String bookingReference;
  final int amountXof;
  final String status;
  final String? method;
  final String? reason;
  final DateTime createdAt;
  final String route;

  bool get isRefund => kind == 'REFUND';
  String get statusText => isRefund ? (_refundStatusLabel[status] ?? status) : (_paymentStatusLabel[status] ?? status);
}

class EarningLine {
  EarningLine.fromJson(Map<String, dynamic> j)
    : reference = j['reference'] as String,
      seats = _i(j['seats']),
      grossXof = _i(j['grossXof']),
      commissionXof = _i(j['commissionXof']),
      adjustmentXof = _i(j['adjustmentXof']),
      dueXof = _i(j['dueXof']),
      status = j['status'] as String,
      payableAt = _dateOrNull(j['payableAt']);
  final String reference;
  final int seats;
  final int grossXof;
  final int commissionXof;
  final int adjustmentXof;
  final int dueXof;
  final String status;
  final DateTime? payableAt;
}

class EarningTrip {
  EarningTrip.fromJson(Map<String, dynamic> j)
    : tripId = j['tripId'] as String,
      publicRef = j['publicRef'] as String,
      departureAt = _date(j['departureAt']),
      origin = j['origin'] as String,
      destination = j['destination'] as String,
      dueXof = _i(j['dueXof']),
      bookings = [for (final b in j['bookings'] as List) EarningLine.fromJson(b as Map<String, dynamic>)];
  final String tripId;
  final String publicRef;
  final DateTime departureAt;
  final String origin;
  final String destination;
  final int dueXof;
  final List<EarningLine> bookings;
}

class Earnings {
  Earnings.fromJson(Map<String, dynamic> j)
    : grossXof = _i((j['totals'] as Map)['grossXof']),
      commissionXof = _i((j['totals'] as Map)['commissionXof']),
      pendingXof = _i((j['totals'] as Map)['pendingXof']),
      payableXof = _i((j['totals'] as Map)['payableXof']),
      paidXof = _i((j['totals'] as Map)['paidXof']),
      payoutsAvailable = j['payoutsAvailable'] == true,
      trips = [for (final t in j['trips'] as List) EarningTrip.fromJson(t as Map<String, dynamic>)];
  final int grossXof;
  final int commissionXof;
  final int pendingXof;
  final int payableXof;
  final int paidXof;
  final bool payoutsAvailable;
  final List<EarningTrip> trips;
}
