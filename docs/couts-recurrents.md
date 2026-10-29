# Coûts récurrents (estimation)

**Estimation au 29 octobre 2026, à reprendre avec de vrais devis.** Les prix viennent des pages publiques citées
(consultées ce jour, directement ou par des sites de comparaison quand le fournisseur ne les publie pas), hors
taxes, et changent souvent : Hetzner a par exemple relevé ses prix deux fois en 2026. Aucun contrat n'a été
signé et aucun devis demandé. 1 € = 655,957 FCFA (parité fixe) ; les montants en dollars ne sont pas convertis.

## Ce qui ne dépend pas du nombre d'utilisateurs

| Poste | Estimation | Source / remarque |
|---|---|---|
| Serveur (pré-production : 2 vCPU, 4 Go) | ~6 à 20 €/mois | Hetzner Cloud CX23 5,99 € (indisponible à la commande en octobre 2026), CPX22 19,99 € [1] |
| Serveur (lancement : 4 vCPU, 8 Go) | ~9 à 36 €/mois | Hetzner CX33 8,99 € (indisponible), CPX32 35,99 € [1] ; comparer avec un hébergeur en Afrique de l'Ouest pour la latence et la localisation des données |
| Stockage externe des sauvegardes et documents | ~7 $/To/mois | Backblaze B2 6,95 $/To, 10 Go gratuits [2] ; quelques Go au départ, donc quasi nul |
| Nom de domaine `.ci` | ~50 à 100 $/an | fourchette relevée par [3] ; présence locale exigée ; un `.com` en plus est conseillé |
| Certificats TLS | 0 | Let's Encrypt via Caddy |
| Fond de carte (tuiles) | 0 à 30 $/mois | MapTiler : gratuit 5 000 sessions/mois (usage non commercial selon la page), Flex 30 $ pour 25 000 [4]. Les tuiles d'openstreetmap.org ne peuvent pas servir une application en production |
| Compte développeur Google Play | 25 $ une fois | [5] |
| Notifications sur le téléphone (FCM) | 0 | service gratuit de Firebase (quotas larges) |
| Surveillance externe (sonde HTTP) | 0 à ~10 $/mois | offres gratuites limitées chez plusieurs fournisseurs |

## Ce qui dépend de l'activité

| Poste | Estimation | Source / remarque |
|---|---|---|
| SMS des codes de connexion | 0,49 $ par SMS chez Twilio [6] | prix élevé ; un agrégateur local ou un opérateur (Orange, MTN, Moov) est probablement bien moins cher : **demander des devis**. Ordre de grandeur : 1 SMS par connexion, les sessions durent 30 jours |
| Frais de paiement Mobile Money | ~1 % à 3,5 % par transaction | estimations non officielles d'une agence locale (août 2026) : Wave Business ~1 %, Orange Money marchand 1,5 à 3,5 %, CinetPay ~2,5 % + 50 FCFA [7]. À remplacer par la grille contractuelle de l'agrégateur choisi |
| Versements aux conducteurs | selon le prestataire | frais de transfert sortant (« payout ») souvent facturés en plus : à inclure dans le devis |

## Exemple chiffré (pré-production, hypothèses à valider)

| | Mensuel |
|---|---|
| Serveur CPX22 | 19,99 € ≈ 13 100 FCFA |
| Sauvegardes externes | < 1 $ |
| Domaine (75 $/an lissé) | ~6 $ |
| **Total hors SMS et paiements** | **~20 € + ~7 $ par mois** |

Au lancement, le poste principal sera vraisemblablement **les SMS** puis **les frais de paiement**, tous deux
proportionnels à l'activité, avant l'hébergement.

## Coûts ponctuels à prévoir (hors technique)

Rédaction et revue juridique des CGU et de la politique de confidentialité, formalités auprès de l'ARTCI
(données personnelles), création de la société et du compte marchand, éventuel audit de sécurité externe avant
l'ouverture, conception graphique (icône, fiche Play Store). Non chiffrés ici.

## Sources (consultées le 29 octobre 2026)

1. Hetzner, prix 2026 relevés par agentdeals.dev : https://agentdeals.dev/hetzner-pricing-2026
2. Backblaze B2 : https://egresscost.com/backblaze-b2
3. Domaines `.ci` : https://domaindetails.com/tlds/ci
4. MapTiler Cloud : https://www.maptiler.com/cloud/pricing/
5. Google Play Console : https://support.google.com/googleplay/android-developer/answer/6112435
6. Twilio, SMS vers la Côte d'Ivoire : https://www.twilio.com/en-us/sms/pricing/ci
7. Kolonell, frais Wave, Orange Money, CinetPay (estimations 2026) : https://kolonell.com/fr/blog/frais-transaction-wave-orange-money-cinetpay-comparatif-2026
