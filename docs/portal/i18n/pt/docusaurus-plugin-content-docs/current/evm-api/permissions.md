---
title: Permissões
---

A Pali oferece suporte a permissões no estilo EIP-2255 para dapps EVM.

## Solicitar permissões

```js
const permissions = await window.ethereum.request({
  method: 'wallet_requestPermissions',
  params: [{ eth_accounts: {} }],
});
```

A maioria das dapps pode usar `eth_requestAccounts` em vez disso. Use `wallet_requestPermissions` quando você quiser objetos de permissão explícitos e metadados de chains permitidas.

## Obter permissões

```js
const permissions = await window.ethereum.request({
  method: 'wallet_getPermissions',
});
```

## Revogar permissões

```js
await window.ethereum.request({
  method: 'wallet_revokePermissions',
  params: [{ eth_accounts: {} }],
});
```

Na Pali, a revogação desconecta a dapp da carteira. Trate isso como uma desconexão completa do site, em vez de edição granular parcial de permissões.

## Troca de conta

Para métodos bloqueantes como envio de transação e assinatura, a Pali verifica se a conta conectada da dapp corresponde à conta solicitada pela dapp. Se a dapp envia um endereço `from` que não é a conta conectada ativa, a Pali pode solicitar que o usuário troque a conexão da dapp.
