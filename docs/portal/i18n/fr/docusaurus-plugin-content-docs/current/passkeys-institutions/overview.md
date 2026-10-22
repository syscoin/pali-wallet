---
title: Comptes intelligents Pali
---

Les comptes intelligents Pali sont des comptes de contrat que Pali peut créer, connecter et utiliser pour l’utilisateur. Pour un utilisateur non technique, l’expérience ressemble à un compte de portefeuille : examiner la demande de la dapp, approuver avec un passkey ou une clé de portefeuille, puis Pali envoie la transaction. En dessous, le compte est modulaire : les validateurs autorisent les actions et les exécuteurs ajoutent des fonctions comme la récupération.

## Idée simple

- Une seule adresse conserve les fonds et reste celle que voient les dapps.
- Le compte peut utiliser une passkey, ECDSA ou une politique composite.
- Le parcours de récupération par gardiens peut remplacer le validateur actif après un délai.
- `wallet_sendCalls` peut exécuter plusieurs appels dans une seule opération atomique.

## Modèle technique

`PaliSmartAccount` exécute les appels et vérifie les signatures via des modules de type ERC-7579. `PaliSmartAccountFactory` calcule des adresses déterministes et déploie les comptes. Pali prépare les exécutions au format ERC-4337 et utilise ERC-1271 pour les signatures des comptes de contrat.

Le compte est d’abord déployé avec un validateur ECDSA contrôlé par le portefeuille. Si la dapp demande une passkey ou un autre validateur pris en charge, Pali installe ce validateur et retire le validateur initial par une exécution du compte.

## Deux rôles : les validateurs signent, les gardiens récupèrent

ERC-7579 sépare les rôles des modules, et Pali s'appuie délibérément sur cette séparation :

- **Les validateurs** vérifient les signatures des approbations normales du compte, notamment les passkeys, ECDSA et les politiques composites.
- **Les exécuteurs** peuvent exécuter des actions via un module installé. Le module de gardiens de Pali exige le seuil configuré et un délai. Le parcours guidé remplace le validateur actif ; le module on-chain n’est pas limité à cette action de l’interface.

Les gardiens disposent donc d’une autorité différée sur le compte. Un seuil compromis menace son contrôle et ses fonds. Le propriétaire actuel peut agir pendant le délai, mais doit faire confirmer sa protection avant une exécution malveillante. Voir [Récupération par gardiens](../users/smart-account-validators).

## Politiques de signature composites

Le validateur composite combine des validateurs enfants sous un seuil, ce qui transforme un compte en moteur de politiques :

- **1-of-N** — n'importe lequel de plusieurs authentificateurs peut approuver. Pratique pour les comptes personnels avec un passkey sur chaque appareil.
- **t-of-N** — un quorum doit approuver. La forme naturelle pour les trésoreries partagées, les desks et les comptes contrôlés par une équipe.
- **N-of-N** — chaque validateur configuré doit approuver. Pour les comptes à assurance maximale.

Pali collecte actuellement les approbations des validateurs enfants intégrés disponibles localement jusqu’au seuil. Cette version ne prend pas en charge les composites imbriqués ni la collecte d’approbations externes ou entre appareils. La récupération par gardiens reste indépendante de la politique du validateur actif.

## Agilité des validateurs et préparation post-quantique

Sur les réseaux configurés, Pali prend en charge ECDSA contrôlé par le portefeuille, les passkeys P-256 WebAuthn, SLH-DSA et les validateurs composites. Les modules on-chain correspondants doivent être déployés et les clés ou identifiants locaux nécessaires disponibles. Les modules remplaçables permettent aussi d’adopter plus tard d’autres schémas de signature sur la même adresse. Un changement de validateur ne déplace ni fonds, ni historique, ni intégrations.

Le module de gardiens vérifie les approbations ECDSA des adresses normales et ERC-1271 des comptes de contrat. Pali peut utiliser les gardiens locaux à clés et les comptes intelligents locaux déjà déployés pour lesquels il peut signer, y compris SLH-DSA. Un gardien externe indisponible comme signataire local nécessite un parcours d’approbation externe.

## Pour les institutions et les équipes

Les institutions doivent traiter ces comptes comme une infrastructure de compte, pas seulement comme une connexion par passkey. Utilisez les passkeys pour simplifier l’accueil, ECDSA ou des validateurs composites pour les contrôles d’équipe ou de portefeuille matériel, la récupération par gardiens pour un remplacement différé, et des payeurs de gas approvisionnés pour le déploiement et l’exécution. Documentez qui contrôle chaque validateur, qui sont les gardiens et ce que signifie le délai de récupération.

Pali affiche un avertissement particulier si une dapp demande des propriétaires ECDSA externes, car ces adresses pourront approuver des actions futures du compte.

## Méthode dapp

```js
const account = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [{ label: 'Trading account', authenticator: { id: 'p256-webauthn' } }],
});
```

Si `authenticator` n’est pas fourni, Pali utilise une passkey par défaut.

## Réseaux pris en charge

Les comptes intelligents Pali fonctionnent sur les chaînes EVM compatibles où la factory et les modules Pali existent aux adresses attendues par Pali. Ce n'est pas limité aux chaînes opérées par Pali : si la chaîne active expose le déployeur CREATE2 canonique, Pali peut déployer la configuration de compte intelligent manquante directement depuis le portefeuille. Ouvrez Pali Settings, allez dans Advanced, puis utilisez le bouton Deploy dans **Smart account setup**.

Les validateurs passkey ont besoin de la vérification P-256 WebAuthn. Beaucoup d'environnements EVM modernes l'exposent via un precompile P-256/passkey, mais les intégrateurs doivent vérifier le support de la chaîne avant de dépendre des validateurs passkey.

## Contrôle utilisateur

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-create.png" alt="Browser or operating system passkey creation sheet" />
</a>
  <figcaption>Après la vérification dans le portefeuille, le navigateur ou le système d'exploitation gère la création du passkey WebAuthn lorsque le validateur choisi est basé sur passkey.</figcaption>
</figure>

L'utilisateur voit le site demandeur, le label du compte, l'authenticator demandé et les éventuelles adresses d'owners ECDSA externes avant d'approuver. Le navigateur ou le système d'exploitation affiche l'invite WebAuthn lorsque Pali a besoin d'une nouvelle credential passkey. Pali affiche la progression du déploiement, de l'installation des modules et de la confirmation avant de connecter le compte intelligent à la dapp.

<figure className="pali-video-card">
  <video controls poster="/img/screens/smart-account-dapp-onboarding-video.png" src="/video/smart-account-dapp-onboarding.mp4" title="Smart-account dapp onboarding flow"></video>
  <figcaption>Onboarding initié par la dapp : examinez la demande, confirmez, et le compte intelligent est prêt.</figcaption>
</figure>

## Références de standards

- [ERC-4337 account abstraction](https://eips.ethereum.org/EIPS/eip-4337)
- [ERC-7579 modular smart accounts](https://eips.ethereum.org/EIPS/eip-7579)
- [ERC-1271 contract signature validation](https://eips.ethereum.org/EIPS/eip-1271)
- [WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/)
