import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:ivoirecovoit/core/api_client.dart';

void main() {
  test('renvoie le corps JSON en cas de succès', () async {
    final client = ApiClient(
      baseUrl: 'http://api',
      httpClient: MockClient((req) async {
        expect(req.url.toString(), 'http://api/api/v1/health');
        return http.Response(jsonEncode({'status': 'ok'}), 200);
      }),
    );
    expect(await client.get('/health'), {'status': 'ok'});
  });

  test("transmet le message d'erreur de l'API sans réessayer une erreur 400", () async {
    var calls = 0;
    final client = ApiClient(
      baseUrl: 'http://api',
      httpClient: MockClient((_) async {
        calls++;
        return http.Response(
            jsonEncode({'error': {'code': 'VALIDATION_ERROR', 'message': 'Certains champs sont invalides.'}}), 400);
      }),
    );
    await expectLater(
      client.get('/places/autocomplete', query: {'q': 'a'}),
      throwsA(isA<ApiException>().having((e) => e.code, 'code', 'VALIDATION_ERROR')),
    );
    expect(calls, 1);
  });

  test('réessaie après une erreur réseau puis renvoie un message clair', () async {
    var calls = 0;
    final client = ApiClient(
      baseUrl: 'http://api',
      httpClient: MockClient((_) async {
        calls++;
        throw http.ClientException('Connection reset');
      }),
    );
    await expectLater(
      client.get('/health', retries: 1),
      throwsA(isA<ApiException>().having((e) => e.code, 'code', 'NETWORK_ERROR')),
    );
    expect(calls, 2);
  });
}
