import 'dart:async';

import '../../core/api_client.dart';
import '../../core/token_store.dart';

/// Jetons de la session : accès en mémoire (15 min), refresh token dans le stockage sécurisé.
/// Un seul renouvellement à la fois : présenter deux fois le même refresh token fermerait la session.
class AuthSession {
  AuthSession(this.api, this.store);

  final ApiClient api;
  final TokenStore store;
  String? _accessToken;
  Future<bool>? _refreshing;

  bool get hasAccessToken => _accessToken != null;

  Future<void> save(Map<String, dynamic> tokens) async {
    _accessToken = tokens['accessToken'] as String;
    await store.writeRefreshToken(tokens['refreshToken'] as String);
  }

  Future<void> clear() async {
    _accessToken = null;
    await store.clear();
  }

  /// Renouvelle la paire de jetons ; false si la session n'est plus valable (la session locale est alors effacée).
  Future<bool> refresh() {
    return _refreshing ??= _doRefresh().whenComplete(() => _refreshing = null);
  }

  Future<bool> _doRefresh() async {
    final refreshToken = await store.readRefreshToken();
    if (refreshToken == null) return false;
    try {
      await save(await api.send('POST', '/auth/refresh', body: {'refreshToken': refreshToken}));
      return true;
    } on ApiException catch (e) {
      if (e.status == 401 || e.status == 403) {
        await clear();
        return false;
      }
      rethrow; // réseau : la session est peut-être encore valable, on réessaiera plus tard
    }
  }

  /// Appel authentifié : en cas de jeton expiré, un renouvellement puis une seule nouvelle tentative.
  Future<Map<String, dynamic>> send(String method, String path, {Object? body}) async {
    if (_accessToken == null && !await refresh()) {
      throw ApiException('UNAUTHENTICATED', 'Connectez-vous pour continuer.', status: 401);
    }
    try {
      return await api.send(method, path, body: body, accessToken: _accessToken);
    } on ApiException catch (e) {
      if (e.status != 401) rethrow;
      if (e.code == 'TOKEN_EXPIRED' && await refresh()) {
        return api.send(method, path, body: body, accessToken: _accessToken);
      }
      if (e.code != 'TOKEN_EXPIRED') await clear();
      rethrow;
    }
  }
}
