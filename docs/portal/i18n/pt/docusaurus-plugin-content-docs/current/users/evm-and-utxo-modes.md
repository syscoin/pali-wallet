---
title: Modos EVM e UTXO
---

A Pali oferece suporte a redes EVM baseadas em contas e redes baseadas em UTXO. A extensão usa superfícies de provider separadas porque os modelos de conta são fundamentalmente diferentes.

## Modo EVM

O modo EVM é para dapps que usam `window.ethereum`. Ele oferece suporte a solicitações de conta no estilo MetaMask, transações, assinaturas, permissões, solicitações de observação de token e gerenciamento de rede.

Exemplos:

- dapps Rollux e Syscoin NEVM
- interações ERC-20, ERC-721 e ERC-1155
- assinatura de dados tipados EIP-712
- criação e execução de smart account com passkey

## Modo UTXO

O modo UTXO é para dapps que usam `window.pali`. Ele oferece suporte a estado de conta Syscoin UTXO, integrações cientes de xpub, assinatura PSBT, broadcast de transação e fluxos de ativos SPT.

Exemplos:

- aplicações de ativos Syscoin UTXO
- workflows PSBT semelhantes ao Bitcoin
- dapps que precisam de um endereço de troco
- dapps que leem histórico de transações UTXO

## Trocar modos

Se uma dapp solicita um método para a família de chain errada, a Pali pode exigir uma troca de rede. Dapps devem tratar esses erros de forma limpa e orientar usuários para a rede correta.

```js
await window.ethereum.request({
  method: 'eth_changeUTXOEVM',
  params: [{ chainId: 57 }],
});

await window.pali.request({
  method: 'sys_changeUTXOEVM',
  params: [{ chainId: 57 }],
});
```

Alternar entre contextos UTXO e EVM pode exigir reconectar a dapp porque a família da conta ativa muda.
