---
title: Crear y recuperar cuentas inteligentes
---

`wallet_prepareSmartAccount` crea una cuenta inteligente de Pali para onboarding desde una dapp. Pali deriva la cuenta, la despliega con la factory configurada, instala el validador solicitado cuando hace falta, conecta la cuenta a la dapp y guarda metadatos duraderos localmente.

## Estructura

- **Factory:** calcula direcciones deterministas y despliega cuentas.
- **Cuenta inteligente:** ejecuta calls y consulta validadores instalados.
- **Validadores:** ECDSA, P-256 WebAuthn passkey y composite.
- **Ejecutores:** guardian recovery para recuperación con demora.

## Crear con passkey

```js
await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [{ label: 'Pali Wallet Passkey', authenticator: { id: 'p256-webauthn' } }],
});
```

## Crear con ECDSA

```js
await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [{ label: 'Team account', authenticator: { id: 'ecdsa', config: { owners: ['0xOwnerAddress'], threshold: 1 } } }],
});
```

Los owners ECDSA locales se tratan como controlados por la wallet. Los owners externos requieren advertencia y confirmación explícita.

## Recuperación

La recuperación depende de los módulos instalados. Las cuentas deterministas se pueden reconstruir desde el anchor de wallet, chain, índice y factory. Los validadores passkey requieren la credencial WebAuthn relevante. Guardian recovery puede reemplazar el validador activo después de la demora configurada.
