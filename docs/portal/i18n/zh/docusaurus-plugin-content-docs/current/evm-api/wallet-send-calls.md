---
title: wallet_sendCalls
---

Pali 为 EVM 批量请求支持 EIP-5792 风格的 `wallet_sendCalls`。这对 Passkey 智能账户尤其重要，因为多个调用可以通过一次 WebAuthn assertion 授权。

## 检查能力

```js
const capabilities = await window.ethereum.request({
  method: 'wallet_getCapabilities',
  params: [account],
});
```

Pali 会为 Passkey 智能账户报告 atomic 支持，并为普通 EOA 报告不支持 atomic execution。

## 发送批量操作

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
          to: tokenAddress,
          value: '0x0',
          data: approveCalldata,
        },
        {
          to: spenderAddress,
          value: '0x0',
          data: transferFromCalldata,
        },
      ],
    },
  ],
});
```

## Passkey 行为

对于 Passkey 智能账户，Pali 会将所有选定调用准备为一个智能账户执行批量操作，请求一次 Passkey assertion，并提交一笔交易。如果账户尚未部署，部署和可选的初始策略执行可以成为首次交易路径的一部分。

## EOA 行为

对于普通 EVM 账户，Pali 会展示这些调用，并按顺序发送选定调用。这与链上原子性不同。如果 dapp 需要真正的 atomic execution，请使用 Passkey 智能账户或专门设计用于原子批量调用的合约。

## 状态方法

`wallet_getCallsStatus` 和 `wallet_showCallsStatus` 按 EIP-5792 实现。`wallet_getCallsStatus` 返回带链上 receipts 的标准状态对象（`100` 待处理、`200` 已确认、`500` 已回滚、`600` 部分回滚）；`wallet_showCallsStatus` 打开一个只读的 Pali 弹窗显示相同信息。`wallet_sendCalls` 中 dapp 提供的 `id` 会被遵循并原样返回。未知的 bundle id 以错误 `5730` 失败；dapp 提供的重复 id 以 `5720` 失败。
