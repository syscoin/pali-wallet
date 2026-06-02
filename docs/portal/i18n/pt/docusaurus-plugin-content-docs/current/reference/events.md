---
title: Eventos
---

Assine eventos depois de selecionar o provider.

## Eventos EIP-1193

| Evento | Provider | Significado |
| --- | --- | --- |
| `connect` | `window.ethereum` | Provider conectado. |
| `disconnect` | `window.ethereum` | Provider desconectado. |
| `accountsChanged` | `window.ethereum` | Lista de contas EVM mudou. |
| `chainChanged` | `window.ethereum` | Chain EVM mudou. |
| `message` | `window.ethereum` | Mensagem do provider. |

## Notificações da carteira Pali

| Evento | Significado |
| --- | --- |
| `pali_accountsChanged` | Conta conectada mudou. |
| `pali_chainChanged` | Chain ativa mudou. |
| `pali_unlockStateChanged` | Estado de bloqueio da carteira mudou. |
| `pali_isBitcoinBased` | Estado da família UTXO ativa mudou. |
| `pali_xpubChanged` | xpub UTXO conectado mudou. |
| `pali_blockExplorerChanged` | Block explorer ativo mudou. |
| `walletUpdate` | Notificação de atualização de estado da carteira. |

## Exemplo

```js
window.ethereum.on('accountsChanged', (accounts) => {
  setAccount(accounts[0] || null);
});

window.ethereum.on('chainChanged', (chainId) => {
  setChainId(chainId);
});
```

Remova listeners quando seu componente for desmontado para evitar atualizações de estado duplicadas.
