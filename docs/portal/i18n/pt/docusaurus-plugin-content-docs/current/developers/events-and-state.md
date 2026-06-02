---
title: Eventos e estado do provider
---

Ouça eventos do provider para que sua aplicação permaneça sincronizada quando o usuário muda conta, rede, estado de bloqueio ou estado UTXO.

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

## Eventos personalizados da Pali

A Pali também emite notificações personalizadas da carteira usadas pelo provider da extensão.

| Evento | Significado |
| --- | --- |
| `pali_accountsChanged` | A conta conectada mudou. |
| `pali_chainChanged` | A chain ativa mudou. |
| `pali_unlockStateChanged` | O estado de bloqueio da carteira mudou. |
| `pali_isBitcoinBased` | A família UTXO ativa mudou. |
| `pali_xpubChanged` | O xpub UTXO conectado mudou. |
| `pali_blockExplorerChanged` | O explorer UTXO ativo mudou. |

## Métodos de estado do provider

```js
const evmState = await window.ethereum.request({
  method: 'wallet_getProviderState',
});

const sysState = await window.pali.request({
  method: 'wallet_getSysProviderState',
});
```

O estado do provider é útil para inicialização, mas não o trate como substituto para verificações explícitas de permissão de conta.
