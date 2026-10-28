import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:ivoirecovoit/features/welcome/welcome_screen.dart';
import 'package:ivoirecovoit/providers.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('trois diapositives, « Passer » mémorise que l’accueil a été vu', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final router = GoRouter(initialLocation: '/bienvenue', routes: [
      GoRoute(path: '/bienvenue', builder: (_, _) => const WelcomeScreen()),
      GoRoute(path: '/', builder: (_, _) => const Text('ACCUEIL')),
    ]);
    await tester.pumpWidget(ProviderScope(
      overrides: [sharedPreferencesProvider.overrideWithValue(prefs)],
      child: MaterialApp.router(routerConfig: router),
    ));
    expect(find.text('Voyagez ensemble'), findsOneWidget);
    await tester.tap(find.text('Suivant'));
    await tester.pumpAndSettle();
    expect(find.text('Des conducteurs vérifiés'), findsOneWidget);
    await tester.tap(find.text('Passer'));
    await tester.pumpAndSettle();
    expect(find.text('ACCUEIL'), findsOneWidget);
    expect(prefs.getBool(onboardingDoneKey), isTrue);
  });
}
