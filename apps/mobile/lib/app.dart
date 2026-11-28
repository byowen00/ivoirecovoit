import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/appearance.dart';
import 'core/theme.dart';
import 'features/account/account_screen.dart';
import 'features/auth/auth_controller.dart';
import 'features/auth/models.dart';
import 'features/auth/otp_screen.dart';
import 'features/auth/phone_screen.dart';
import 'features/auth/profile_setup_screen.dart';
import 'features/bookings/booking_detail_screen.dart';
import 'features/bookings/booking_screen.dart';
import 'features/bookings/my_bookings_screen.dart';
import 'features/driver/driver_home_screen.dart';
import 'features/driver/driver_screen.dart';
import 'features/payments/payment_history_screen.dart';
import 'features/payments/payment_screen.dart';
import 'features/trips/driver_profile_screen.dart';
import 'features/trips/my_trips_screen.dart';
import 'features/trips/publish_screen.dart';
import 'features/trips/search_results_screen.dart';
import 'features/trips/trip_detail_screen.dart';
import 'features/home/history_screen.dart';
import 'features/home/home_screen.dart';
import 'features/settings/settings_screen.dart';
import 'features/status/status_screen.dart';
import 'features/support/support.dart';
import 'features/trust/chat_screen.dart';
import 'features/trust/dispute_screens.dart';
import 'features/trust/help_screen.dart';
import 'features/trust/notifications_screen.dart';
import 'features/welcome/welcome_screen.dart';
import 'providers.dart';

/// N'accepte que des chemins internes pour la redirection après connexion.
String safeNext(String? next) => next != null && next.startsWith('/') && !next.startsWith('//') ? next : '/compte';

final routerProvider = Provider<GoRouter>((ref) {
  final prefs = ref.watch(sharedPreferencesProvider);
  return GoRouter(
    initialLocation: prefs.getBool(onboardingDoneKey) == true ? '/' : '/bienvenue',
    routes: [
      GoRoute(path: '/', builder: (_, _) => const _Home()),
      GoRoute(path: '/bienvenue', builder: (_, _) => const WelcomeScreen()),
      GoRoute(path: '/statut', builder: (_, _) => const StatusScreen()),
      GoRoute(path: '/historique', builder: (_, _) => const HistoryScreen()),
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
      GoRoute(path: '/parametres', builder: (_, _) => const SettingsScreen()),
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
        path: '/trajets/:id/reserver',
        redirect: (_, state) {
          final q = state.uri.queryParameters;
          // Lien incomplet : le segment se choisit sur la page du trajet.
          return q['pickup'] == null || q['dropoff'] == null ? '/trajets/${state.pathParameters['id']}' : null;
        },
        builder: (_, state) => _RequireMe(
          builder: (_) => BookingScreen(
            tripId: state.pathParameters['id']!,
            pickupStopId: state.uri.queryParameters['pickup']!,
            dropoffStopId: state.uri.queryParameters['dropoff']!,
            seats: (int.tryParse(state.uri.queryParameters['seats'] ?? '') ?? 1).clamp(1, 4),
          ),
        ),
      ),
      GoRoute(
        path: '/reservations',
        builder: (_, state) =>
            _RequireMe(builder: (_) => MyBookingsScreen(past: state.uri.queryParameters['onglet'] == 'passees')),
      ),
      GoRoute(
        path: '/reservations/:id',
        builder: (_, state) => _RequireMe(builder: (_) => BookingDetailScreen(bookingId: state.pathParameters['id']!)),
      ),
      GoRoute(
        path: '/reservations/:id/payer',
        builder: (_, state) => _RequireMe(builder: (_) => PaymentScreen(bookingId: state.pathParameters['id']!)),
      ),
      GoRoute(
        path: '/reservations/:id/messages',
        builder: (_, state) => _RequireMe(builder: (_) => ChatScreen(bookingId: state.pathParameters['id']!)),
      ),
      GoRoute(
        path: '/notifications',
        builder: (_, _) => _RequireMe(builder: (_) => const NotificationsScreen()),
      ),
      GoRoute(path: '/aide', builder: (_, _) => const HelpScreen()),
      GoRoute(
        path: '/aide/assistance',
        builder: (_, _) => _RequireMe(builder: (_) => const SupportScreen()),
      ),
      GoRoute(
        path: '/aide/assistance/:id',
        builder: (_, state) => _RequireMe(builder: (_) => SupportChatScreen(id: state.pathParameters['id']!)),
      ),
      GoRoute(
        path: '/aide/reclamations/nouvelle',
        redirect: (_, state) => state.uri.queryParameters['reservation'] == null ? '/aide' : null,
        builder: (_, state) =>
            _RequireMe(builder: (_) => NewDisputeScreen(bookingId: state.uri.queryParameters['reservation']!)),
      ),
      GoRoute(
        path: '/aide/reclamations/:id',
        builder: (_, state) => _RequireMe(builder: (_) => DisputeScreen(disputeId: state.pathParameters['id']!)),
      ),
      GoRoute(
        path: '/paiements',
        builder: (_, state) => _RequireMe(
          builder: (_) => PaymentHistoryScreen(earningsFirst: state.uri.queryParameters['onglet'] == 'gains'),
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
        builder: (_, state) =>
            _RequireMe(builder: (_) => MyTripsScreen(past: state.uri.queryParameters['onglet'] == 'passes')),
      ),
      GoRoute(
        path: '/conducteur/trajets/:id',
        builder: (_, state) => _RequireMe(builder: (_) => ManageTripScreen(tripId: state.pathParameters['id']!)),
      ),
    ],
  );
});

/// Accueil passager ou accueil conducteur, selon le mode choisi (connecté seulement).
class _Home extends ConsumerWidget {
  const _Home();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final signedIn = ref.watch(authControllerProvider).value != null;
    return signedIn && ref.watch(driverModeProvider) ? const DriverHomeScreen() : const HomeScreen();
  }
}

/// Affiche l'écran demandé si une personne est connectée, sinon l'invite à se connecter.
class _RequireMe extends ConsumerWidget {
  const _RequireMe({required this.builder});
  final Widget Function(Me me) builder;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(authControllerProvider);
    return me.when(
      loading: () => const Scaffold(body: Center(child: CircularProgressIndicator())),
      // Après connexion, retour à l'écran demandé (et non à « Mon compte »).
      error: (_, _) => PhoneScreen(next: safeNext(GoRouterState.of(context).uri.toString())),
      data: (m) => m == null ? PhoneScreen(next: safeNext(GoRouterState.of(context).uri.toString())) : builder(m),
    );
  }
}

class IvoireCovoitApp extends ConsumerWidget {
  const IvoireCovoitApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Reprise de la session dès le lancement, sans reconstruire l'application à chaque changement.
    ref.listen(authControllerProvider, (_, _) {});
    // Palette réglée dans l'administration : un changement reconstruit tous les écrans avec les nouvelles couleurs.
    final look = ref.watch(appearanceProvider);
    final mine = ref.watch(personalLookProvider);
    return MaterialApp.router(
      title: 'IvoireCovoit',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      builder: (context, child) {
        final mq = MediaQuery.of(context);
        return MediaQuery(
          data: mq.copyWith(textScaler: TextScaler.linear(mq.textScaler.scale(1) * mine.textScale)),
          child: KeyedSubtree(key: ValueKey('${look.theme}/${mine.theme}'), child: child ?? const SizedBox.shrink()),
        );
      },
      locale: const Locale('fr', 'CI'),
      supportedLocales: const [Locale('fr', 'CI'), Locale('fr')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      routerConfig: ref.watch(routerProvider),
    );
  }
}
