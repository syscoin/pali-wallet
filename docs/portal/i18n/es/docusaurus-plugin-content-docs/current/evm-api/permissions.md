---
title: Permisos
---

Pali admite permisos de estilo EIP-2255 para dapps EVM.

## Solicitar permisos

```js
const permissions = await window.ethereum.request({
  method: 'wallet_requestPermissions',
  params: [{ eth_accounts: {} }],
});
```

La mayoría de las dapps pueden usar `eth_requestAccounts` en su lugar. Usa `wallet_requestPermissions` cuando quieras objetos de permiso explícitos y metadatos de cadenas permitidas.

## Obtener permisos

```js
const permissions = await window.ethereum.request({
  method: 'wallet_getPermissions',
});
```

## Revocar permisos

```js
await window.ethereum.request({
  method: 'wallet_revokePermissions',
  params: [{ eth_accounts: {} }],
});
```

En Pali, la revocación desconecta la dapp de la billetera. Trátalo como una desconexión completa del sitio en vez de una edición granular parcial de permisos.

## Cambio de cuenta

Para métodos bloqueantes como envío de transacciones y firma, Pali comprueba que la cuenta de dapp conectada coincida con la cuenta solicitada por la dapp. Si la dapp envía una dirección `from` que no es la cuenta conectada activa, Pali puede pedir al usuario que cambie la conexión de la dapp.
