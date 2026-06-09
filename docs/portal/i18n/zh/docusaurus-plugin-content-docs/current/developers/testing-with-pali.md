---
title: 使用 Pali 测试
---

使用 Syscoin 测试 dapp 进行手动集成测试，并使用你自己的自动化测试来验证应用逻辑。

## 托管测试 dapp

Syscoin 测试 dapp 托管在：

```text
https://syscoin-test-dapp.vercel.app/
```

它包含 Pali Passkey 流程、`wallet_prepareSmartAccount`、`wallet_sendCalls`、ERC-20 allowance 批量生成，以及常见钱包请求。

## 本地测试 dapp

如果你需要测试未发布的更改：

```bash
git clone https://github.com/syscoin/test-dapp.git
cd test-dapp
yarn install
yarn start
```

## 本地 Pali 扩展

```bash
git clone https://github.com/syscoin/pali_wallet.git
cd pali_wallet
yarn install
yarn dev:chrome
```

然后通过浏览器扩展开发者页面加载 `build/chrome`。

## Passkey 测试清单

1. 通过默认 provider 选择器连接 Pali。
2. 在禁用 sponsorship 的情况下创建 Passkey 账户，并等待 Pali 确认部署完成。
3. 如果测试需要，为 Passkey 账户充值或部署它。
4. 构建 ERC-20 approve 加 `transferFrom` 批量操作。
5. 使用 `wallet_sendCalls` 发送批量操作。
6. 确认钱包显示解码后的 calldata，并为 Passkey 批量操作显示一次 WebAuthn 批准。
