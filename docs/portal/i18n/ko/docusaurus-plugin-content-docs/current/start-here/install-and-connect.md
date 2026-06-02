---
title: 설치 및 연결
---

Pali를 browser extension으로 설치하고 잠금 해제한 뒤 dapp을 여세요. Pali는 provider를 top-level page에 inject하여 애플리케이션이 계정과 작업을 요청할 수 있게 합니다.

## Pali 감지

EVM 통합에는 가능한 경우 EIP-6963을 사용하세요. 여러 extension이 provider를 inject하더라도 사용자와 dapp이 Pali를 다른 지갑과 구분할 수 있습니다.

```js
const providers = [];

window.addEventListener('eip6963:announceProvider', (event) => {
  providers.push(event.detail);
});

window.dispatchEvent(new Event('eip6963:requestProvider'));

const pali = providers.find(({ info }) => {
  const name = info.name.toLowerCase();
  const rdns = info.rdns.toLowerCase();
  return name.includes('pali') || rdns.includes('pali');
});
```

UTXO 및 Syscoin flow의 경우 `window.pali`를 확인하세요.

```js
if (!window.pali) {
  throw new Error('Pali UTXO provider is not available.');
}
```

## EVM 계정 연결

<figure>
  <a className="pali-media-link" href="/img/screens/connect-dapp-popup.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/connect-dapp-popup.png" alt="요청 사이트와 계정 선택을 보여주는 Pali dapp 연결 popup" />
</a>
  <figcaption>Pali는 dapp access를 허용하기 전에 요청 사이트와 계정을 보여줍니다.</figcaption>
</figure>

```js
const [address] = await window.ethereum.request({
  method: 'eth_requestAccounts',
  params: [],
});
```

## UTXO 계정 연결

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## 거절 및 network mismatch 처리

사용자는 연결 요청을 거절할 수 있습니다. 또한 지갑이 EVM mode에 있는 동안 `sys_requestAccounts`를 호출하는 것처럼 active network가 잘못된 chain family인 경우 Pali는 method를 거부할 수 있습니다.

```js
try {
  await window.pali.request({ method: 'sys_requestAccounts', params: [] });
} catch (error) {
  if (error.code === 4001) {
    console.log('The user rejected the request.');
  } else {
    console.error('Pali request failed', error);
  }
}
```

## 로컬 개발 build 로드

<figure>
  <a className="pali-media-link" href="/img/screens/install-unlocked-wallet.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/install-unlocked-wallet.png" alt="깨끗한 브라우저 profile에 설치되고 잠금 해제된 Pali Wallet" />
</a>
  <figcaption>설치 및 잠금 해제 flow를 캡처할 때는 깨끗한 test profile을 사용하세요.</figcaption>
</figure>

wallet repository에서:

```bash
yarn install
yarn dev:chrome
```

그런 다음 `chrome://extensions`를 열고 Developer Mode를 활성화한 뒤 Load unpacked를 선택하고 생성된 `build/chrome` directory를 선택하세요.
