import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/api_client.dart';
import 'core/config.dart';
import 'features/places/places_repository.dart';

final apiClientProvider = Provider<ApiClient>((ref) => ApiClient(baseUrl: AppConfig.apiBaseUrl));

final placesRepositoryProvider = Provider<PlacesRepository>((ref) => ApiPlacesRepository(ref.watch(apiClientProvider)));
