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

La recuperación depende de los módulos instalados. Las cuentas deterministas se pueden reconstruir desde el anchor de wallet, chain, índice y factory. Los validadores passkey requieren la credencial WebAuthn relevante. Guardian recovery puede reemplazar el validador activo después de la demora configurada.
