# IvoireCovoit : application mobile

Application Flutter (Android en priorité, iOS prêt). Voir le README à la racine du dépôt pour l'installation.

```bash
flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000   # émulateur Android
flutter analyze && flutter test
```

`lib/core` : configuration, thème (jetons du système de design), client HTTP, formats.
`lib/features` : un dossier par fonctionnalité (accueil, lieux, état du service…).
