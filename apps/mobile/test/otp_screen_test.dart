import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:ivoirecovoit/core/api_client.dart';
import 'package:ivoirecovoit/core/token_store.dart';
import 'package:ivoirecovoit/features/auth/models.dart';
import 'package:ivoirecovoit/features/auth/otp_screen.dart';
import 'package:ivoirecovoit/features/auth/phone_screen.dart';
import 'package:ivoirecovoit/providers.dart';

Map<String, dynamic> meJson({bool complete = false}) => {
      'id': 'u1', 'phone': '+2250707070707', 'email': null, 'firstName': null, 'lastName': null,
      'displayName': null, 'bio': null, 'preferences': {}, 'status': 'PENDING_VERIFICATION',
      'profileComplete': complete, 'isDemo': false, 'consents': [],
      'requiredConsents': [{'type': 'TERMS', 'version': '0.1-brouillon', 'accepted': false}],
    };

void main() {
  late DateTime now;
  late MemoryTokenStore store;

  Widget harness(MockClient client, {String? testCode}) {
    final args = OtpArgs(
      phone: '0707070707',
      next: '/compte',
      request: OtpRequest(
        id: 'otp-1', expiresIn: const Duration(minutes: 5), resendAfter: const Duration(seconds: 60),
        sentAt: now, testCode: testCode,
      ),
    );
    final router = GoRouter(initialLocation: '/code', routes: [
      GoRoute(path: '/code', builder: (_, _) => OtpScreen(args: args, clock: () => now)),
      GoRoute(path: '/inscription/profil', builder: (_, _) => const Text('ÉCRAN PROFIL')),
      GoRoute(path: '/compte', builder: (_, _) => const Text('ÉCRAN COMPTE')),
    ]);
    return ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(ApiClient(baseUrl: 'http://api', httpClient: client)),
        tokenStoreProvider.overrideWithValue(store),
      ],
      child: MaterialApp.router(routerConfig: router),
    );
  }

  setUp(() {
    now = DateTime(2026, 10, 28, 10);
    store = MemoryTokenStore();
  });

  testWidgets('affiche le code de test, compte à rebours et renvoi bloqué 60 s', (tester) async {
    await tester.pumpWidget(harness(MockClient((_) async => http.Response('{}', 200))));
    expect(find.textContaining('Mode test'), findsNothing);
    expect(find.text('Code valable encore 5:00.'), findsOneWidget);
    expect(find.text('Renvoyer le code dans 60 s'), findsOneWidget);

    now = now.add(const Duration(seconds: 61));
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Renvoyer le code'), findsOneWidget);
    expect(find.text('Code valable encore 3:59.'), findsOneWidget);
  });

  testWidgets('un code faux affiche les essais restants', (tester) async {
    await tester.pumpWidget(harness(MockClient((_) async => http.Response(
        jsonEncode({'error': {'code': 'OTP_INVALID', 'message': 'Code incorrect.', 'details': {'remainingAttempts': 3}}}),
        400,
        headers: {'content-type': 'application/json; charset=utf-8'}))));
    await tester.enterText(find.byKey(const Key('otp-input')), '000000');
    await tester.pumpAndSettle();
    expect(find.text('Code incorrect. Il vous reste 3 essais.'), findsOneWidget);
    expect(store.token, isNull);
  });

  testWidgets('le bon code ouvre la session et mène au profil d’un nouveau compte', (tester) async {
    String? sentCode;
    await tester.pumpWidget(harness(MockClient((req) async {
      if (req.url.path.endsWith('/me')) {
        return http.Response(jsonEncode(meJson()), 200, headers: {'content-type': 'application/json; charset=utf-8'});
      }
      if (!req.url.path.endsWith('/otp/verify')) return http.Response('{}', 401);
      sentCode = (jsonDecode(req.body) as Map)['code'] as String;
      return http.Response(
          jsonEncode({'accessToken': 'A', 'refreshToken': 'R', 'accessTokenExpiresInS': 900, 'isNewUser': true, 'user': meJson()}),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'});
    })));
    await tester.enterText(find.byKey(const Key('otp-input')), '123456');
    await tester.pumpAndSettle();
    expect(sentCode, '123456');
    expect(find.text('ÉCRAN PROFIL'), findsOneWidget);
    expect(store.token, 'R');
  });

  testWidgets('mode test : le code affiché est validé tout seul', (tester) async {
    String? sentCode;
    await tester.pumpWidget(harness(testCode: '654321', MockClient((req) async {
      if (req.url.path.endsWith('/me')) {
        return http.Response(jsonEncode(meJson(complete: true)), 200, headers: {'content-type': 'application/json; charset=utf-8'});
      }
      if (!req.url.path.endsWith('/otp/verify')) return http.Response('{}', 401);
      sentCode = (jsonDecode(req.body) as Map)['code'] as String;
      return http.Response(
          jsonEncode({'accessToken': 'A', 'refreshToken': 'R', 'accessTokenExpiresInS': 900, 'isNewUser': false, 'user': meJson(complete: true)}),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'});
    })));
    expect(find.textContaining('connexion automatique avec le code 654321'), findsOneWidget);
    await tester.pumpAndSettle();
    expect(sentCode, '654321');
    expect(find.text('ÉCRAN COMPTE'), findsOneWidget);
  });

  testWidgets('mode essai : « Entrer comme conducteur » connecte le compte de démonstration', (tester) async {
    final calls = <String>[];
    final client = MockClient((req) async {
      calls.add(req.url.path);
      const json = {'content-type': 'application/json; charset=utf-8'};
      if (req.url.path.endsWith('/otp/request')) {
        expect((jsonDecode(req.body) as Map)['phone'], '+2250000000001');
        return http.Response(
            jsonEncode({'otpRequestId': 'otp-9', 'expiresInS': 300, 'resendAfterS': 0, 'testCode': '111222'}), 200,
            headers: json);
      }
      if (req.url.path.endsWith('/otp/verify')) {
        expect((jsonDecode(req.body) as Map)['code'], '111222');
        return http.Response(
            jsonEncode({'accessToken': 'A', 'refreshToken': 'R', 'accessTokenExpiresInS': 900, 'isNewUser': false,
                        'user': meJson(complete: true)}),
            200,
            headers: json);
      }
      return http.Response(jsonEncode(meJson(complete: true)), 200, headers: json);
    });
    final router = GoRouter(initialLocation: '/connexion', routes: [
      GoRoute(path: '/connexion', builder: (_, _) => const PhoneScreen()),
      GoRoute(path: '/compte', builder: (_, _) => const Text('ÉCRAN COMPTE')),
    ]);
    await tester.pumpWidget(ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(ApiClient(baseUrl: 'http://api', httpClient: client)),
        tokenStoreProvider.overrideWithValue(store),
      ],
      child: MaterialApp.router(routerConfig: router),
    ));
    await tester.tap(find.byKey(const Key('direct-driver')));
    await tester.pumpAndSettle();
    expect(calls.where((p) => p.endsWith('/otp/verify')), hasLength(1));
    expect(find.text('ÉCRAN COMPTE'), findsOneWidget);
    expect(store.token, 'R');
  });
}
