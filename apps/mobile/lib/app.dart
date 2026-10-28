import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/theme.dart';
import 'features/account/account_screen.dart';
import 'features/auth/auth_controller.dart';
import 'features/auth/models.dart';
import 'features/auth/otp_screen.dart';
import 'features/auth/phone_screen.dart';
import 'features/auth/profile_setup_screen.dart';
import 'features/driver/driver_screen.dart';
import 'features/trips/driver_profile_screen.dart';
import 'features/trips/my_trips_screen.dart';
import 'features/trips/publish_screen.dart';
import 'features/trips/search_results_screen.dart';
import 'features/trips/trip_detail_screen.dart';
import 'features/home/home_screen.dart';
import 'features/status/status_screen.dart';
import 'features/welcome/welcome_screen.dart';
import 'providers.dart';

/// N'accepte que des chemins internes pour la redirection après connexion.
String safeNext(String? next) => next != null && next.startsWith('/') && !next.startsWith('//') ? next : '/compte';

final routerProvider = Provider<GoRouter>((ref) {
  final prefs = ref.watch(sharedPreferencesProvider);
  return GoRouter(
    initialLocation: prefs.getBool(onboardingDoneKey) == true ? '/' : '/bienvenue',
    routes: [
      GoRoute(path: '/', builder: (_, _) => const HomeScreen()),
      GoRoute(path: '/bienvenue', builder: (_, _) => const WelcomeScreen()),
      GoRoute(path: '/statut', builder: (_, _) => const StatusScreen()),
      GoRoute(
        path: '/connexion',
        builder: (_, state) => PhoneScreen(next: safeNext(state.uri.queryParameters['next'])),
      ),
      GoRoute(
        path: '/connexion/code',
        redirect: (_, state) => state.extra is OtpArgs ? null : '/connexion',
        builder: (_, state) => OtpScreen(args: state.extra! as OtpArgs),
      ),
      GoRoute(
        path: '/inscription/profil',
        builder: (_, state) => _RequireMe(
          builder: (me) => ProfileSetupScreen(me: me, next: safeNext(state.uri.queryParameters['next'])),
        ),
      ),
      GoRoute(path: '/compte', builder: (_, _) => const AccountScreen()),
      GoRoute(
        path: '/recherche',
        redirect: (_, state) => queryFromUri(state.uri) == null ? '/' : null,
        builder: (_, state) => SearchResultsScreen(query: queryFromUri(state.uri)!),
      ),
      GoRoute(
        path: '/trajets/:id',
        builder: (_, state) => TripDetailScreen(
          tripId: state.pathParameters['id']!,
          pickupStopId: state.uri.queryParameters['pickup'],
          dropoffStopId: state.uri.queryParameters['dropoff'],
          seats: (int.tryParse(state.uri.queryParameters['seats'] ?? '') ?? 1).clamp(1, 8),
        ),
      ),
      GoRoute(
        path: '/conducteurs/:id',
        builder: (_, state) => DriverProfileScreen(driverId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/conducteur',
        builder: (_, _) => _RequireMe(builder: (_) => const DriverScreen()),
      ),
      GoRoute(
        path: '/conducteur/publier',
        builder: (_, _) => _RequireMe(builder: (_) => const PublishScreen()),
      ),
      GoRoute(
        path: '/conducteur/trajets',
        builder: (_, _) => _RequireMe(builder: (_) => const MyTripsScreen()),
      ),
      GoRoute(
        path: '/conducteur/trajets/:id',
        builder: (_, state) => _RequireMe(builder: (_) => ManageTripScreen(tripId: state.pathParameters['id']!)),
      ),
    ],
  );
});

/// Affiche l'écran demandé si une personne est connectée, sinon l'invite à se connecter.
class _RequireMe extends ConsumerWidget {
  const _RequireMe({required this.builder});
  final Widget Function(Me me) builder;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(authControllerProvider);
    return me.when(
      loading: () => const Scaffold(body: Center(child: CircularProgressIndicator())),
      error: (_, _) => const PhoneScreen(),
      data: (m) => m == null ? const PhoneScreen() : builder(m),
    );
  }
}

class IvoireCovoitApp extends ConsumerWidget {
  const IvoireCovoitApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Reprise de la session dès le lancement, sans reconstruire l'application à chaque changement.
    ref.listen(authControllerProvider, (_, _) {});
    return MaterialApp.router(
      title: 'IvoireCovoit',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      locale: const Locale('fr', 'CI'),
      supportedLocales: const [Locale('fr', 'CI'), Locale('fr')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      routerConfig: ref.watch(routerProvider),
    );
  }
}
