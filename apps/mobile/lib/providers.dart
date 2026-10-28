import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'core/api_client.dart';
import 'core/config.dart';
import 'core/token_store.dart';
import 'features/auth/auth_repository.dart';
import 'features/auth/auth_session.dart';
import 'features/places/places_repository.dart';

final apiClientProvider = Provider<ApiClient>((ref) => ApiClient(baseUrl: AppConfig.apiBaseUrl));

final placesRepositoryProvider = Provider<PlacesRepository>((ref) => ApiPlacesRepository(ref.watch(apiClientProvider)));

final tokenStoreProvider = Provider<TokenStore>((ref) => SecureTokenStore());

final authSessionProvider =
    Provider<AuthSession>((ref) => AuthSession(ref.watch(apiClientProvider), ref.watch(tokenStoreProvider)));

final authRepositoryProvider =
    Provider<AuthRepository>((ref) => AuthRepository(ref.watch(apiClientProvider), ref.watch(authSessionProvider)));

/// Préférences locales (écran de bienvenue déjà vu…). Fournies au démarrage par main().
final sharedPreferencesProvider = Provider<SharedPreferences>((ref) => throw UnimplementedError());
