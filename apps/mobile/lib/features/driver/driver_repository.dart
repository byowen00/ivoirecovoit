import '../../core/api_client.dart';
import '../../core/upload.dart';
import '../auth/auth_session.dart';

const verificationLabel = {
  'NOT_SUBMITTED': 'À compléter',
  'PENDING': 'En cours de vérification',
  'APPROVED': 'Validé',
  'REJECTED': 'Refusé',
  'EXPIRED': 'Expiré',
};

const requirementLabel = {
  'LICENSE_INFO': 'Numéro et date d’expiration du permis',
  'DRIVING_LICENSE_FRONT': 'Permis de conduire (recto)',
  'DRIVING_LICENSE_BACK': 'Permis de conduire (verso)',
  'IDENTITY_DOCUMENT': 'Pièce d’identité (CNI recto-verso, passeport ou carte consulaire)',
  'VEHICLE_REGISTRATION': 'Carte grise',
  'INSURANCE': 'Assurance en cours de validité',
  'TECHNICAL_INSPECTION': 'Visite technique en cours de validité',
};

const blockerLabel = {
  'DRIVER_NOT_APPROVED': 'Votre profil conducteur doit être validé.',
  'LICENSE_EXPIRED': 'Votre permis est expiré.',
  'NO_APPROVED_VEHICLE': 'Vous devez avoir au moins un véhicule validé.',
};

class DocInfo {
  DocInfo.fromJson(Map<String, dynamic> j)
    : id = j['id'] as String,
      docType = j['docType'] as String,
      side = j['side'] as String?,
      status = j['status'] as String,
      expiresOn = j['expiresOn'] as String?,
      rejectionReason = j['rejectionReason'] as String?;
  final String id;
  final String docType;
  final String? side;
  final String status;
  final String? expiresOn;
  final String? rejectionReason;
}

typedef Requirement = ({String key, bool done});
List<Requirement> _reqs(Object? v) => [
  for (final r in v as List) (key: (r as Map)['key'] as String, done: r['done'] as bool),
];

class DriverProfile {
  DriverProfile.fromJson(Map<String, dynamic> j)
    : status = j['status'] as String,
      rejectionReason = j['rejectionReason'] as String?,
      licenseMasked = (j['license'] as Map?)?['numberMasked'] as String?,
      licenseExpiresOn = (j['license'] as Map?)?['expiresOn'] as String?,
      documents = [for (final d in j['documents'] as List) DocInfo.fromJson(d as Map<String, dynamic>)],
      requirements = _reqs(j['requirements']),
      canEdit = j['canEdit'] as bool,
      canSubmit = j['canSubmit'] as bool,
      canPublish = j['canPublish'] as bool,
      publishBlockers = [for (final b in j['publishBlockers'] as List) b as String];
  final String status;
  final String? rejectionReason;
  final String? licenseMasked;
  final String? licenseExpiresOn;
  final List<DocInfo> documents;
  final List<Requirement> requirements;
  final bool canEdit;
  final bool canSubmit;
  final bool canPublish;
  final List<String> publishBlockers;

  DocInfo? doc(String type, String side) => documents.where((d) => d.docType == type && d.side == side).firstOrNull;
}

class Vehicle {
  Vehicle.fromJson(Map<String, dynamic> j)
    : id = j['id'] as String,
      make = j['make'] as String,
      model = j['model'] as String,
      color = j['color'] as String,
      plateNumber = j['plateNumber'] as String,
      seatsCapacity = (j['seatsCapacity'] as num).toInt(),
      status = j['status'] as String,
      isActive = (j['isActive'] as bool?) ?? true,
      rejectionReason = j['rejectionReason'] as String?,
      documents = [for (final d in j['documents'] as List) DocInfo.fromJson(d as Map<String, dynamic>)],
      requirements = _reqs(j['requirements']),
      canSubmit = j['canSubmit'] as bool;
  final String id;
  final String make;
  final String model;
  final String color;
  final String plateNumber;
  final int seatsCapacity;
  final String status;
  final bool isActive;
  final String? rejectionReason;
  final List<DocInfo> documents;
  final List<Requirement> requirements;
  final bool canSubmit;

  bool get editable => status == 'NOT_SUBMITTED' || status == 'REJECTED';
  DocInfo? doc(String type) => documents.where((d) => d.docType == type).firstOrNull;
}

/// Profil conducteur, véhicules et pièces justificatives (dépôt direct dans le stockage privé).
class DriverRepository {
  DriverRepository(this._session);
  final AuthSession _session;

  /// null tant que la personne n'a pas commencé son dossier conducteur.
  Future<DriverProfile?> me() async {
    try {
      return DriverProfile.fromJson(await _session.send('GET', '/drivers/me'));
    } on ApiException catch (e) {
      if (e.status == 404) return null;
      rethrow;
    }
  }

  Future<DriverProfile> saveLicense(String number, String expiresOn) async => DriverProfile.fromJson(
    await _session.send('POST', '/drivers/me', body: {'licenseNumber': number, 'licenseExpiresOn': expiresOn}),
  );

  Future<DriverProfile> submit() async => DriverProfile.fromJson(await _session.send('POST', '/drivers/me/submit'));

  Future<List<Vehicle>> vehicles() async => [
    for (final v in (await _session.send('GET', '/vehicles'))['data'] as List)
      Vehicle.fromJson(v as Map<String, dynamic>),
  ];

  Future<Vehicle> addVehicle(Map<String, Object?> body, String idempotencyKey) async => Vehicle.fromJson(
    await _session.send('POST', '/vehicles', body: body, headers: {'Idempotency-Key': idempotencyKey}),
  );

  Future<Vehicle> submitVehicle(String id) async =>
      Vehicle.fromJson(await _session.send('POST', '/vehicles/$id/submit'));

  Future<void> uploadDriverDocument(UploadFile file, String docType, String side) async {
    final res = await _session.send(
      'POST',
      '/drivers/me/documents/upload-url',
      body: {'docType': docType, 'side': side, ...file.meta},
    );
    await putSigned(res['upload'] as Map<String, dynamic>, file);
    await _session.send('POST', '/drivers/me/documents/${res['documentId']}/complete');
  }

  Future<void> uploadVehicleDocument(String vehicleId, UploadFile file, String docType, {String? expiresOn}) async {
    final res = await _session.send(
      'POST',
      '/vehicles/$vehicleId/documents/upload-url',
      body: {'docType': docType, 'expiresOn': ?expiresOn, ...file.meta},
    );
    await putSigned(res['upload'] as Map<String, dynamic>, file);
    await _session.send('POST', '/vehicles/$vehicleId/documents/${res['documentId']}/complete');
  }
}
