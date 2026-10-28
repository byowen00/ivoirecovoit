/// Configuration injectée à la compilation :
/// `flutter run --dart-define=API_BASE_URL=https://api.exemple.ci`
///
/// Par défaut : l'API locale vue depuis l'émulateur Android (10.0.2.2 = machine hôte).
class AppConfig {
  static const apiBaseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: 'http://10.0.2.2:3000');
  static const environment = String.fromEnvironment('APP_ENV', defaultValue: 'development');

  /// Fournisseur de tuiles de carte (sous contrat en production). Par défaut : OpenStreetMap, avec attribution.
  static const tileUrl = String.fromEnvironment(
    'TILE_URL',
    defaultValue: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  );
  static const tileAttribution = String.fromEnvironment(
    'TILE_ATTRIBUTION',
    defaultValue: '© contributeurs OpenStreetMap',
  );
  static bool get isProduction => environment == 'production';
}
