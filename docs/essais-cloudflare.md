# Essais à distance avec Cloudflare Tunnel (gratuit, sans carte)

Le PC Windows fait serveur ; Cloudflare lui donne une adresse publique en HTTPS
(`https://quelque-chose.trycloudflare.com`). Une seule adresse suffit : le site relaie lui-même l'API
(`/api/v1`), donc l'appli et le site passent par le même lien.

À savoir :

- Le PC doit rester allumé et ne pas se mettre en veille pendant les essais.
- L'adresse change à chaque lancement de Cloudflare : il faut la redonner aux testeurs et la remettre dans l'appli.
- C'est une pré-production : codes de connexion affichés, paiements simulés. Ne partagez le lien qu'avec des
  testeurs, et uniquement avec des données de test.
- Le bouton « Entrer sans mot de passe » de la console `/admin` ne marche **pas** par le lien Cloudflare
  (seulement sur le PC ou le Wi-Fi) : la console reste protégée sur Internet.

## 1. Installer Cloudflare (une seule fois)

PowerShell :

```powershell
winget install --id Cloudflare.cloudflared
```

Fermer puis rouvrir PowerShell. Aucun compte Cloudflare n'est nécessaire.

## 2. Lancer l'application comme d'habitude

API sur le port 4000, site sur le port 4001 (avec `$env:API_INTERNAL_URL="http://localhost:4000"`).
Vérifier que http://localhost:4001 s'ouvre.

## 3. Ouvrir le tunnel

Dans une **nouvelle** fenêtre PowerShell (à laisser ouverte) :

```powershell
cloudflared tunnel --url http://localhost:4001
```

Au bout de quelques secondes, une adresse s'affiche dans un cadre :
`https://xxxx-xxxx-xxxx.trycloudflare.com`. C'est le lien à donner aux testeurs.

## 4. Sur le téléphone (appli)

1. Ouvrir l'appli → « Se connecter ».
2. En bas de l'écran : **Adresse du serveur (essais)** → coller l'adresse Cloudflare → **Enregistrer**.
3. Se connecter avec son numéro (connexion automatique en mode essai).

Le téléphone n'a plus besoin d'être sur le même Wi-Fi : la 4G suffit. « Par défaut » revient à l'adresse du PC
sur le Wi-Fi.

## 5. Photos et documents (facultatif)

Les envois de photos et de documents vont au stockage du PC (port 9000), que le premier tunnel n'ouvre pas.
Pour les tester à distance, ouvrir un deuxième tunnel :

```powershell
cloudflared tunnel --url http://localhost:9000
```

puis, dans `.env`, mettre `S3_PUBLIC_ENDPOINT=` suivi de cette deuxième adresse, et redémarrer l'API.

## Arrêter

Ctrl+C dans la fenêtre de Cloudflare : le lien cesse aussitôt de fonctionner.
