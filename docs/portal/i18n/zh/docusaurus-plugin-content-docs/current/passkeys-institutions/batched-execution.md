---
title: 批量执行
---

Passkey 智能账户通过 `wallet_sendCalls` 支持批量执行。这让用户可以通过一次钱包审核和一次 WebAuthn assertion 批准多个调用。

<figure>
  <a className="pali-media-link" href="/img/screens/send-calls-passkey-batch.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/send-calls-passkey-batch.png" alt="带有已解码 calldata 的 Pali wallet_sendCalls Passkey 批量审核" />
</a>
  <figcaption>Pali 会审核完整 Passkey 批量操作，并在一次 WebAuthn 批准前解码常见 token 调用。</figcaption>
</figure>

## 示例：approve 和 transferFrom

```js
const result = await window.ethereum.request({
  method: 'wallet_sendCalls',
  params: [
    {
      version: '2.0.0',
      from: passkeyAccount,
      chainId: '0x39',
      atomicRequired: true,
      calls: [
        {
          to: erc20Token,
          value: '0x0',
          data: erc20Interface.encodeFunctionData('approve', [
            spender,
            amount,
          ]),
        },
        {
          to: spender,
          value: '0x0',
          data: spenderInterface.encodeFunctionData('transferFrom', [
            passkeyAccount,
            recipient,
            amount,
          ]),
        },
      ],
    },
  ],
});
```

## Atomic UX

当 `atomicRequired` 为 true 时，用户应批准或拒绝完整批量操作。Pali 的 Passkey 路径会将所有选定调用准备为一次智能账户执行。当业务逻辑需要全有或全无行为时，dapp 不应要求用户批准部分批量操作。

## Sponsor proof 能力

对于 sponsored Passkey execution，dapp 可以在适用时通过 capabilities 传递批量级别的 sponsor proof。Pali 也支持通过已存储账户 sponsor 元数据解析 sponsor service。

## 不支持的调用类型

Passkey `wallet_sendCalls` 不支持表示为空目标交易的合约部署调用。请单独部署合约，或使用目标合约调用。

<figure className="pali-video-card">
  <video controls poster="/img/screens/passkey-batch-sendcalls-video.png" src="/video/passkey-batch-sendcalls.mp4" title="Passkey wallet_sendCalls 批量流程"></video>
  <figcaption>Passkey 批量执行流程：品牌介绍、已解码调用、一次 Passkey 批准、交易结果。</figcaption>
</figure>
