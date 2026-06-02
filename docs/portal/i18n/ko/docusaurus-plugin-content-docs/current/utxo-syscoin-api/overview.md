---
title: UTXO 및 Syscoin API 개요
---

Pali는 `window.pali`를 통해 UTXO 및 Syscoin capability를 노출합니다.

앱에 다음이 필요할 때 이 provider를 사용하세요.

- Syscoin UTXO account access.
- PSBT signing.
- Transaction broadcast.
- Change address.
- Connected account xpub.
- UTXO transaction history.
- Syscoin Platform Token asset metadata 및 holding.

## Connect

<figure>
  <a className="pali-media-link" href="/img/screens/utxo-connect-popup.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/utxo-connect-popup.png" alt="Syscoin dapp을 위한 Pali UTXO connection popup" />
</a>
  <figcaption>UTXO dapp은 <code>window.ethereum</code>이 아니라 <code>window.pali</code>를 통해 연결합니다.</figcaption>
</figure>

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## Provider utility

`window.pali`에는 request-based RPC method와 일반적인 Syscoin asset read를 위한 `_sys` helper method가 포함됩니다.

```js
const xpub = window.pali._sys.getConnectedAccountXpub();
const changeAddress = await window.pali._sys.getChangeAddress();
const holdings = await window.pali._sys.getHoldingsData();
```

## Chain-family rule

UTXO method는 wallet이 compatible UTXO/Syscoin network context에 있어야 합니다. 앱이 EVM도 지원한다면 provider call을 분리하고 mode switching을 명시적으로 처리하세요.
