# Accès restreint (facultatif)

Tout fichier `*.caddy` placé ici est inclus dans les sites web et API (voir `../Caddyfile`). Ces fichiers restent
sur le serveur : ils ne sont pas versionnés.

Exemple pour une **pré-production** : demander un mot de passe pour le site web, sauf aux webhooks du prestataire de paiement.

```caddy
@protege not path /api/v1/webhooks/*
basic_auth @protege {
	# Générer l'empreinte : docker run --rm caddy:2.11.7-alpine caddy hash-password --plaintext 'mot de passe'
	essai $2a$14$remplacer.par.l.empreinte.generee
}
```

Attention : ce fichier s'applique aussi à l'API, donc à l'application mobile, qui ne sait pas saisir ce mot de
passe. Pour tester l'application mobile en pré-production, limitez plutôt l'accès par adresse IP :

```caddy
@exterieur not remote_ip 203.0.113.10/32
respond @exterieur "Accès réservé" 403
```
