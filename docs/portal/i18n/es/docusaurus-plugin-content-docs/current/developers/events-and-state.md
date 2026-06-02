---
title: Eventos y estado del proveedor
---

Escucha eventos del proveedor para que tu app permanezca sincronizada cuando el usuario cambia cuenta, red, estado de bloqueo o estado UTXO.

## Eventos EVM

```js
window.ethereum.on('accountsChanged', (accounts) => {
  console.log('EVM accounts', accounts);
});

window.ethereum.on('chainChanged', (chainId) => {
  console.log('EVM chain', chainId);
});

window.ethereum.on('disconnect', (error) => {
  console.warn('Provider disconnected', error);
});
```

## Eventos personalizados de Pali

Pali también emite notificaciones personalizadas de billetera usadas por el proveedor de la extensión.

| Evento | Significado |
| --- | --- |
| `pali_accountsChanged` | La cuenta conectada cambió. |
| `pali_chainChanged` | La cadena activa cambió. |
| `pali_unlockStateChanged` | El estado de bloqueo de la billetera cambió. |
| `pali_isBitcoinBased` | La familia UTXO activa cambió. |
| `pali_xpubChanged` | El xpub UTXO conectado cambió. |
| `pali_blockExplorerChanged` | El explorador UTXO activo cambió. |

## Métodos de estado del proveedor

```js
const evmState = await window.ethereum.request({
  method: 'wallet_getProviderState',
});

const sysState = await window.pali.request({
  method: 'wallet_getSysProviderState',
});
```

El estado del proveedor es útil para la inicialización, pero no lo trates como sustituto de comprobaciones explícitas de permisos de cuenta.
