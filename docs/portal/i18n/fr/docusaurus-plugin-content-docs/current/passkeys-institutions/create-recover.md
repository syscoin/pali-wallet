---
title: Créer et récupérer des comptes intelligents
---

`wallet_prepareSmartAccount` crée un compte intelligent Pali pour l’intégration des utilisateurs par une dapp. Pali dérive le compte, le déploie via la factory configurée, installe le validateur demandé si nécessaire, connecte le compte à la dapp demandeuse et enregistre des métadonnées durables du compte dans l’état local du portefeuille.

L’état local du portefeuille représente les comptes intelligents que Pali peut utiliser. Un compte intelligent peut être contrôlé par un validateur de passkey, un validateur ECDSA, un validateur composite ou des modules de récupération par gardiens installés après sa création.

## Structure du compte intelligent et de la factory

Le système de comptes intelligents comporte les éléments suivants :

- **Factory :** calcule des adresses déterministes et déploie des comptes avec les données initiales des modules.
- **Compte intelligent :** exécute des appels, suit les modules installés et demande aux validateurs d’approuver les signatures.
- **Validateurs :** autorisent des actions. Pali prend en charge ECDSA, les passkeys P-256 WebAuthn et les validateurs composites.
- **Exécuteurs :** ajoutent des fonctionnalités au compte. Pali utilise la récupération par gardiens comme module exécuteur.

Les paramètres de compte de la factory comprennent :

| Paramètre | Signification |
| --- | --- |
| `salt` | Sel de déploiement déterministe dérivé par Pali à partir de l’ancre du portefeuille, de l’index du compte, de la chaîne et de la version du compte. |
| `initialValidator` | Module validateur utilisé pour le déploiement initial. Pali utilise un validateur ECDSA contrôlé par le portefeuille pour une configuration déterministe. |
| `initData` | Données encodées d’initialisation du validateur. |

Après le déploiement, Pali peut installer le validateur demandé et retirer le validateur initial dans un seul lot d’actions du compte intelligent. Une dapp peut ainsi demander un compte contrôlé par passkey tandis que Pali conserve un premier parcours de déploiement déterministe.

## Créer un compte contrôlé par passkey

```js
const smartAccount = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [
    {
      label: 'Pali Wallet Passkey',
      authenticator: { id: 'p256-webauthn' },
    },
  ],
});
```

Si la dapp omet `authenticator`, Pali utilise par défaut le parcours de passkey. Utilisez une demande contenant uniquement l’identifiant, par exemple `{ id: 'p256-webauthn' }`, et laissez Pali sélectionner ou créer l’information d’identification contrôlée par le portefeuille. Les propriétaires ECDSA externes utilisent toujours le parcours de confirmation explicite décrit ci-dessous.

## Créer un compte intelligent ECDSA

```js
const smartAccount = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [
    {
      label: 'Team account',
      authenticator: {
        id: 'ecdsa',
        config: {
          owners: ['0xOwnerAddress'],
          threshold: 1,
        },
      },
    },
  ],
});
```

Les propriétaires ECDSA qui sont déjà des comptes locaux du portefeuille Pali sont considérés comme contrôlés par le portefeuille. Les adresses de propriétaires ECDSA externes ne sont autorisées qu’après un avertissement et une confirmation explicites, car elles peuvent approuver de futures actions du compte intelligent.

## Comportement de création et de déploiement

Lorsqu’une dapp demande un compte intelligent :

1. Pali vérifie que la chaîne active dispose de l’infrastructure de comptes intelligents Pali configurée.
2. Pali dérive le descripteur déterministe du compte suivant et son adresse contrefactuelle.
3. Pali crée ou normalise l’authentificateur demandé.
4. Pali affiche l’hôte de la dapp, le libellé du compte, le type d’authentificateur et les éventuels propriétaires ECDSA externes.
5. Pali crée le compte localement et le déploie sur la chaîne avec le validateur initial.
6. Si le validateur demandé diffère du validateur initial, Pali installe le validateur demandé et désinstalle le validateur initial au moyen d’une exécution du compte intelligent.
7. Pali attend la confirmation, stocke les métadonnées durables du compte intelligent et connecte le compte à la dapp.

Si l’adresse obtenue est déjà présente localement, Pali peut réutiliser ce compte intelligent local.

## Qu’est-ce qui détermine l’adresse ?

L’adresse du compte intelligent est dérivée de la factory, de l’implémentation du compte, des données d’initialisation du validateur initial et du sel de déploiement déterministe de Pali. Pali dérive ce sel d’une ancre du portefeuille et de l’index du compte ; les comptes sont donc récupérables à partir des métadonnées du portefeuille plutôt que d’un état local aléatoire.

## Si l’utilisateur perd les données locales de Pali

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-recover.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-recover.png" alt="Écran des réglages Pali pour récupérer des comptes intelligents" />
</a>
  <figcaption>L’écran de récupération aide à restaurer l’accès aux comptes intelligents en reconstruisant les comptes créés par Pali ou en utilisant la récupération par gardiens pour remplacer le validateur actif.</figcaption>
</figure>

Si le profil du navigateur, le stockage de l’extension ou les métadonnées locales du compte intelligent sont perdus, la récupération dépend des modules actuels du compte :

- Les comptes déterministes créés par Pali peuvent être reconstruits à partir de l’ancre du portefeuille, de la chaîne, de l’index du compte et de la configuration de la factory.
- Les validateurs de passkey nécessitent toujours l’information d’identification WebAuthn correspondante pour autoriser de futures actions.
- La récupération par gardiens peut remplacer le validateur actif après le délai configuré si la méthode d’approbation d’origine est indisponible.

La récupération Pali fonctionne en auto-garde. Ce n’est pas une porte dérobée du serveur et elle ne peut pas contourner les modules installés du compte.

## RP ID et nom de l’information d’identification

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-assert.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-assert.png" alt="Demande d’assertion de passkey du navigateur ou du système d’exploitation" />
</a>
  <figcaption>La récupération et l’exécution nécessitent une assertion WebAuthn de l’information d’identification passkey correspondante.</figcaption>
</figure>

Le navigateur contrôle le RP ID effectif de WebAuthn pour l’origine de l’extension, sauf si le parcours du portefeuille fournit un RP ID. Pali nomme l’information d’identification partagée par défaut `Pali Wallet Passkey` et utilise le libellé de compte demandé pour afficher à l’utilisateur l’association avec le compte.
