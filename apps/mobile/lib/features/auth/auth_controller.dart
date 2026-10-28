import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../providers.dart';
import 'models.dart';

/// Personne connectée (null si aucune session). Au démarrage, la session est reprise depuis le refresh token stocké.
class AuthController extends AsyncNotifier<Me?> {
  // Incrémenté à chaque connexion ou déconnexion : la reprise de session lancée au démarrage ne doit pas écraser
  // un état plus récent si elle se termine après.
  int _version = 0;
  Me? _latest;

  @override
  Future<Me?> build() async {
    final started = _version;
    final session = ref.watch(authSessionProvider);
    Me? restored;
    try {
      // Jeton d'accès déjà présent (connexion faite pendant ce lancement) : inutile de renouveler.
      if (session.hasAccessToken || await session.refresh()) restored = await ref.read(authRepositoryProvider).me();
    } on ApiException {
      // Hors ligne au démarrage : on reste déconnecté à l'écran, le jeton est conservé pour plus tard.
    }
    return _version == started ? restored : _latest;
  }

  void setMe(Me me) => _set(me);

  Future<void> signOut({bool everywhere = false}) async {
    await ref.read(authRepositoryProvider).logout(everywhere: everywhere);
    _set(null);
  }

  void forget() => _set(null);

  void _set(Me? me) {
    _version++;
    _latest = me;
    state = AsyncData(me);
  }
}

final authControllerProvider = AsyncNotifierProvider<AuthController, Me?>(AuthController.new);
