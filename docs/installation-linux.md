# Installation pour le développement : Linux

Testé sur Ubuntu 24.04 et Debian 12. Pour installer un serveur, voir plutôt [deploiement.md](deploiement.md).

## 1. Outils

```bash
sudo apt-get update && sudo apt-get install -y git curl unzip xz-utils zip libglu1-mesa openjdk-17-jdk
# Docker Engine et Compose ; puis se déconnecter/reconnecter pour utiliser docker sans sudo
curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker "$USER"
# Node.js 22 LTS (via nvm) et pnpm 10 (via corepack)
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
. ~/.nvm/nvm.sh && nvm install 22 && corepack enable
```

Flutter 3.47 (stable) et Android :

1. Installer Flutter : https://docs.flutter.dev/get-started/install/linux (archive dans `~/flutter`, ajouter
   `~/flutter/bin` au `PATH`).
2. Installer Android Studio, puis dans *SDK Manager* : Android SDK Platform récent, *Command-line Tools*,
   *Build-Tools*, et un émulateur (image système x86_64).
3. `flutter doctor --android-licenses` puis `flutter doctor` : tout doit être coché sauf ce qui ne vous sert pas
   (Chrome, Linux desktop).

## 2. Projet

```bash
git clone https://github.com/byowen00/ivoirecovoit.git && cd ivoirecovoit
cp .env.example .env
docker compose -f infrastructure/docker-compose.yml --env-file .env --profile storage up -d --wait
pnpm install
pnpm db:migrate && pnpm db:seed && pnpm db:seed:demo
pnpm --filter @ivoirecovoit/backend storage:init
pnpm dev:backend          # http://localhost:3000/api/v1  (documentation : /api/docs)
pnpm dev:web              # autre terminal : http://localhost:3001
```

Application mobile sur l'émulateur :

```bash
cd apps/mobile && flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000
```

Sur un téléphone branché en USB (débogage USB activé) : `adb reverse tcp:3000 tcp:3000`, puis
`--dart-define=API_BASE_URL=http://127.0.0.1:3000`.

## 3. Vérifier

```bash
pnpm --filter @ivoirecovoit/backend test     # utilise la base ivoirecovoit_test (recréée), Redis base 15, S3 local
pnpm --filter @ivoirecovoit/web test
cd apps/mobile && flutter analyze && flutter test
```

Connexion : avec `OTP_TEST_MODE=true`, le code s'affiche à l'écran. Console : créer un compte du personnel
(`pnpm --filter @ivoirecovoit/backend staff:create -- --email … --role SUPER_ADMIN`) puis http://localhost:3001/admin.

## Problèmes fréquents

| Symptôme | Cause et solution |
|---|---|
| `port is already allocated` (5432, 6379, 9000) | un PostgreSQL ou Redis local tourne déjà : l'arrêter, ou changer le port publié |
| L'API refuse de démarrer « Configuration invalide » | lire la liste affichée : une variable de `.env` manque ou a une valeur interdite |
| Dépôt de documents en erreur 503 | stockage non lancé : profil `storage` puis `storage:init` |
| L'application mobile ne joint pas l'API | émulateur : `10.0.2.2` ; téléphone : `adb reverse` ou l'adresse IP de l'ordinateur sur le même Wi-Fi |
