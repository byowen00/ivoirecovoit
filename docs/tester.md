# Tester IvoireCovoit sur son ordinateur et son téléphone

Tout tourne sur votre ordinateur : base de données, API et site. Le téléphone s'y connecte par le **même Wi-Fi**.
Aucun SMS n'est envoyé et aucun argent ne circule : le code de connexion s'affiche à l'écran et le paiement passe
par une page simulée.

## 1. Installer (une seule fois, Windows 10/11)

1. **Docker Desktop** : https://www.docker.com/products/docker-desktop/ (accepter l'installation de WSL 2 s'il le
   demande, puis redémarrer). Le lancer et attendre « Engine running ».
2. **Node.js 22 LTS** : https://nodejs.org (installateur Windows, options par défaut).
3. **Git** : https://git-scm.com/download/win.
4. Ouvrir **PowerShell** et récupérer le code :

```powershell
cd $HOME
git clone https://github.com/byowen00/ivoirecovoit.git
cd ivoirecovoit
npm install -g pnpm@10.0.0      # puis fermer et rouvrir PowerShell, et revenir dans ce dossier
pnpm install
Copy-Item .env.example .env
```

Sur Linux ou macOS : mêmes étapes avec Docker, Node 22 et `cp .env.example .env` (voir [installation-linux.md](installation-linux.md)).

## 2. Lancer sur l'ordinateur

Dans PowerShell, dossier `ivoirecovoit` :

```powershell
docker compose -f infrastructure/docker-compose.yml --env-file .env up -d --wait
pnpm db:migrate
pnpm db:seed
pnpm db:seed:demo
pnpm dev:backend
```

Ouvrir une **deuxième** fenêtre PowerShell dans le même dossier : `pnpm dev:web`.
Puis, dans le navigateur de l'ordinateur : **http://localhost:3001**.

Les jours suivants, seules trois commandes sont utiles : Docker Desktop lancé, `docker compose ... up -d --wait`,
puis `pnpm dev:backend` et `pnpm dev:web`.

## 3. Comptes de démonstration

Connexion par numéro de téléphone. Le code à 6 chiffres s'affiche dans l'encadré « Mode test ».

| Numéro | Profil |
|---|---|
| 00 00 00 00 01 à 00 00 00 00 04 | conducteurs [DEMO] avec véhicule et trajets publiés |
| 00 00 00 00 11 à 00 00 00 00 13 | passagers [DEMO] |
| tout autre numéro | nouveau compte à créer (inscription complète) |

Parcours à essayer : chercher un trajet (par exemple Abidjan → Yamoussoukro), réserver, payer sur la page
simulée (« Valider le paiement » ou « Refuser »), écrire au conducteur ; avec un compte conducteur, publier un trajet et
accepter une demande.

**Console d'administration** (http://localhost:3001/admin) : créer d'abord un compte du personnel. Il faut une
application d'authentification sur le téléphone (Google Authenticator, Microsoft Authenticator…) :

```powershell
pnpm --filter @ivoirecovoit/backend staff:create -- --email vous@exemple.ci --first Prénom --last Nom --role SUPER_ADMIN
```

Choisir un mot de passe, puis ouvrir le lien `otpauth://` affiché (ou le recopier dans l'application) : le code à
6 chiffres de l'application est demandé à chaque connexion.

## 4. Sur le téléphone

### a) Préparer l'ordinateur pour le réseau

1. Trouver l'adresse de l'ordinateur : PowerShell → `ipconfig` → ligne « Adresse IPv4 » de la carte Wi-Fi,
   par exemple `192.168.1.20`.
2. Le Wi-Fi de l'ordinateur doit être en réseau **privé** (Paramètres → Réseau et Internet → Wi-Fi → propriétés).
   Au premier lancement de `pnpm dev:backend` et `pnpm dev:web`, Windows demande d'autoriser Node.js :
   cocher « Réseaux privés ». Si la question n'apparaît pas, PowerShell **en administrateur** :

```powershell
New-NetFirewallRule -DisplayName "IvoireCovoit essai" -Direction Inbound -Protocol TCP -LocalPort 3000,3001,9000 -Action Allow -Profile Private
```

3. Dans le fichier `.env`, remplacer `localhost` par l'adresse de l'ordinateur sur ces lignes (exemple avec
   192.168.1.20), puis relancer `pnpm dev:backend` :

```
API_BASE_URL=http://192.168.1.20:3000
WEB_BASE_URL=http://192.168.1.20:3001
S3_PUBLIC_ENDPOINT=http://192.168.1.20:9000
CORS_ORIGINS=http://localhost:3001,http://192.168.1.20:3001
```

Laisser `API_INTERNAL_URL`, `DATABASE_URL` et `REDIS_URL` sur `localhost`.

### b) Le site dans le navigateur du téléphone (le plus simple)

Ouvrir **http://192.168.1.20:3001** dans Chrome sur le téléphone. C'est le même site, adapté aux petits écrans.

### c) L'application Android

1. Sur GitHub : dépôt → onglet **Actions** → **APK d'essai** → **Run workflow** → saisir
   `http://192.168.1.20:3000` → **Run workflow**. Compter une dizaine de minutes.
2. Ouvrir l'exécution terminée, télécharger l'artefact **ivoirecovoit-apk-essai** (fichier zip), l'envoyer sur le
   téléphone (câble, Google Drive, WhatsApp…) et le décompresser.
3. Installer **app-arm64-v8a-profile.apk** (sur un téléphone ancien : `app-armeabi-v7a-profile.apk`) ; Android
   demande d'autoriser l'installation depuis cette source.

Cet APK ne fonctionne qu'avec l'ordinateur à cette adresse. Si l'adresse change (autre Wi-Fi, redémarrage de la
box), relancer « APK d'essai » avec la nouvelle adresse, ou fixer l'adresse dans la box.

Avec Flutter et Android Studio installés (voir [installation-windows.md](installation-windows.md)), on peut aussi
brancher le téléphone en USB (débogage USB activé) et lancer depuis `apps/mobile` :
`flutter run --dart-define=API_BASE_URL=http://192.168.1.20:3000`.

## 5. Problèmes fréquents

| Symptôme | Solution |
|---|---|
| Le téléphone n'ouvre pas la page | même Wi-Fi ? réseau « privé » ? règle du pare-feu ? Certains Wi-Fi publics ou d'invités isolent les appareils |
| L'application affiche « impossible de joindre le serveur » | adresse de l'APK différente de celle de l'ordinateur ; `pnpm dev:backend` arrêté |
| La page de paiement simulée ne s'ouvre pas sur le téléphone | `API_BASE_URL` / `WEB_BASE_URL` encore sur `localhost` dans `.env` |
| `docker compose` échoue | Docker Desktop n'est pas lancé |
| `ports are not available ... 5432` | port déjà pris (souvent un PostgreSQL installé sur Windows) : dans `.env`, ajouter `POSTGRES_HOST_PORT=15432` et remplacer `localhost:5432` par `localhost:15432` dans `DATABASE_URL` et `TEST_DATABASE_URL` |
| `pnpm dev:web` : port 3001 déjà pris | `pnpm --filter @ivoirecovoit/web exec next dev -p 4001`, et `localhost:4001` dans `WEB_BASE_URL` et `CORS_ORIGINS` de `.env` |
| La carte reste grise | pas d'accès Internet (les fonds de carte viennent d'OpenStreetMap) |
| Remettre les données à zéro | `docker compose -f infrastructure/docker-compose.yml down -v`, puis les commandes de la section 2 |

Pour noter les modifications à faire : une ligne par point, avec l'écran concerné et, si possible, une capture.
