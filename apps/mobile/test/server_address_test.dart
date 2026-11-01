import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ivoirecovoit/core/config.dart';
import 'package:ivoirecovoit/core/server_address.dart';
import 'package:ivoirecovoit/core/token_store.dart';
import 'package:ivoirecovoit/providers.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  test('adresse saisie : https par défaut, sans barre finale ni /api/v1', () {
    expect(normalizeServerUrl(' abc.trycloudflare.com/ '), 'https://abc.trycloudflare.com');
    expect(normalizeServerUrl('https://abc.trycloudflare.com/api/v1'), 'https://abc.trycloudflare.com');
    expect(normalizeServerUrl('http://192.168.1.71:4000'), 'http://192.168.1.71:4000');
    expect(normalizeServerUrl('   '), isNull);
  });

  test('changer de serveur recrée le client et oublie la session', () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final store = MemoryTokenStore()..token = 'R';
    final c = ProviderContainer(
      overrides: [sharedPreferencesProvider.overrideWithValue(prefs), tokenStoreProvider.overrideWithValue(store)],
    );
    addTearDown(c.dispose);
    expect(c.read(apiClientProvider).baseUrl, AppConfig.apiBaseUrl);
    await c.read(serverUrlProvider.notifier).set('https://abc.trycloudflare.com');
    expect(c.read(apiClientProvider).baseUrl, 'https://abc.trycloudflare.com');
    expect(prefs.getString('server_url'), 'https://abc.trycloudflare.com');
    expect(store.token, isNull);
    await c.read(serverUrlProvider.notifier).set(null);
    expect(c.read(apiClientProvider).baseUrl, AppConfig.apiBaseUrl);
  });
}
