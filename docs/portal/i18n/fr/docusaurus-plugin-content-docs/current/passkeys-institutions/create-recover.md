---
title: Créer et récupérer des comptes intelligents
---

`wallet_prepareSmartAccount` crée un compte intelligent Pali pour l’onboarding depuis une dapp. Pali dérive le compte, le déploie avec la factory configurée, installe le validateur demandé si nécessaire, connecte le compte à la dapp et enregistre localement des métadonnées durables.

## Structure

- **Factory:** calcula direcciones deterministas y despliega cuentas.
- **Cuenta inteligente:** ejecuta calls y consulta validadores instalados.
- **Validadores:** ECDSA, P-256 WebAuthn passkey y composite.
- **Ejecutores:** guardian recovery para recuperación con demora.

## Créer avec passkey

```js
await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [{ label: 'Pali Wallet Passkey', authenticator: { id: 'p256-webauthn' } }],
});
```

## Créer avec ECDSA

```js
await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [{ label: 'Team account', authenticator: { id: 'ecdsa', config: { owners: ['0xOwnerAddress'], threshold: 1 } } }],
});
```

Los owners ECDSA locales se tratan como controlados por la wallet. Los owners externos requieren advertencia y confirmación explícita.

## Récupération

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-recover.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-recover.png" alt="Pali settings screen for recovering smart accounts" />
</a>
  <figcaption>L'écran de récupération aide à restaurer l'accès au compte intelligent en reconstruisant les comptes créés par Pali ou en utilisant la guardian recovery pour remplacer le validateur actif.</figcaption>
</figure>

La recuperación depende de los módulos instalados. Las cuentas deterministas se pueden reconstruir desde el anchor de wallet, chain, índice y factory. Los validadores passkey requieren la credencial WebAuthn relevante. Guardian recovery puede reemplazar el validador activo después de la demora configurada.

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-assert.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-assert.png" alt="Browser or operating system passkey assertion prompt" />
</a>
  <figcaption>La récupération et l'exécution nécessitent une assertion WebAuthn de la credential passkey concernée.</figcaption>
</figure>
