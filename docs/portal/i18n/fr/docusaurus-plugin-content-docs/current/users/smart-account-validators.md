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

Pali prend en charge les types de validateurs suivants :

- **Passkey :** le navigateur ou le système d’exploitation demande une approbation WebAuthn.
- **ECDSA :** les adresses EVM des propriétaires configurés approuvent les actions du compte.
- **SLH-DSA :** le signataire post-quantique local de Pali approuve les actions à l’aide de son état de signature chiffré. Consultez [Signataire post-quantique](./post-quantum-signer) pour connaître les limites des sauvegardes et du compteur de signatures.
- **Composite :** les validateurs enfants sont combinés selon un seuil, par exemple passkey ou ECDSA.

Considérez les validateurs comme la réponse à la question « qui peut approuver des actions pour ce compte ? ». L’intérêt est que la réponse peut changer sans changer votre compte :

- **Une approbation** (1-of-N) : un validateur enfant configuré doit approuver.
- **Un seuil d’approbations** (t-of-N) : au moins le nombre configuré de validateurs enfants doit approuver.
- **Toutes les approbations** (N-of-N) : tous les validateurs enfants configurés doivent approuver.

Pali recueille les approbations des validateurs enfants intégrés disponibles localement, dans l’ordre configuré par la politique, jusqu’à atteindre son seuil. Refuser une approbation arrête la demande ; Pali ne passe pas silencieusement à un autre signataire après un refus. Une politique doit conserver assez de validateurs enfants intégrés capables de signer localement pour atteindre son seuil. Les validateurs personnalisés compatibles peuvent être des enfants facultatifs, mais Pali ne recueille pas pour eux de signatures externes ou personnalisées ni d’approbations entre appareils. Cette version ne prend pas en charge les politiques composites imbriquées.

Le constructeur de politiques composites nécessite au moins deux validateurs installés. Le parcours guidé de changement de méthode d’approbation remplace le validateur précédent. Le parcours avancé actuel **Validateur personnalisé** permet de conserver des validateurs compatibles supplémentaires, mais exige les bonnes données d’initialisation du module ; ce n’est pas une configuration simplifiée d’approbations entre appareils.

Changer de validateur ne modifie ni l’adresse, ni les soldes, ni l’historique du compte intelligent. L’accès à un signataire local dépend toujours de la disponibilité de sa clé ou de sa passkey ; changer de politique ne restaure pas l’état de signature manquant et ne coordonne pas l’utilisation de SLH-DSA entre des appareils restaurés.

Les gardiens constituent une autorité distincte et différée, pas la méthode d’approbation quotidienne. Un nombre suffisant d’approbations de gardiens peut changer le contrôle du compte. Choisissez et protégez-les en conséquence : le délai ne rend pas sûr un gardien non fiable.

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
  <figcaption>Les paramètres du compte intelligent commencent par l’enregistrement s’il n’est pas encore déployé. Ils donnent ensuite accès aux options d’approbation et de récupération.</figcaption>
</figure>

Si les données locales du portefeuille sont supprimées ou si Pali est installé sur un nouvel appareil, les comptes intelligents déterministes Pali peuvent être reconstruits à partir des métadonnées du portefeuille et de la configuration de la chaîne. Les comptes avec un validateur de passkey nécessitent toujours l’accès à l’information d’identification passkey correspondante pour approuver des actions.

Une information d’identification passkey peut contrôler plusieurs comptes intelligents. Pali sépare le profil de la passkey des métadonnées de chaque compte intelligent déployé.

## Récupération par des gardiens

Pali utilise des gardiens de récupération en auto-garde pour les comptes intelligents. Un gardien est une adresse EVM que l’utilisateur contrôle séparément du validateur actif : généralement un portefeuille EVM de secours, un compte importé ou un portefeuille matériel. Sur la chaîne, un gardien peut toutefois être **n’importe quel compte capable de prouver une signature**, y compris un compte de contrat. Tant que le compte fonctionne normalement, l’utilisateur peut ajouter ou retirer des gardiens et modifier le délai d’attente depuis l’écran de politique.

Le module de récupération vérifie les approbations des gardiens au moyen de contrôles de signature standards : une signature ECDSA ordinaire pour les adresses normales, ou une vérification de signature de contrat ERC-1271 lorsque l’adresse du gardien est un contrat. Un gardien peut donc être un autre compte intelligent, y compris un compte dont la politique de signature repose sur un validateur composite, personnalisé ou futur post-quantique. Le parcours de récupération hérite du schéma de signature imposé par le compte du gardien ; sa sécurité n’est donc pas limitée aux clés ECDSA classiques.

