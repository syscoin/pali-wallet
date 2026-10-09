---
title: Comptes intelligents et validateurs
---

Les comptes intelligents Pali sont des comptes de contrat EVM qui peuvent être contrôlés par des modules. Une passkey est l’un des moyens pris en charge pour contrôler un compte intelligent. Au lieu de signer chaque action avec la clé privée d’un EOA ordinaire, l’utilisateur peut approuver des actions avec l’interface de passkeys du navigateur ou du système d’exploitation.

En interne, les passkeys WebAuthn utilisent des signatures P-256. Le validateur de passkeys de Pali est conçu pour que le compte intelligent puisse vérifier ces preuves P-256. Une approbation biométrique ou par passkey de plateforme peut ainsi autoriser une action sur la chaîne sans exposer la clé privée de la passkey à Pali ou à la dapp.

## Pourquoi utiliser un compte intelligent ?

- Méthodes d’approbation modulaires pour un usage quotidien.
- Contrôle ECDSA par le portefeuille lorsqu’une clé de portefeuille ordinaire doit posséder le compte.
- Politiques de gestion partagée via des validateurs composites.
- Exécution groupée avec une seule approbation de l’utilisateur.
- Récupération par des gardiens après un délai de verrouillage.
- Création déterministe permettant à Pali de reconstruire les enregistrements des comptes.

## Passkeys, ECDSA et comptes à gestion partagée

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-create.png" alt="Écran des réglages Pali pour créer un compte intelligent" />
</a>
  <figcaption>Les utilisateurs peuvent créer des comptes intelligents modulaires depuis les Réglages ou les demandes de dapps, puis choisir le validateur qui contrôle les approbations.</figcaption>
</figure>

Pali prend en charge trois types de validateurs :

- **Passkey :** le navigateur ou le système d’exploitation demande une approbation WebAuthn.
- **ECDSA :** les adresses EVM des propriétaires configurés approuvent les actions du compte.
- **Composite :** les validateurs enfants sont combinés selon un seuil, par exemple passkey ou ECDSA.

Considérez les validateurs comme la réponse à la question « qui peut approuver des actions pour ce compte ? ». L’intérêt est que la réponse peut changer sans changer votre compte :

- **N’importe lequel de mes moyens de connexion** (1-of-N) : approuvez avec la passkey ou la clé disponible.
- **Quelques-uns d’entre nous ensemble** (t-of-N) : un quorum de personnes ou d’appareils doit être d’accord, idéal pour les fonds partagés.
- **Nous tous ensemble** (N-of-N) : tous les moyens de connexion configurés doivent approuver, pour les comptes les plus sensibles.

Les politiques peuvent même contenir d’autres politiques. Une équipe peut ainsi exprimer des règles comme « la clé du responsable plus deux passkeys quelconques de la salle des marchés ». Votre adresse, vos soldes et votre historique restent exactement les mêmes lorsque la politique change. La signature étant modulaire, de futurs types de signature, y compris post-quantiques, pourront être adoptés sur le même compte.

Les gardiens ne font volontairement **pas** partie de cette liste. Un gardien ne peut jamais approuver une transaction ; son seul pouvoir est de lancer une récupération lente et visible si vous perdez l’accès. Cette séparation vous protège contre la perte d’accès sans donner à quiconque le contrôle au quotidien.

Pali peut utiliser un profil de passkey partagé par le portefeuille ou créer une information d’identification passkey distincte pour un compte. Les passkeys partagées sont pratiques pour les utilisateurs qui veulent une seule passkey contrôlée par le portefeuille. Des passkeys distinctes peuvent aider à isoler les informations d’identification par service ou politique.

## Déploiement

Un compte intelligent peut exister sous forme d’adresse contrefactuelle pendant que Pali prépare sa création. Pali dérive l’adresse à partir de paramètres déterministes de la factory, effectue le déploiement via la factory Pali et enregistre localement des métadonnées durables du compte.

Le compte commence avec un validateur initial contrôlé par le portefeuille pour un déploiement déterministe. Si l’utilisateur ou la dapp a sélectionné une passkey ou un autre validateur, Pali installe ce validateur et retire le validateur initial au moyen d’une exécution du compte intelligent.

## Réseaux pris en charge

Les comptes intelligents nécessitent que la factory Pali et les contrats des modules existent aux adresses utilisées par Pali pour la chaîne active. Dans cette version de Pali, le réseau de test `zkTanenbaum` est configuré pour la création de comptes intelligents. La prise en charge de zkSYS en production utilise le même modèle une fois les adresses de production de la factory et des modules configurées.

D’autres chaînes EVM compatibles peuvent utiliser les mêmes contrats. Lorsque le réseau actif dispose d’une prise en charge canonique de CREATE2, Pali peut déployer l’infrastructure manquante des comptes intelligents depuis le portefeuille : ouvrez les Réglages, accédez à Avancé et utilisez le bouton de déploiement de **Configuration du compte intelligent**. Les validateurs de passkeys nécessitent la vérification P-256 WebAuthn, que de nombreux environnements EVM modernes proposent via un précompilé P-256/passkey.

### Configuration en attente

