# Installation pour le développement : Windows 10/11

La méthode recommandée passe par **WSL 2** (Linux intégré à Windows) pour l'API et le site, et par Windows pour
Flutter et l'émulateur Android (accélération matérielle).

## 1. WSL 2 et Docker

1. PowerShell en administrateur : `wsl --install -d Ubuntu-24.04`, puis redémarrer et créer l'utilisateur Ubuntu.
2. Installer **Docker Desktop** (https://www.docker.com/products/docker-desktop/), cocher « Use the WSL 2 based
   engine », puis *Settings → Resources → WSL integration* : activer Ubuntu-24.04.
   Docker Desktop est payant au-delà d'une certaine taille d'entreprise (conditions de licence à vérifier) ;
   alternative gratuite : Docker Engine installé directement dans Ubuntu (voir le guide Linux).
3. Dans le terminal Ubuntu : suivre [installation-linux.md](installation-linux.md) sections 1 (sans Docker ni
   Flutter) et 2. Garder le dépôt **dans le système de fichiers Linux** (`~/ivoirecovoit`), pas dans
   `/mnt/c/...` : c'est beaucoup plus rapide.

Les adresses http://localhost:3000 et http://localhost:3001 fonctionnent depuis le navigateur Windows.

## 2. Flutter et Android (côté Windows)

1. Installer Git pour Windows et **Android Studio** (SDK Platform, Command-line Tools, Build-Tools, un émulateur).
2. Installer Flutter 3.47 stable : https://docs.flutter.dev/get-started/install/windows ; ajouter
   `C:\src\flutter\bin` au `Path`.
3. PowerShell : `flutter doctor --android-licenses` puis `flutter doctor`.
4. Cloner aussi le dépôt côté Windows (ou ouvrir `\\wsl$\Ubuntu-24.04\home\<vous>\ivoirecovoit\apps\mobile`), puis :

```powershell
cd ivoirecovoit\apps\mobile
flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000
```

L'émulateur voit l'API lancée dans WSL par `10.0.2.2:3000`, car WSL 2 publie ses ports sur `localhost` côté Windows.

## Sans WSL (déconseillé)

Tout fonctionne aussi dans PowerShell avec Node.js 22 (installateur officiel), `corepack enable` et Docker Desktop :
`Copy-Item .env.example .env`, puis les mêmes commandes `docker compose` et `pnpm`. Les scripts d'exploitation
(`infrastructure/*.sh`) demandent un shell Linux : ils ne servent que sur un serveur.

## Problèmes fréquents

| Symptôme | Solution |
|---|---|
| `docker: command not found` dans Ubuntu | activer l'intégration WSL dans Docker Desktop |
| Installation `pnpm` très lente | dépôt placé sous `/mnt/c` : le déplacer dans `~` |
| Émulateur très lent | activer la virtualisation dans le BIOS et « Windows Hypervisor Platform » |
| Fins de ligne modifiées dans Git | `git config --global core.autocrlf input` |
