---
title: Eventos
---

Suscríbete a eventos después de seleccionar el proveedor.

## Eventos EIP-1193

| Evento | Proveedor | Significado |
| --- | --- | --- |
| `connect` | `window.ethereum` | Proveedor conectado. |
| `disconnect` | `window.ethereum` | Proveedor desconectado. |
| `accountsChanged` | `window.ethereum` | Lista de cuentas EVM cambiada. |
| `chainChanged` | `window.ethereum` | Cadena EVM cambiada. |
| `message` | `window.ethereum` | Mensaje del proveedor. |

## Notificaciones de billetera Pali

| Evento | Significado |
| --- | --- |
| `pali_accountsChanged` | Cuenta conectada cambiada. |
| `pali_chainChanged` | Cadena activa cambiada. |
| `pali_unlockStateChanged` | Estado de bloqueo de la billetera cambiado. |
| `pali_isBitcoinBased` | Estado de familia UTXO activa cambiado. |
| `pali_xpubChanged` | xpub UTXO conectado cambiado. |
| `pali_blockExplorerChanged` | Explorador de bloques activo cambiado. |
| `walletUpdate` | Notificación de actualización de estado de billetera. |

## Ejemplo

```js
window.ethereum.on('accountsChanged', (accounts) => {
  setAccount(accounts[0] || null);
});

window.ethereum.on('chainChanged', (chainId) => {
  setChainId(chainId);
});
```

Elimina listeners cuando tu componente se desmonte para evitar actualizaciones de estado duplicadas.
