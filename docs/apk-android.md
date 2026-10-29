# APK Android

## APK de test signé (CI)

À chaque envoi sur `main`, la CI (tâche « Mobile ») produit l'artefact **ivoirecovoit-apk-test-signe** :
version « release », signée, installable sur un téléphone Android (autoriser l'installation d'applications de
sources inconnues). Il contient **un APK par architecture** (`--split-per-abi`), car l'APK universel dépasse
25 Mo (63,5 Mo mesurés) :

- `app-arm64-v8a-release.apk` : la quasi-totalité des téléphones récents, **c'est celui à installer** ;
- `app-armeabi-v7a-release.apk` : anciens téléphones 32 bits ;
- `app-x86_64-release.apk` : émulateurs.

La CI vérifie la signature (`apksigner verify`) et que chaque APK fait moins de 25 Mo (ENF-02) ; tailles et
empreintes SHA-256 sont affichées dans le résumé de l'exécution. Sur le Play Store, l'App Bundle (`.aab`) fait
ce découpage automatiquement.

- Adresse de l'API intégrée à l'APK : variable de dépôt GitHub `STAGING_API_URL` (*Settings → Secrets and
  variables → Actions → Variables*), par exemple `https://api.preprod.exemple.ci`. Sans elle, l'APK pointe vers
  `https://api.example.invalid` et ne peut se connecter à rien.
- Clé de signature : sans secrets configurés, la CI crée une **clé de test jetable** à chaque exécution. Chaque APK
  est alors signé différemment : pour passer d'un APK de test à un autre, désinstaller l'application d'abord.

## Clé de publication (avant le Play Store)

La clé de publication ne se remplace pas : la perdre empêche de publier des mises à jour (sauf avec la signature
d'application gérée par Google Play, recommandée). La créer **une fois**, hors du dépôt :

```bash
keytool -genkeypair -keystore ivoirecovoit-upload.jks -storetype PKCS12 -alias upload \
  -keyalg RSA -keysize 3072 -validity 10000 -dname "CN=IvoireCovoit, O=<raison sociale>, C=CI"
```

- Garder le fichier `.jks` et son mot de passe dans un coffre (deux copies, deux personnes).
- Pour que la CI signe avec cette clé : secrets du dépôt `ANDROID_KEYSTORE_B64` (`base64 -w0 ivoirecovoit-upload.jks`),
  `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`.
- Build local signé : créer `apps/mobile/android/key.properties` (ignoré par git) :
  ```properties
  storeFile=/chemin/vers/ivoirecovoit-upload.jks
  storePassword=…
  keyAlias=upload
  keyPassword=…
  ```
  puis `flutter build appbundle --release --dart-define=API_BASE_URL=https://api.exemple.ci --dart-define=APP_ENV=production`.
  Le Play Store demande un **App Bundle** (`.aab`), pas un APK.

Sans `key.properties`, `flutter build apk --release` signe avec la clé de débogage : pour essais seulement.

## Reste à faire avant publication

- Identifiant d'application définitif (`ci.ivoirecovoit.ivoirecovoit` aujourd'hui) : il ne peut plus changer
  après la première publication.
- Icône, captures d'écran, fiche Play Store, politique de confidentialité publiée, formulaire « Sécurité des
  données », classification du contenu.
- Notifications sur le téléphone : `google-services.json` du projet Firebase (non fourni).
- Essai complet sur plusieurs vrais téléphones Android d'entrée de gamme, en 3G.
