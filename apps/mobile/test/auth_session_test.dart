import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:ivoirecovoit/core/api_client.dart';
import 'package:ivoirecovoit/core/token_store.dart';
import 'package:ivoirecovoit/features/auth/auth_session.dart';
import 'package:ivoirecovoit/features/auth/models.dart';

http.Response json(int status, Object body) => http.Response(jsonEncode(body), status, headers: {
      'content-type': 'application/json; charset=utf-8',
    });

void main() {
  group('saisie du téléphone', () {
    test('accepte les mobiles ivoiriens et refuse le reste', () {
      expect(localMobileDigits('07 07 07 07 07'), '0707070707');
      expect(localMobileDigits('+225 05 44 33 22 11'), '0544332211');
      expect(localMobileDigits('27 22 44 55 66'), isNull);
      expect(localMobileDigits('09 12 34 56 78'), isNull);
    });

    test('formate par paires', () {
      expect(formatLocalPhone('0707070707'), '07 07 07 07 07');
      expect(formatE164('+2250707070707'), '+225 07 07 07 07 07');
    });
  });

  group('AuthSession', () {
    test('renouvelle un jeton expiré une seule fois et rejoue la requête', () async {
      final calls = <String>[];
      final store = MemoryTokenStore()..token = 'R1';
      final client = MockClient((req) async {
        calls.add('${req.method} ${req.url.path} ${req.headers['Authorization'] ?? ''}');
        if (req.url.path.endsWith('/auth/refresh')) {
          expect(jsonDecode(req.body), {'refreshToken': 'R1'});
          return json(200, {'accessToken': 'A2', 'refreshToken': 'R2', 'accessTokenExpiresInS': 900});
        }
        return req.headers['Authorization'] == 'Bearer A2'
            ? json(200, {'ok': true})
            : json(401, {'error': {'code': 'TOKEN_EXPIRED', 'message': 'expiré'}});
      });
      final session = AuthSession(ApiClient(baseUrl: 'http://api', httpClient: client), store);
      await session.save({'accessToken': 'A1', 'refreshToken': 'R1'});

      expect(await session.send('GET', '/me'), {'ok': true});
      expect(store.token, 'R2');
      expect(calls, ['GET /api/v1/me Bearer A1', 'POST /api/v1/auth/refresh ', 'GET /api/v1/me Bearer A2']);
    });

    test('des appels simultanés partagent le même renouvellement', () async {
      var refreshes = 0;
      final store = MemoryTokenStore()..token = 'R1';
      final client = MockClient((req) async {
        if (req.url.path.endsWith('/auth/refresh')) {
          refreshes++;
          await Future<void>.delayed(const Duration(milliseconds: 20));
          return json(200, {'accessToken': 'A2', 'refreshToken': 'R2'});
        }
        return json(200, {});
      });
      final session = AuthSession(ApiClient(baseUrl: 'http://api', httpClient: client), store);
      await Future.wait([session.refresh(), session.refresh(), session.refresh()]);
      expect(refreshes, 1);
    });

    test('efface la session locale si le serveur la refuse', () async {
      final store = MemoryTokenStore()..token = 'R1';
      final client = MockClient((_) async => json(401, {'error': {'code': 'SESSION_REVOKED', 'message': 'fin'}}));
      final session = AuthSession(ApiClient(baseUrl: 'http://api', httpClient: client), store);
      expect(await session.refresh(), isFalse);
      expect(store.token, isNull);
    });

    test('garde le refresh token en cas de coupure réseau', () async {
      final store = MemoryTokenStore()..token = 'R1';
      final client = MockClient((_) async => throw http.ClientException('réseau'));
      final session = AuthSession(ApiClient(baseUrl: 'http://api', httpClient: client), store);
      await expectLater(session.refresh(), throwsA(isA<ApiException>()));
      expect(store.token, 'R1');
    });
  });
}
