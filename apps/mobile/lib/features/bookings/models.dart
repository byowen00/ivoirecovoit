import '../../core/format.dart';

int _i(Object? v) => (v as num).toInt();
DateTime _date(Object? v) => DateTime.parse(v as String);
DateTime? _dateOrNull(Object? v) => v == null ? null : DateTime.parse(v as String);

const bookingStatusLabel = {
  'PENDING_ACCEPTANCE': 'En attente du conducteur',
  'PENDING_PAYMENT': 'En attente de paiement',
  'CONFIRMED': 'Confirmée',
  'REJECTED': 'Refusée par le conducteur',
  'EXPIRED': 'Expirée',
  'CANCELLED_BY_PASSENGER': 'Annulée par vous',
  'CANCELLED_BY_DRIVER': 'Annulée par le conducteur',
  'CANCELLED_BY_ADMIN': 'Annulée par IvoireCovoit',
  'NO_SHOW': 'Absence constatée',
  'COMPLETED': 'Trajet effectué',
};

/// Libellé selon le point de vue : pour le conducteur, le passager n'est pas « vous ».
String bookingStatusText(String status, {bool driver = false}) {
  if (driver && status == 'CANCELLED_BY_PASSENGER') return 'Annulée par le passager';
  if (driver && status == 'CANCELLED_BY_DRIVER') return 'Annulée par vous';
  if (driver && status == 'PENDING_ACCEPTANCE') return 'Demande à traiter';
  return bookingStatusLabel[status] ?? status;
}

enum BookingTone { success, warning, danger, muted }

BookingTone bookingTone(String status) {
  if (status == 'CONFIRMED' || status == 'COMPLETED') return BookingTone.success;
  if (status == 'PENDING_ACCEPTANCE' || status == 'PENDING_PAYMENT') return BookingTone.warning;
  if (status == 'NO_SHOW' || status == 'REJECTED' || status.startsWith('CANCELLED')) return BookingTone.danger;
  return BookingTone.muted;
}

/// Réservations terminées sans voyage (repliées dans la liste du conducteur).
const inactiveBookingStatuses = {
  'EXPIRED',
  'REJECTED',
  'CANCELLED_BY_PASSENGER',
  'CANCELLED_BY_DRIVER',
  'CANCELLED_BY_ADMIN',
};

class CancellationPolicy {
  CancellationPolicy.fromJson(Map<String, dynamic> j)
    : code = j['code'] as String,
      label = j['label'] as String,
      summary = j['summary'] as String;
  final String code;
  final String label;
  final String summary;
}

class BookingPoint {
  BookingPoint.fromJson(Map<String, dynamic> j)
    : label = j['label'] as String,
      meetingPoint = j['meetingPoint'] as String?,
      plannedAt = _date(j['plannedAt']);
  final String label;
  final String? meetingPoint;
  final DateTime plannedAt;
}

class BookingQuote {
  BookingQuote.fromJson(Map<String, dynamic> j)
    : pickup = BookingPoint.fromJson(j['pickup'] as Map<String, dynamic>),
      dropoff = BookingPoint.fromJson(j['dropoff'] as Map<String, dynamic>),
      seats = _i(j['seats']),
      unitPriceXof = _i(j['unitPriceXof']),
      subtotalXof = _i(j['subtotalXof']),
      serviceFeeXof = _i(j['serviceFeeXof']),
      discountXof = _i(j['discountXof']),
      totalXof = _i(j['totalXof']),
      seatsAvailable = _i(j['seatsAvailable']),
      manual = j['acceptanceMode'] == 'MANUAL',
      acceptanceDeadline = _dateOrNull(j['acceptanceDeadline']),
      holdMinutes = _i(j['holdMinutes']),
      cashAllowed = j['cashAllowed'] == true,
      policy = CancellationPolicy.fromJson(j['cancellationPolicy'] as Map<String, dynamic>);
  final BookingPoint pickup;
  final BookingPoint dropoff;
  final int seats;
  final int unitPriceXof;
  final int subtotalXof;
  final int serviceFeeXof;
  final int discountXof;
  final int totalXof;
  final int seatsAvailable;
  final bool manual;
  final DateTime? acceptanceDeadline;
  final int holdMinutes;
  final bool cashAllowed;
  final CancellationPolicy policy;
}

class BookingHistoryEntry {
  BookingHistoryEntry.fromJson(Map<String, dynamic> j)
    : to = j['to'] as String,
      at = _date(j['at']),
      by = j['by'] as String,
      reason = j['reason'] as String?;
  final String to;
  final DateTime at;
  final String by;
  final String? reason;
}

