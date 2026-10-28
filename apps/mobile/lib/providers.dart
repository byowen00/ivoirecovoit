import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'core/api_client.dart';
import 'core/config.dart';
import 'core/token_store.dart';
import 'features/auth/auth_repository.dart';
import 'features/auth/auth_session.dart';
import 'features/bookings/bookings_repository.dart';
import 'features/driver/driver_repository.dart';
import 'features/payments/payments_repository.dart';
import 'features/places/places_repository.dart';
import 'features/trips/trips_repository.dart';

final apiClientProvider = Provider<ApiClient>((ref) => ApiClient(baseUrl: AppConfig.apiBaseUrl));

final placesRepositoryProvider = Provider<PlacesRepository>((ref) => ApiPlacesRepository(ref.watch(apiClientProvider)));

final tokenStoreProvider = Provider<TokenStore>((ref) => SecureTokenStore());

final authSessionProvider = Provider<AuthSession>(
  (ref) => AuthSession(ref.watch(apiClientProvider), ref.watch(tokenStoreProvider)),
);

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => AuthRepository(ref.watch(apiClientProvider), ref.watch(authSessionProvider)),
);

/// Préférences locales (écran de bienvenue déjà vu…). Fournies au démarrage par main().
final sharedPreferencesProvider = Provider<SharedPreferences>((ref) => throw UnimplementedError());

final apiTripsRepositoryProvider = Provider<ApiTripsRepository>(
  (ref) => ApiTripsRepository(ref.watch(apiClientProvider), ref.watch(authSessionProvider)),
);

/// Lecture publique des trajets (remplaçable dans les tests).
final tripsRepositoryProvider = Provider<TripsRepository>((ref) => ref.watch(apiTripsRepositoryProvider));

final driverRepositoryProvider = Provider<DriverRepository>((ref) => DriverRepository(ref.watch(authSessionProvider)));

final bookingsRepositoryProvider = Provider<BookingsRepository>(
  (ref) => ApiBookingsRepository(ref.watch(authSessionProvider)),
);

final paymentsRepositoryProvider = Provider<PaymentsRepository>(
  (ref) => ApiPaymentsRepository(ref.watch(authSessionProvider)),
);
