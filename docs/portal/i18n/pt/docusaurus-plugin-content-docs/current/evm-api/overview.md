---
title: Visão geral da API EVM
---

O provider EVM da Pali é exposto por meio de `window.ethereum` e é compatível com integrações de dapp padrão no estilo MetaMask.

## Métodos comuns

| Área | Métodos |
| --- | --- |
| Conectar | `eth_requestAccounts`, `eth_accounts` |
| Rede | `eth_chainId`, `net_version`, `wallet_switchEthereumChain`, `wallet_addEthereumChain` |
| Transações | `eth_sendTransaction`, `eth_sendRawTransaction`, `eth_estimateGas`, `eth_call` |
| Assinatura | `personal_sign`, `eth_sign`, `eth_signTypedData`, `eth_signTypedData_v3`, `eth_signTypedData_v4` |
| Permissões | `wallet_requestPermissions`, `wallet_getPermissions`, `wallet_revokePermissions` |
| Ativos | `wallet_watchAsset` |
| Lotes | `wallet_sendCalls`, `wallet_getCapabilities` |
| Passkeys | `wallet_createPasskeyAccount` |

## Formato de solicitação do provider

```js
const result = await window.ethereum.request({
  method: 'eth_chainId',
  params: [],
});
```

## Proxy de RPC somente leitura

A Pali encaminha muitos métodos Ethereum JSON-RPC somente leitura para o provider RPC ativo, incluindo consultas de bloco, transação, recibo, log, taxa, saldo, código, storage e proof.

## Subscriptions sem suporte

`eth_subscribe` e `eth_unsubscribe` não são compatíveis com o provider dentro da carteira. Use seu próprio provider RPC WebSocket para estado de aplicação com uso intenso de subscriptions.
