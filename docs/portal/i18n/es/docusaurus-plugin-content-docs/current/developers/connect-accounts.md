---
title: Conectar cuentas
---

Las solicitudes de conexión de Pali son aprobaciones explícitas del usuario. Las dapps deben solicitar acceso solo cuando el usuario hace clic en un botón de conexión.

## Conexión EVM

```js
const provider = await getPaliEthereumProvider();

const [address] = await provider.request({
  method: 'eth_requestAccounts',
  params: [],
});
```

## Conexión UTXO

```js
const provider = window.pali;

const [address] = await provider.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## Leer estado de conexión

```js
const isEvmConnected = await window.ethereum.request({
  method: 'wallet_isConnected',
});

const account = await window.ethereum.request({
  method: 'wallet_getAccount',
});
```

## Una cuenta activa por dapp

Pali puede mantener muchos orígenes de dapp conectados. Para un solo origen, Pali rastrea una cuenta conectada activa. Si una solicitud sensible referencia una dirección `from` distinta, Pali puede pedir al usuario que cambie la conexión de la dapp.

## Desconectar

Para permisos EVM, `wallet_revokePermissions` desconecta la dapp de Pali.

```js
await window.ethereum.request({
  method: 'wallet_revokePermissions',
  params: [{ eth_accounts: {} }],
});
```
