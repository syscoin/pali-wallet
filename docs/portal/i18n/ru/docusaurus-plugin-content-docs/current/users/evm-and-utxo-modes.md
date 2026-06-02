---
title: EVM и UTXO режимы
---

Pali поддерживает account-based EVM сети и UTXO-based сети. Расширение использует отдельные поверхности провайдера, потому что модели аккаунтов принципиально различаются.

## Режим EVM

EVM mode предназначен для dapps, использующих `window.ethereum`. Он поддерживает account requests в стиле MetaMask, транзакции, подписи, разрешения, запросы на отслеживание токенов и управление сетями.

Примеры:

- Rollux и Syscoin NEVM dapps
- взаимодействия ERC-20, ERC-721 и ERC-1155
- подписание EIP-712 typed data
- создание и выполнение passkey smart account

## Режим UTXO

UTXO mode предназначен для dapps, использующих `window.pali`. Он поддерживает состояние Syscoin UTXO аккаунта, интеграции с учетом xpub, подписание PSBT, broadcast транзакций и SPT asset flows.

Примеры:

- приложения Syscoin UTXO активов
- Bitcoin-like PSBT workflows
- dapps, которым нужен change address
- dapps, читающие историю UTXO транзакций

## Переключение режимов

Если dapp запрашивает метод для неправильного семейства цепей, Pali может потребовать переключение сети. Dapps должны корректно обрабатывать эти ошибки и направлять пользователей к правильной сети.

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

Переключение между UTXO и EVM контекстами может требовать повторного подключения dapp, потому что меняется семейство активного аккаунта.