class Booking {
  Booking.fromJson(Map<String, dynamic> j)
    : id = j['id'] as String,
      reference = j['reference'] as String,
      status = j['status'] as String,
      paymentStatus = j['paymentStatus'] as String,
      paymentMethod = j['paymentMethod'] as String?,
      seats = _i(j['seats']),
      unitPriceXof = _i(j['unitPriceXof']),
      subtotalXof = _i(j['subtotalXof']),
      serviceFeeXof = _i(j['serviceFeeXof']),
      discountXof = _i(j['discountXof']),
      totalXof = _i(j['totalXof']),
      commissionXof = j['commissionXof'] == null ? null : _i(j['commissionXof']),
      driverNetXof = j['driverNetXof'] == null ? null : _i(j['driverNetXof']),
      holdExpiresAt = _dateOrNull(j['holdExpiresAt']),
      acceptanceDeadline = _dateOrNull(j['acceptanceDeadline']),
      cancellationReason = j['cancellationReason'] as String?,
      refundDueXof = j['refundDueXof'] == null ? null : _i(j['refundDueXof']),
      freeCancellation = j['freeCancellation'] == true,
      isDemo = j['isDemo'] == true,
      isDriver = j['viewerRole'] == 'DRIVER',
      policy = CancellationPolicy.fromJson(j['cancellationPolicy'] as Map<String, dynamic>),
      tripId = (j['trip'] as Map)['id'] as String,
      tripStatus = (j['trip'] as Map)['status'] as String,
      origin = (j['trip'] as Map)['origin'] as String,
      destination = (j['trip'] as Map)['destination'] as String,
      driverName = ((j['trip'] as Map)['driver'] as Map)['displayName'] as String?,
      vehicle = _vehicle((j['trip'] as Map)['vehicle'] as Map),
      plateNumber = ((j['trip'] as Map)['vehicle'] as Map)['plateNumber'] as String?,
      passengerName = (j['passenger'] as Map)['displayName'] as String?,
      pickup = BookingPoint.fromJson(j['pickup'] as Map<String, dynamic>),
      dropoff = BookingPoint.fromJson(j['dropoff'] as Map<String, dynamic>),
      history = [for (final h in j['history'] as List) BookingHistoryEntry.fromJson(h as Map<String, dynamic>)],
      actions = Map<String, bool>.from(j['actions'] as Map);
  final String id;
  final String reference;
  final String status;
  final String paymentStatus;
  final String? paymentMethod;
  final int seats;
  final int unitPriceXof;
  final int subtotalXof;
  final int serviceFeeXof;
  final int discountXof;
  final int totalXof;
  final int? commissionXof;
  final int? driverNetXof;
  final DateTime? holdExpiresAt;
  final DateTime? acceptanceDeadline;
  final String? cancellationReason;
  final int? refundDueXof;
  final bool freeCancellation;
  final bool isDemo;
  final bool isDriver;
  final CancellationPolicy policy;
  final String tripId;
  final String tripStatus;
  final String origin;
  final String destination;
  final String? driverName;
  final String vehicle;
  final String? plateNumber;
  final String? passengerName;
  final BookingPoint pickup;
  final BookingPoint dropoff;
  final List<BookingHistoryEntry> history;
  final Map<String, bool> actions;

  bool can(String action) => actions[action] ?? false;

  static String _vehicle(Map v) => '${v['make']} ${v['model']}, ${v['color']}';
}

class BookingSummary {
  BookingSummary.fromJson(Map<String, dynamic> j)
    : id = j['id'] as String,
      reference = j['reference'] as String,
      status = j['status'] as String,
      seats = _i(j['seats']),
      totalXof = _i(j['totalXof']),
      isDemo = j['isDemo'] == true,
      driverName = (j['trip'] as Map)['driverName'] as String?,
      pickupLabel = (j['pickup'] as Map)['label'] as String,
      pickupAt = _date((j['pickup'] as Map)['plannedAt']),
      dropoffLabel = (j['dropoff'] as Map)['label'] as String;
  final String id;
  final String reference;
  final String status;
  final int seats;
  final int totalXof;
  final bool isDemo;
  final String? driverName;
  final String pickupLabel;
  final DateTime pickupAt;
  final String dropoffLabel;
}

class CancelPreview {
  CancelPreview.fromJson(Map<String, dynamic> j)
    : refundXof = _i(j['refundXof']),
      refundPercent = j['refundPercent'] == null ? null : _i(j['refundPercent']),
      driverCompensationXof = _i(j['driverCompensationXof']),
      basis = j['basis'] as String,
      lateDriver = j['lateDriver'] == true;
  CancelPreview({
    required this.refundXof,
    required this.basis,
    this.refundPercent,
    this.driverCompensationXof = 0,
    this.lateDriver = false,
  });
  final int refundXof;
  final int? refundPercent;
  final int driverCompensationXof;
  final String basis;
  final bool lateDriver;
}

/// Texte expliquant le remboursement prévu, avant confirmation de l'annulation.
String refundText(CancelPreview p) {
  switch (p.basis) {
    case 'NOTHING_PAID':
      return 'Rien n’a été payé : l’annulation est gratuite et vos places sont libérées.';
    case 'CASH_NOT_COLLECTED':
      return 'Paiement en espèces non encore versé : rien ne vous sera demandé.';
    case 'FREE_CANCELLATION':
      return p.lateDriver
          ? 'Le conducteur a plus de 30 min de retard : annulation sans frais, ${formatXof(p.refundXof)} vous seront remboursés.'
          : 'Le trajet a été modifié : annulation sans frais, ${formatXof(p.refundXof)} vous seront remboursés.';
    case 'DRIVER_CANCELLED':
      return 'Le passager sera remboursé intégralement (${formatXof(p.refundXof)}).';
    default:
      return p.refundXof > 0
          ? 'Selon la politique d’annulation, ${formatXof(p.refundXof)} vous seront remboursés (${p.refundPercent} % de la part trajet).'
          : 'Selon la politique d’annulation, cette annulation n’ouvre droit à aucun remboursement.';
  }
}

/// Réservation vue depuis la gestion d'un trajet (conducteur).
class ManagedBooking {
  ManagedBooking.fromJson(Map<String, dynamic> j)
    : id = j['id'] as String,
      status = j['status'] as String,
      seats = _i(j['seats']),
      passengerName = (j['passenger'] as Map)['displayName'] as String?,
      pickup = j['pickup'] as String?,
      dropoff = j['dropoff'] as String?,
      pickupAt = _dateOrNull(j['pickupAt']),
      driverNetXof = _i(j['driverNetXof']),
      actions = Map<String, bool>.from(j['actions'] as Map);
  final String id;
  final String status;
  final int seats;
  final String? passengerName;
  final String? pickup;
  final String? dropoff;
  final DateTime? pickupAt;
  final int driverNetXof;
  final Map<String, bool> actions;

  bool can(String action) => actions[action] ?? false;
}
