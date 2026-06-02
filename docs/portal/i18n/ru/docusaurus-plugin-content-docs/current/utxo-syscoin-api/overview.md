---
title: Обзор UTXO и Syscoin API
---

Pali предоставляет UTXO и Syscoin возможности через `window.pali`.

Используйте этот провайдер, когда вашему приложению нужны:

- доступ к Syscoin UTXO аккаунту.
- подписание PSBT.
- broadcast транзакций.
- change addresses.
- xpub подключенного аккаунта.
- история UTXO транзакций.
- Syscoin Platform Token asset metadata и holdings.

## Подключение

<figure>
  <a className="pali-media-link" href="/img/screens/utxo-connect-popup.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/utxo-connect-popup.png" alt="Popup подключения Pali UTXO для Syscoin dapp" />
</a>
  <figcaption>UTXO dapps подключаются через <code>window.pali</code>, а не <code>window.ethereum</code>.</figcaption>
</figure>

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## Утилиты провайдера

`window.pali` включает request-based RPC methods и `_sys` helper methods для распространенных чтений Syscoin assets.

```js
const xpub = window.pali._sys.getConnectedAccountXpub();
const changeAddress = await window.pali._sys.getChangeAddress();
const holdings = await window.pali._sys.getHoldingsData();
```

## Правила chain-family

UTXO methods требуют, чтобы кошелек был в совместимом UTXO/Syscoin network context. Если ваше приложение также поддерживает EVM, держите provider calls разделенными и обрабатывайте mode switching явно.
