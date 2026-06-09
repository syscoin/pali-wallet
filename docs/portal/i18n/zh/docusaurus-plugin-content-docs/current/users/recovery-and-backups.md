---
title: 恢复与备份
---

备份很重要，因为 Pali 是非托管钱包。钱包无法为你恢复 seed phrase、密码、私钥或 Passkey authenticator secret。

## Seed phrase 备份

写下你的钱包 seed phrase，并将其离线保存。任何拥有 seed phrase 的人都可以控制派生账户。

## Passkey 备份状态

Passkey 可以绑定到设备，也可以由平台账户 provider 同步。Pali 会在可用时展示与备份相关的状态，但具体行为取决于 authenticator、浏览器和操作系统。

你可能会看到提示 Passkey 是绑定设备、可备份，还是已备份/同步的状态。同步的 Passkey 通常更方便，因为它可以通过 Apple、Google 或 Microsoft 等平台账户跟随你。绑定设备的 Passkey 或硬件安全密钥可以更严格，但丢失该设备可能会使恢复更困难。

| 你可能看到的状态 | 含义 | 便利性 | 安全权衡 | 适合场景 |
| --- | --- | --- | --- | --- |
| 已备份或已同步 | Passkey 看起来由平台 Passkey provider 存储，并可能同步到其他受信设备。 | 最高。更换手机或笔记本后，通常可以通过重新登录平台账户来恢复。 | Passkey secret 仍由平台 Passkey 系统保护，但安全边界包括平台账户、账户恢复流程和同步设备。 | 日常钱包、dapp 账户、机构引导流程和较小余额。 |
| 可备份 | Authenticator 表示 Passkey 可以备份或同步，但当前可能尚未同步。 | 中到高，取决于是否启用了同步。 | 未来平台设置可能会将凭证移入云同步。如果这对你很重要，请检查 provider 和设备设置。 | 希望具有恢复灵活性、但仍希望检查同步是否启用的用户。 |
| 绑定设备或未备份 | Passkey 看起来绑定到一个 authenticator 或设备。 | 较低。如果设备丢失且不存在其他恢复路径，恢复可能更困难或不可能。 | 隔离性更强，因为控制权集中在该 authenticator，而不是云同步账户。 | 较大余额、高安全账户、硬件安全密钥和冷钱包风格使用。 |
| 未知或不可用 | 浏览器、OS 或 authenticator 没有暴露足够的备份信息。 | 未知。 | 不要假设它具备云恢复或绑定设备隔离。在验证 authenticator 设置之前，将其视为模糊状态。 | 临时使用、测试，或你可以独立验证 Passkey provider 的场景。 |

云同步 Passkey 对正常使用仍然安全：私钥不会交给 Pali 或 dapp，WebAuthn 仍然绑定 origin，用户验证仍由平台 authenticator 执行。权衡在于，平台账户会成为你的钱包安全模型的一部分。对于冷存储、treasury 资金或大额长期余额，优先选择绑定设备的 authenticator 或硬件安全密钥，并只在同步 Passkey 账户中保留较小的运营资金。

备份状态是帮助你在便利性和安全性之间做选择的信号。它不能替代你的 seed phrase 备份，也不意味着 Pali 或机构能够为你恢复 Passkey secret。

## 恢复 Passkey 账户

Pali Passkey 恢复使用钱包范围内的恢复元数据和链上账户发现。恢复流程：

1. 请求一个可发现的 WebAuthn assertion。
2. 从 factory registry 和创建日志中查找匹配的智能账户。
3. 跳过已在钱包中的账户。
4. 当 sponsor 元数据可以解析时，添加可恢复账户。
5. 如果 required smart-account module policy 需要 sponsor URL 元数据，则发出警告。

## dapp 创建/恢复的幂等性

当 dapp 调用 `wallet_prepareSmartAccount` 时，Pali 会先检查是否存在与请求的 模块策略匹配的现有链上 Passkey 账户。如果匹配账户已在本地存在，Pali 会复用它，而不是创建重复账户。如果它存在于链上但不在本地，Pali 可以将其恢复到钱包中。
