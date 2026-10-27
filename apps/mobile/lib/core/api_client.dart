import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

class ApiException implements Exception {
  ApiException(this.code, this.message, {this.status = 0});
  final String code;
  final String message;
  final int status;

  @override
  String toString() => 'ApiException($code, $status): $message';
}

const _networkMessage = 'Connexion impossible. Vérifiez votre réseau puis réessayez.';

/// Client HTTP de l'API : délai d'attente, nouvelles tentatives pour les lectures, erreurs en français.
class ApiClient {
  ApiClient({required this.baseUrl, http.Client? httpClient, this.timeout = const Duration(seconds: 10)})
      : _http = httpClient ?? http.Client();

  final String baseUrl;
  final Duration timeout;
  final http.Client _http;

  Future<Map<String, dynamic>> get(String path, {Map<String, String>? query, int retries = 2}) async {
    final uri = Uri.parse('$baseUrl/api/v1$path').replace(queryParameters: query);
    Object? lastError;
    for (var attempt = 0; attempt <= retries; attempt++) {
      try {
        final res = await _http.get(uri, headers: {'Accept': 'application/json'}).timeout(timeout);
        final body = res.body.isEmpty ? <String, dynamic>{} : jsonDecode(res.body) as Map<String, dynamic>;
        if (res.statusCode >= 200 && res.statusCode < 300) return body;
        final error = body['error'] as Map<String, dynamic>?;
        final ex = ApiException(
          (error?['code'] as String?) ?? 'HTTP_ERROR',
          (error?['message'] as String?) ?? 'Le service est momentanément indisponible.',
          status: res.statusCode,
        );
        if (res.statusCode < 500) throw ex; // erreur du client : inutile de réessayer
        lastError = ex;
      } on ApiException catch (e) {
        if (e.status < 500) rethrow;
        lastError = e;
      } on TimeoutException catch (e) {
        lastError = e;
      } on SocketException catch (e) {
        lastError = e;
      } on http.ClientException catch (e) {
        lastError = e;
      }
      if (attempt < retries) await Future<void>.delayed(Duration(milliseconds: 400 * (1 << attempt)));
    }
    if (lastError is ApiException) throw lastError;
    throw ApiException('NETWORK_ERROR', _networkMessage);
  }
}
