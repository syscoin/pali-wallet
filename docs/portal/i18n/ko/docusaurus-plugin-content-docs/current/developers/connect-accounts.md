---
title: 계정 연결
---

Pali connection request는 명시적인 user approval입니다. dapp은 사용자가 connect button을 클릭할 때만 access를 요청해야 합니다.

## EVM connect

```js
const provider = await getPaliEthereumProvider();

const [address] = await provider.request({
  method: 'eth_requestAccounts',
  params: [],
});
```

## UTXO connect

```js
const provider = window.pali;

const [address] = await provider.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## Connection state 읽기

```js
const isEvmConnected = await window.ethereum.request({
  method: 'wallet_isConnected',
});

const account = await window.ethereum.request({
  method: 'wallet_getAccount',
});
```

## dapp당 하나의 active account

Pali는 여러 dapp origin을 연결 상태로 유지할 수 있습니다. 단일 origin에 대해 Pali는 하나의 active connected account를 추적합니다. 민감한 요청이 다른 `from` address를 참조하면 Pali가 사용자에게 dapp connection 전환을 요청할 수 있습니다.

## 연결 해제

EVM permission의 경우 `wallet_revokePermissions`는 dapp을 Pali에서 disconnect합니다.

```js
await window.ethereum.request({
  method: 'wallet_revokePermissions',
  params: [{ eth_accounts: {} }],
});
```
