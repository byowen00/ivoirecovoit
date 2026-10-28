/// Profil de la personne connectée (réponse de GET /me).
class Me {
  Me({
    required this.id,
    required this.phone,
    required this.email,
    required this.firstName,
    required this.lastName,
    required this.displayName,
    required this.bio,
    required this.preferences,
    required this.status,
    required this.profileComplete,
    required this.isDemo,
    required this.consents,
    required this.requiredConsents,
  });

  factory Me.fromJson(Map<String, dynamic> j) => Me(
        id: j['id'] as String,
        phone: j['phone'] as String?,
        email: j['email'] as String?,
        firstName: j['firstName'] as String?,
        lastName: j['lastName'] as String?,
        displayName: j['displayName'] as String?,
        bio: j['bio'] as String?,
        preferences: Map<String, dynamic>.from((j['preferences'] as Map?) ?? {}),
        status: j['status'] as String,
        profileComplete: j['profileComplete'] as bool,
        isDemo: (j['isDemo'] as bool?) ?? false,
        consents: [for (final c in (j['consents'] as List? ?? [])) Consent.fromJson(c as Map<String, dynamic>)],
        requiredConsents: [
          for (final c in (j['requiredConsents'] as List? ?? [])) RequiredConsent.fromJson(c as Map<String, dynamic>)
        ],
      );

  final String id;
  final String? phone;
  final String? email;
  final String? firstName;
  final String? lastName;
  final String? displayName;
  final String? bio;
  final Map<String, dynamic> preferences;
  final String status;
  final bool profileComplete;
  final bool isDemo;
  final List<Consent> consents;
  final List<RequiredConsent> requiredConsents;

  bool granted(String type) => consents.where((c) => c.type == type).firstOrNull?.granted ?? false;
}

class Consent {
  Consent(this.type, this.version, this.granted, this.at);
  factory Consent.fromJson(Map<String, dynamic> j) =>
      Consent(j['type'] as String, j['version'] as String, j['granted'] as bool, DateTime.parse(j['at'] as String));
  final String type;
  final String version;
  final bool granted;
  final DateTime at;
}

class RequiredConsent {
  RequiredConsent(this.type, this.version, this.accepted);
  factory RequiredConsent.fromJson(Map<String, dynamic> j) =>
      RequiredConsent(j['type'] as String, j['version'] as String, j['accepted'] as bool);
  final String type;
  final String version;
  final bool accepted;
}

class OtpRequest {
  OtpRequest({required this.id, required this.expiresIn, required this.resendAfter, required this.sentAt, this.testCode});
  factory OtpRequest.fromJson(Map<String, dynamic> j, DateTime sentAt) => OtpRequest(
        id: j['otpRequestId'] as String,
        expiresIn: Duration(seconds: j['expiresInS'] as int),
        resendAfter: Duration(seconds: j['resendAfterS'] as int),
        sentAt: sentAt,
        testCode: j['testCode'] as String?,
      );
  final String id;
  final Duration expiresIn;
  final Duration resendAfter;
  final DateTime sentAt;

  /// Présent uniquement en mode OTP de test (développement) : aucun SMS n'est envoyé.
  final String? testCode;
}

class SessionInfo {
  SessionInfo(this.id, this.deviceLabel, this.lastUsedAt, this.current);
  factory SessionInfo.fromJson(Map<String, dynamic> j) => SessionInfo(
        j['id'] as String,
        j['deviceLabel'] as String?,
        j['lastUsedAt'] == null ? null : DateTime.parse(j['lastUsedAt'] as String),
        j['current'] as bool,
      );
  final String id;
  final String? deviceLabel;
  final DateTime? lastUsedAt;
  final bool current;
}

/// « 07 07 07 07 07 », « +225 0707070707 » → « 0707070707 » si mobile ivoirien (01, 05, 07), sinon null.
String? localMobileDigits(String input) {
  var digits = input.replaceAll(RegExp(r'\D'), '');
  if (digits.length == 13 && digits.startsWith('225')) digits = digits.substring(3);
  return RegExp(r'^0[157]\d{8}$').hasMatch(digits) ? digits : null;
}

/// « 0707070707 » → « 07 07 07 07 07 »
String formatLocalPhone(String digits) {
  final d = digits.replaceAll(RegExp(r'\D'), '');
  final buf = StringBuffer();
  for (var i = 0; i < d.length && i < 10; i++) {
    if (i > 0 && i.isEven) buf.write(' ');
    buf.write(d[i]);
  }
  return buf.toString();
}

/// « +2250707070707 » → « +225 07 07 07 07 07 »
String formatE164(String? e164) => e164 == null ? '' : '+225 ${formatLocalPhone(e164.replaceFirst('+225', ''))}';
