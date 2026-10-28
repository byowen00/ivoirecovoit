import 'dart:async';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;

import 'api_client.dart';

const maxDocumentBytes = 8 * 1024 * 1024;
const maxPhotoBytes = 5 * 1024 * 1024;

/// Fichier prêt à être déposé : contenu, type détecté d'après les premiers octets, empreinte SHA-256.
class UploadFile {
  UploadFile(this.bytes, this.mimeType) : sha256Hex = sha256.convert(bytes).toString();
  final Uint8List bytes;
  final String mimeType;
  final String sha256Hex;

  Map<String, Object> get meta => {'mimeType': mimeType, 'sizeBytes': bytes.length, 'sha256': sha256Hex};
}

/// Type réel du fichier (le serveur refait ce contrôle) : JPEG, PNG, WebP ou PDF, sinon null.
String? detectMime(Uint8List b) {
  bool starts(List<int> sig, [int offset = 0]) {
    if (b.length < offset + sig.length) return false;
    for (var i = 0; i < sig.length; i++) {
      if (b[offset + i] != sig[i]) return false;
    }
    return true;
  }

  if (starts([0xFF, 0xD8, 0xFF])) return 'image/jpeg';
  if (starts([0x89, 0x50, 0x4E, 0x47])) return 'image/png';
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (starts([0x25, 0x50, 0x44, 0x46])) return 'application/pdf';
  return null;
}

/// Contrôle local avant envoi ; renvoie le fichier préparé ou lève une erreur lisible.
UploadFile prepareFile(Uint8List bytes, {required int maxBytes, bool allowPdf = true}) {
  final mime = detectMime(bytes);
  if (mime == null || (!allowPdf && mime == 'application/pdf')) {
    throw ApiException(
      'FILE_TYPE',
      allowPdf ? 'Format accepté : JPEG, PNG, WebP ou PDF.' : 'Format accepté : JPEG, PNG ou WebP.',
    );
  }
  if (bytes.length > maxBytes) {
    throw ApiException('FILE_TOO_LARGE', 'Fichier trop lourd (${maxBytes ~/ (1024 * 1024)} Mo au maximum).');
  }
  return UploadFile(bytes, mime);
}

/// Dépôt direct dans le stockage privé via l'URL signée renvoyée par l'API (valable 5 min).
Future<void> putSigned(Map<String, dynamic> upload, UploadFile file, {http.Client? client}) async {
  final c = client ?? http.Client();
  final headers = Map<String, String>.from((upload['headers'] as Map?) ?? {});
  try {
    final res = await c
        .put(Uri.parse(upload['url'] as String), headers: headers, body: file.bytes)
        .timeout(const Duration(seconds: 60));
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw ApiException('UPLOAD_FAILED', 'Le fichier n’a pas pu être envoyé. Réessayez.', status: res.statusCode);
    }
  } on TimeoutException {
    throw ApiException('UPLOAD_NETWORK', 'Envoi interrompu. Vérifiez votre connexion puis réessayez.');
  } on http.ClientException {
    throw ApiException('UPLOAD_NETWORK', 'Envoi interrompu. Vérifiez votre connexion puis réessayez.');
  } finally {
    if (client == null) c.close();
  }
}
