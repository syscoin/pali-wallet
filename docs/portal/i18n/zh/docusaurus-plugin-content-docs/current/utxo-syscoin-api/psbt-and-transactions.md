---
title: PSBT 和交易
---

UTXO 应用应谨慎构造交易，通过 Pali 请求签名，并仅在用户批准后广播。

## 签署 PSBT

<figure>
  <div className="pali-capture-card">
    <div className="pali-capture-card__copy">
      <div className="pali-capture-card__brand">
        <img className="pali-capture-card__icon" src="/img/logo.svg" alt="" aria-hidden="true" />
        <span>Pali Wallet</span>
      </div>
      <p className="pali-capture-card__chip">UTXO • Syscoin</p>
      <p className="pali-capture-card__title">PSBT 签名审核</p>
      <p className="pali-capture-card__subtitle">UTXO 签名确认</p>
      <p className="pali-capture-card__hint">在预览内滚动，检查输出、输入、大小、权重和锁定时间。</p>
    </div>
    <div className="pali-capture-card__scroll">
      <img src="/img/screens/psbt-sign-review.png" alt="Pali PSBT 签名审核页面" />
    </div>
  </div>
  <figcaption>Pali 会在签署 UTXO PSBT 之前提示用户确认。</figcaption>
</figure>

```js
const signed = await window.pali.request({
  method: 'sys_sign',
  params: [psbtBase64],
});
```

## 签名并发送

```js
const txid = await window.pali.request({
  method: 'sys_signAndSend',
  params: [psbtBase64],
});
```

## 获取交易

```js
const transactions = await window.pali.request({
  method: 'sys_getTransactions',
});

const tx = await window.pali.request({
  method: 'sys_transaction',
  params: [txid],
});
```

## 验证地址

```js
const valid = await window.pali.request({
  method: 'sys_isValidSYSAddress',
  params: [address],
});
```

## dapp 的责任

Pali 对用户批准的内容进行签名。请求签名之前，你的应用有责任合理构造 PSBT 的输入、输出、手续费、找零和资产元数据。

## 账户选择

签名绑定到请求 dapp 所连接的账户和获批网络。PSBT 元数据不能选择另一个钱包账户。如果 Pali 当前显示的是其他账户，可以在批准前要求用户切换到已连接的账户。若要使用另一个账户，请更改 dapp 连接并请求新的批准。

如果 PSBT 包含尚未完成的输入，其中至少一个尚未完成的输入必须属于该获批账户。Pali 只为该账户的输入签名。因此，共享交易和多重签名交易可能返回部分签名的结果；其他参与者必须完成各自的输入或签名。已有的外部签名和受支持的已最终化输入会被保留。完全最终化的 PSBT 可以在不添加签名的情况下返回。硬件钱包的支持仍取决于设备和交易格式。

账户或网络变更会使待处理的签名上下文失效。请重新构建或检查请求，并取得新的批准，而不是重放旧请求。
