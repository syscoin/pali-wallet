---
title: 账户和状态
---

UTXO dapp 通常需要不止一个地址。Pali 暴露账户状态、xpub 信息和找零地址，使应用可以构建正确的 PSBT。

## 请求账户访问

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## 获取账户详情

```js
const account = await window.pali.request({
  method: 'sys_getAccount',
});
```

## 获取公钥和派生数据

```js
const publicKey = await window.pali.request({
  method: 'sys_getPublicKey',
});

const currentAddressPubkey = await window.pali.request({
  method: 'sys_getCurrentAddressPubkey',
});

const bip32Path = await window.pali.request({
  method: 'sys_getBip32Path',
});
```

## 找零地址

```js
const changeAddress = await window.pali.request({
  method: 'wallet_getChangeAddress',
});
```

你也可以使用：

```js
const changeAddress = await window.pali._sys.getChangeAddress();
```
