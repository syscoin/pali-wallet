---
title: wallet_sendCalls
---

Pali 为 EVM 批量请求支持 EIP-5792 风格的 `wallet_sendCalls`。受支持的 Pali 智能账户可以将多个调用授权为一次账户执行。

## 检查能力

```js
const capabilities = await window.ethereum.request({
  method: 'wallet_getCapabilities',
  params: [account],
});
```

Pali 对受支持的 Pali 智能账户报告原子支持，对普通 EOA 报告不支持原子执行。

## 发送批量操作

```js
const result = await window.ethereum.request({
  method: 'wallet_sendCalls',
  params: [
    {
      version: '2.0.0',
      from: smartAccount,
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

## 智能账户行为

用户批准或拒绝整个请求批次，无法取消单个调用。对于 Pali 智能账户，Pali 将完整批次准备为一次账户执行，请求活动验证器授权，依据钱包阻止名单检查目标，并提交一笔交易。Passkey 验证器使用 WebAuthn assertion；已配置的本地 ECDSA 所有者签署操作哈希。

## EOA 行为

对于普通 EVM 账户，Pali 展示整个批次供用户批准或拒绝，并按顺序发送调用。这不是链上原子执行。若 dapp 需要原子执行，请使用受支持的 Pali 智能账户或专为原子批处理设计的合约。

## 状态方法

`wallet_getCallsStatus` 和 `wallet_showCallsStatus` 按 EIP-5792 实现。`wallet_getCallsStatus` 返回带链上 receipts 的标准状态对象（`100` 待处理、`200` 已确认、`500` 已回滚、`600` 部分回滚）；`wallet_showCallsStatus` 打开一个只读的 Pali 弹窗显示相同信息。`wallet_sendCalls` 中 dapp 提供的 `id` 会被遵循并原样返回。未知的 bundle id 以错误 `5730` 失败；dapp 提供的重复 id 以 `5720` 失败。
