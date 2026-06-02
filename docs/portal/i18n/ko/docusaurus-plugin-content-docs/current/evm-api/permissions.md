---
title: 권한
---

Pali는 EVM dapp을 위한 EIP-2255-style permission을 지원합니다.

## Permission 요청

```js
const permissions = await window.ethereum.request({
  method: 'wallet_requestPermissions',
  params: [{ eth_accounts: {} }],
});
```

대부분의 dapp은 대신 `eth_requestAccounts`를 사용할 수 있습니다. 명시적인 permission object와 permitted-chain metadata가 필요할 때 `wallet_requestPermissions`를 사용하세요.

## Permission 가져오기

```js
const permissions = await window.ethereum.request({
  method: 'wallet_getPermissions',
});
```

## Permission revoke

```js
await window.ethereum.request({
  method: 'wallet_revokePermissions',
  params: [{ eth_accounts: {} }],
});
```

Pali에서 revocation은 dapp을 wallet에서 disconnect합니다. 이를 granular partial permission editing이 아니라 전체 site disconnect로 취급하세요.

## Account switching

transaction sending 및 signing 같은 blocking method의 경우, Pali는 connected dapp account가 dapp이 요청한 account와 일치하는지 확인합니다. dapp이 active connected account가 아닌 `from` address를 보내면 Pali가 사용자에게 dapp connection 전환을 prompt할 수 있습니다.
