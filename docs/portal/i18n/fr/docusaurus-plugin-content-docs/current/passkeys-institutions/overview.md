---
title: Passkeys et institutions
---

Les comptes intelligents passkey de Pali permettent à une dapp de demander la création ou la récupération de compte depuis le portefeuille pendant que l'utilisateur contrôle l'exécution via WebAuthn.

C'est utile pour :

- intégration institutionnelle
- flux de gaz adossés à un sponsor
- politiques coautorisées
- récupération de compte après réinstallation du portefeuille
- workflows atomiques multi-appels
- dapps qui veulent une UX passkey sans construire un portefeuille

## Pourquoi les passkeys zkSYS sont possibles

Les passkeys utilisent WebAuthn, et l'algorithme de signature standard de WebAuthn est ES256 : ECDSA sur la courbe P-256, aussi connue sous le nom secp256r1. Les portefeuilles EVM génériques utilisent normalement des EOAs secp256k1 ; une signature passkey n'est donc pas directement une signature EOA.

Les comptes passkey de Pali sont des comptes intelligents zkSYS conçus autour de la vérification P-256 on-chain. Le portefeuille extrait les coordonnées de clé publique WebAuthn, le challenge, les données de l'authenticator, les données client et la signature P-256, puis le chemin de compte intelligent/factory vérifie cette preuve par rapport aux métadonnées enregistrées du compte. C'est ce qui rend les données biométriques d'appareil ou les passkeys de plateforme utilisables pour l'autorisation de compte tout en gardant la clé privée dans l'authenticator de l'utilisateur.

Le résultat pratique est une UX de portefeuille qui ressemble à une connexion biométrique, mais autorise une action de chaîne :

1. La dapp demande un compte intelligent passkey ou une exécution groupée.
2. Pali prépare un hachage d'action pour la chaîne, le compte, les appels, le nonce, la deadline et la politique de sponsor exacts.
3. Le navigateur/OS demande à l'utilisateur l'approbation passkey.
4. Le compte intelligent zkSYS vérifie la preuve P-256 WebAuthn on-chain avant d'exécuter.

## Réseaux pris en charge

Les comptes passkey ne sont pas activés sur toutes les chaînes EVM. Ils exigent une factory passkey configurée et la prise en charge de la vérification P-256 zkSYS.

| Réseau | Chain id | État dans cette version de Pali |
| --- | --- | --- |
| `zkTanenbaum` | `57057` | Configuré. Factory : `0x2753d01E741D1E9E54956203766f5F501819cad3`. |
| `zkSYS` | TBD in wallet config | Cible de production prévue pour la même architecture passkey une fois que l'adresse de factory est configurée dans Pali. |

Si une dapp appelle `wallet_createPasskeyAccount` sur un réseau sans factory configurée, Pali rejette la requête au lieu de créer des métadonnées non prises en charge.

## Méthode de dapp

<figure>
  <a className="pali-media-link" href="/img/screens/passkey-create-disabled.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/passkey-create-disabled.png" alt="Popup Pali wallet_createPasskeyAccount avec sponsoring désactivé" />
</a>
  <figcaption>Le flux passkey par défaut piloté par dapp doit commencer avec le sponsoring désactivé sauf si l'institution a explicitement besoin d'une politique de sponsor.</figcaption>
</figure>

```js
const account = await window.ethereum.request({
  method: 'wallet_createPasskeyAccount',
  params: [
    {
      label: 'Pali Wallet Passkey',
      sponsor: { mode: 'disabled' },
    },
  ],
});
```

Le résultat inclut l'`address` du compte intelligent et les métadonnées passkey publiques.

## Modes de sponsor

| Mode | Signification |
| --- | --- |
| `disabled` | Aucune politique de sponsor. Le portefeuille/l'utilisateur paie le gaz. |
| `gasOnly` | Le service de sponsor peut payer le gaz. Pali exige une URL de sponsor pour ce mode ; si le sponsoring échoue, un repli vers le gaz du portefeuille peut être autorisé. |
| `required` | Une coautorisation du sponsor est requise par la politique. Un signataire est requis ; l'URL de sponsor est facultative lorsque Pali peut obtenir la preuve du signataire depuis un compte local dans le portefeuille. |

## Contrôle utilisateur

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-create.png" alt="Feuille de création de passkey du navigateur ou du système d'exploitation" />
</a>
  <figcaption>Après la vérification par le portefeuille, le navigateur ou le système d'exploitation gère la création de passkey WebAuthn.</figcaption>
</figure>

L'utilisateur voit le site demandeur, le libellé, le mode sponsor, le signataire, l'URL et le texte de politique avant d'approuver. Le navigateur ou l'OS affiche ensuite l'invite passkey WebAuthn.

<figure className="pali-video-card">
  <video controls poster="/img/screens/passkey-dapp-onboarding-video.png" src="/video/passkey-dapp-onboarding.mp4" title="Flux d'intégration de dapp passkey"></video>
  <figcaption>Flux d'intégration passkey : introduction de marque, demande de dapp et approbation du compte Pali.</figcaption>
</figure>