Une configuration lente propose l’action **Vérifier le statut**. Quitter la page ou changer de réseau n’annule pas une transaction déjà soumise. Revenez au réseau d’origine et vérifiez l’état de sa configuration avant de tenter un autre déploiement. Un délai dépassé ou l’absence de réponse ne prouvent pas qu’aucun déploiement n’a eu lieu.

## Récupération

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-policy.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-policy.png" alt="Écran des réglages de politique des comptes intelligents Pali" />
</a>
  <figcaption>L’écran de politique du compte intelligent affiche les modules installés, les détails du validateur actif, la récupération par gardiens et la gestion des modules.</figcaption>
</figure>

Si les données locales du portefeuille sont supprimées ou si Pali est installé sur un nouvel appareil, les comptes intelligents déterministes Pali peuvent être reconstruits à partir des métadonnées du portefeuille et de la configuration de la chaîne. Les comptes avec un validateur de passkey nécessitent toujours l’accès à l’information d’identification passkey correspondante pour approuver des actions.

Une information d’identification passkey peut contrôler plusieurs comptes intelligents. Pali sépare le profil de la passkey des métadonnées de chaque compte intelligent déployé.

## Récupération par des gardiens

Pali utilise des gardiens de récupération en auto-garde pour les comptes intelligents. Un gardien est une adresse EVM que l’utilisateur contrôle séparément du validateur actif : généralement un portefeuille EVM de secours, un compte importé ou un portefeuille matériel. Sur la chaîne, un gardien peut toutefois être **n’importe quel compte capable de prouver une signature**, y compris un compte de contrat. Tant que le compte fonctionne normalement, l’utilisateur peut ajouter ou retirer des gardiens et modifier le délai d’attente depuis l’écran de politique.

Le module de récupération vérifie les approbations des gardiens au moyen de contrôles de signature standards : une signature ECDSA ordinaire pour les adresses normales, ou une vérification de signature de contrat ERC-1271 lorsque l’adresse du gardien est un contrat. Un gardien peut donc être un autre compte intelligent, y compris un compte dont la politique de signature repose sur un validateur composite, personnalisé ou futur post-quantique. Le parcours de récupération hérite du schéma de signature imposé par le compte du gardien ; sa sécurité n’est donc pas limitée aux clés ECDSA classiques.

Une limite actuelle : les écrans de gardiens de Pali recueillent aujourd’hui les approbations de gardiens fondés sur des clés, qu’il s’agisse de comptes du portefeuille, importés ou matériels. Le module de récupération déployé prend pleinement en charge les gardiens constitués de comptes de contrat, mais la production de leur approbation ERC-1271 n’est pas encore un parcours guidé dans Pali. Un gardien de contrat doit également être déjà déployé sur la chaîne pour répondre aux vérifications de signature. Cette flexibilité fait déjà partie du modèle de compte ; ces types de gardiens peuvent donc être proposés dans le portefeuille sans redéployer ni modifier le compte.

La récupération par gardiens n’est pas instantanée. Son lancement crée une cible de récupération de remplacement, demande au gardien configuré de signer l’intention de récupération et soumet une demande soumise à un délai de verrouillage. Une fois le délai écoulé, n’importe qui peut finaliser la transaction de récupération. L’utilisateur peut alors utiliser le compte avec le validateur de remplacement.

La signature du gardien lie la chaîne, l’adresse du compte, le module de récupération, le sel de récupération, le mode d’exécution et les données d’appel de récupération. Pali utilise un nouveau sel à chaque tentative, et le module n’autorise qu’une seule récupération active par compte.

Note technique : l’exécuteur de récupération par gardiens stocke pour chaque compte un ensemble de gardiens, un seuil, un délai, une expiration et une récupération en attente. Pali propose actuellement des parcours simples pour les gardiens afin de faciliter l’utilisation, tandis que le module prend en charge des politiques à seuil telles que 1-of-N ou M-of-N.

## Comptes créés par des dapps

Les dapps peuvent demander un compte intelligent avec `wallet_prepareSmartAccount` :

```
{
  "label": "Trading desk",
  "authenticator": {
    "id": "p256-webauthn"
  }
}
```

Les dapps peuvent également demander un validateur ECDSA :

```
{
  "label": "Trading desk",
  "authenticator": {
    "id": "ecdsa",
    "config": {
      "owners": ["0x..."],
      "threshold": 1
    }
  }
}
```

Si le propriétaire ECDSA demandé n’est pas un compte local de Pali, Pali affiche un avertissement et exige une confirmation explicite avant de continuer.

## Références des standards

Les comptes intelligents Pali reposent sur des standards publics de comptes intelligents :

- [Abstraction de comptes ERC-4337](https://eips.ethereum.org/EIPS/eip-4337) pour l’exécution de comptes de type UserOperation.
- [Comptes intelligents modulaires ERC-7579](https://eips.ethereum.org/EIPS/eip-7579) pour les modules de validation et d’exécution.
- [Validation de signatures de contrat ERC-1271](https://eips.ethereum.org/EIPS/eip-1271) pour les signatures de comptes de contrat.
- [WebAuthn niveau 3](https://www.w3.org/TR/webauthn-3/) pour les approbations par passkey.