Les écrans de gardiens de Pali peuvent recueillir les approbations de gardiens locaux fondés sur des clés (comptes du portefeuille, importés ou matériels) et de comptes intelligents locaux pour lesquels Pali peut signer, y compris les comptes SLH-DSA. Un gardien constitué d’un compte intelligent doit déjà être déployé sur la chaîne pour répondre aux vérifications de signature ERC-1271. Un gardien externe qui n’est pas disponible comme compte signataire local dans Pali nécessite toujours un parcours de récupération externe pour produire son approbation.

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

## Récupération par gardiens, étape par étape {#guardian-recovery-guide}

Restaurer les données locales du portefeuille et changer le contrôle d’un compte sont deux opérations différentes. Restaurer la seed ne contourne pas un validateur installé. La récupération par gardiens change, après un délai, la méthode d’approbation du même compte intelligent.

1. **Configurer :** ouvrez les paramètres de récupération tant que la méthode d’approbation actuelle fonctionne. Enregistrez d’abord le compte s’il n’est pas encore déployé. Choisissez un gardien contrôlé séparément et un délai, puis confirmez la configuration on-chain. Gardez le payeur de gas approvisionné.
2. **Lancer :** en cas de perte d’accès, choisissez une nouvelle méthode d’approbation dont vous pouvez prouver le contrôle. Le gardien configuré signe l’intention exacte de récupération. Son envoi coûte du gas ; il ne change pas encore le contrôle.
3. **Attendre et finaliser :** l’ancienne méthode reste active jusqu’à la finalisation réussie. Revenez au même compte et au même réseau après le délai. Après le délai, toute personne peut envoyer la finalisation de la récupération exacte déjà approuvée par les gardiens, avant son expiration. La nouvelle méthode contrôle alors le même compte ; adresse, fonds et historique restent en place.

Après finalisation, la méthode active remplacée n’autorise plus ce compte. Ne supprimez les anciennes clés ou passkeys qu’après avoir vérifié qu’aucun autre compte ou réseau n’en a besoin. Une demande expirée avant finalisation nécessite une nouvelle tentative.

Les nouvelles politiques Pali proposent **3 ou 7 jours** d’attente. **10 minutes** est réservé aux testnets connus. Ce sont des choix de configuration Pali, pas un minimum imposé à tout le contrat. La configuration on-chain existante reste déterminante. Le délai d’attente est distinct de la fenêtre ultérieure de finalisation.

### Arrêter une récupération inattendue

Si vous contrôlez encore la méthode d’approbation actuelle, choisissez **Disable guardian recovery** (désactiver la récupération par gardiens) dans les paramètres de récupération. Vérifiez compte et réseau, confirmez et payez le gas. Le retrait confirmé invalide toutes les récupérations en attente, même lancées hors de ce portefeuille, et supprime cette voie. Reconfigurez ensuite des gardiens fiables si vous souhaitez la conserver.

Le retrait doit être confirmé avant la finalisation indésirable ; il n’annule pas une récupération déjà achevée. Si le résultat est incertain, vérifiez d’abord l’état on-chain. Une erreur, un timeout ou la fermeture de la fenêtre n’annule pas une transaction envoyée. Ne la renvoyez pas à l’aveugle.

### Alertes facultatives par e-mail

Le lien des paramètres ouvre **Sysnode Account → Recovery alerts**. Utilisez un e-mail vérifié, connectez le compte intelligent déployé sur un réseau pris en charge et signez l’inscription avec sa méthode d’approbation actuelle. Vérifiez que la surveillance est active. C’est facultatif et indépendant de la configuration des gardiens : Sysnode ne reçoit aucune clé privée et ne peut ni déplacer des fonds ni annuler la récupération.

La surveillance continue quand Pali est fermé, mais dépend du service, de son RPC et de l’acheminement des e-mails. Les alertes peuvent être retardées ou manquer, et les observations récentes de la chaîne peuvent être réorganisées. L’absence d’e-mail ne prouve pas l’absence de récupération. Vérifiez toute alerte dans votre portefeuille de confiance pour le compte et le réseau exacts.
