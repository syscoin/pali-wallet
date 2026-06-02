---
title: Conectar contas
---

Solicitações de conexão da Pali são aprovações explícitas do usuário. Dapps devem solicitar acesso apenas quando o usuário clica em um botão de conexão.

## Conexão EVM

```js
const provider = await getPaliEthereumProvider();

const [address] = await provider.request({
  method: 'eth_requestAccounts',
  params: [],
});
```

## Conexão UTXO

```js
const provider = window.pali;

const [address] = await provider.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## Ler estado de conexão

```js
const isEvmConnected = await window.ethereum.request({
  method: 'wallet_isConnected',
});

const account = await window.ethereum.request({
  method: 'wallet_getAccount',
});
```

## Uma conta ativa por dapp

A Pali pode manter muitas origens de dapp conectadas. Para uma única origem, a Pali rastreia uma conta conectada ativa. Se uma solicitação sensível referencia um endereço `from` diferente, a Pali pode pedir que o usuário troque a conexão da dapp.

## Desconectar

Para permissões EVM, `wallet_revokePermissions` desconecta a dapp da Pali.

```js
await window.ethereum.request({
  method: 'wallet_revokePermissions',
  params: [{ eth_accounts: {} }],
});
```
