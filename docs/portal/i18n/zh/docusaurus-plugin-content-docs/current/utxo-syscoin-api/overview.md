---
title: UTXO 和 Syscoin API 概览
---

Pali 通过 `window.pali` 暴露 UTXO 和 Syscoin 能力。

当你的应用需要以下能力时，请使用此 provider：

- Syscoin UTXO 账户访问。
- PSBT 签名。
- 交易广播。
- 找零地址。
- 已连接账户 xpub。
- UTXO 交易历史。
- Syscoin Platform Token 资产元数据和持仓。

## 连接

<figure>
  <a className="pali-media-link" href="/img/screens/utxo-connect-popup.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/utxo-connect-popup.png" alt="面向 Syscoin dapp 的 Pali UTXO 连接弹窗" />
</a>
  <figcaption>UTXO dapp 通过 <code>window.pali</code> 连接，而不是 <code>window.ethereum</code>。</figcaption>
</figure>

```js
const [address] = await window.pali.request({
  method: 'sys_requestAccounts',
  params: [],
});
```

## Provider 工具

`window.pali` 包含基于 request 的 RPC 方法，以及用于常见 Syscoin 资产读取的 `_sys` helper 方法。

```js
const xpub = window.pali._sys.getConnectedAccountXpub();
const changeAddress = await window.pali._sys.getChangeAddress();
const holdings = await window.pali._sys.getHoldingsData();
```

## 链家族规则

UTXO 方法要求钱包处于兼容的 UTXO/Syscoin 网络上下文。如果你的应用也支持 EVM，请保持 provider 调用分离，并显式处理模式切换。
