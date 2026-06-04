---
title: Créer et récupérer des comptes passkey
---

`wallet_createPasskeyAccount` crée un nouveau compte intelligent passkey pour l'intégration par dapp. Pali crée ou sélectionne un credential WebAuthn, déploie le compte intelligent on-chain, confirme les métadonnées de récupération déployées et écrit le compte dans l'état local du portefeuille après confirmation.

L'état local du portefeuille représente des comptes passkey déployés. La récupération est disponible dans les paramètres de Pali pour les comptes qui existent déjà on-chain.

## Structure du compte intelligent et de la factory

Le système passkey comporte deux éléments on-chain :

- **Factory :** crée les comptes, calcule les adresses contrefactuelles, expose les recherches de récupération et peut déployer puis exécuter la première action.
- **Compte intelligent :** stocke les métadonnées de récupération, le nonce, la politique de sponsor et valide les preuves d'exécution WebAuthn/P-256 avant d'exécuter les appels.

Les paramètres de compte de la factory incluent :

| Paramètre | Signification |
| --- | --- |
| `recoveryId` | Ancre de récupération limitée au portefeuille, dérivée du contexte du portefeuille Pali, du chain id et de l'adresse de factory. |
| `passkeyX`, `passkeyY` | Coordonnées de clé publique P-256 extraites du credential WebAuthn. |
| `credentialIdHash` | Hachage de l'id du credential WebAuthn. |
| `rpIdHash` | Hachage de RP ID WebAuthn provenant des données de l'authenticator. |
| `originHash`, `originLength` | Données de liaison à l'origine de l'extension provenant des données client WebAuthn. |
| `salt` | Sel de déploiement qui permet à un credential de contrôler plus d'un compte intelligent. |

Le compte intelligent expose l'exécution, la validation de signature, le nonce, la politique de sponsor et les lectures de métadonnées de récupération. Pali utilise ces métadonnées pour reconstruire les comptes après une perte d'état local.

## Créer avec le sponsoring désactivé

```js
const passkeyAccount = await window.ethereum.request({
  method: 'wallet_createPasskeyAccount',
  params: [
    {
      label: 'Pali Wallet Passkey',
      sponsor: {
        mode: 'disabled',
      },
    },
  ],
});
```

## Créer avec une politique de sponsor

<figure>
  <a className="pali-media-link" href="/img/screens/passkey-create-required.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/passkey-create-required.png" alt="Popup de création de compte passkey Pali avec détails de politique de sponsor requise" />
</a>
  <figcaption>Le sponsoring requis affiche l'URL du sponsor, le signataire et le texte de politique avant l'approbation de l'utilisateur.</figcaption>
</figure>

```js
const passkeyAccount = await window.ethereum.request({
  method: 'wallet_createPasskeyAccount',
  params: [
    {
      label: 'Institution Managed Account',
      sponsor: {
        mode: 'required',
        url: 'https://institution.example/sponsor/user-123',
        signer: '0xSponsorSignerAddress',
        policyText:
          'This account requires institution co-authorization for execution.',
      },
    },
  ],
});
```

## Comportement de création et de déploiement

Lorsqu'une dapp demande un compte passkey :

1. Pali vérifie que la chaîne active prend en charge les comptes intelligents passkey.
2. Pali crée un sel de déploiement frais pour le nouveau chemin de compte.
3. Pali obtient ou crée le profil de credential WebAuthn.
4. Pali calcule l'adresse contrefactuelle et les métadonnées de déploiement.
5. Si la politique de sponsor demandée exige une action initiale `setSponsor`, Pali demande à l'utilisateur une assertion passkey sur le hash d'action de déploiement.
6. Pali soumet `createAccount` ou `createAccountAndExecute` via le payeur de gas de déploiement configuré.
7. Pali attend la confirmation, lit les métadonnées de récupération du compte intelligent depuis la chaîne et vérifie qu'elles correspondent au credential préparé et aux données d'origine.
8. Après confirmation, Pali crée le compte passkey local et le connecte à la dapp demandeuse.

Si l'adresse résultante est déjà présente localement comme compte passkey déployé, Pali peut réutiliser ce compte local.

## Qu'est-ce qui détermine l'adresse ?

L'adresse du compte intelligent est dérivée des entrées de factory, notamment les coordonnées publiques passkey, le hachage du credential, les données d'origine, le hachage RP ID, le recovery ID et le sel de déploiement. Chaque nouveau chemin de compte utilise un sel de déploiement frais, ce qui permet à un credential de contrôler plusieurs comptes intelligents.

## Si l'utilisateur perd les données locales de Pali

<figure>
  <a className="pali-media-link" href="/img/screens/settings-passkey-recover.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-passkey-recover.png" alt="Écran des paramètres de Pali pour récupérer des comptes intelligents passkey" />
</a>
  <figcaption>L'écran de récupération découvre les comptes passkey on-chain qui correspondent au portefeuille restauré et à l'authenticator.</figcaption>
</figure>

Si le profil de navigateur, le stockage de l'extension ou les métadonnées locales du compte passkey sont perdus, la chaîne peut encore contenir suffisamment de métadonnées publiques pour récupérer le compte :

1. L'utilisateur restaure ou ouvre Pali avec le contexte de portefeuille qui ancre le recovery ID.
2. Pali demande une assertion WebAuthn découvrable à l'authenticator de l'utilisateur.
3. Pali interroge le registre de factory par recovery ID et hachage de credential.
4. Pali lit les métadonnées de récupération de chaque compte candidat.
5. Pali ignore les comptes déjà présents localement.
6. Pali réimporte les comptes correspondants dans l'état local du portefeuille.

La récupération depuis les paramètres découvre les comptes déployés et importe chaque compte correspondant exposé par le registre pour le credential.

## RP ID et nom du credential

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-assert.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-assert.png" alt="Invite d'assertion passkey du navigateur ou du système d'exploitation" />
</a>
  <figcaption>La récupération et l'exécution exigent une assertion WebAuthn du credential passkey concerné.</figcaption>
</figure>

Le navigateur contrôle le RP ID effectif pour WebAuthn d'origine extension, sauf si un RP ID est fourni par le chemin du portefeuille. Pali étiquette le credential partagé par défaut comme `Pali Wallet Passkey` et utilise le libellé de compte demandé pour l'association de compte visible par l'utilisateur.
