---
title: 代币发现与区块浏览器 API
---

Pali 可以通过区块浏览器 API 查找可供导入的代币和 NFT。您也可以通过合约地址添加资产。已导入代币的余额通过网络的 RPC 读取，因此自动发现功能并非必需。

## 默认支持情况

| 网络          | 自动发现                                                                                      | 如果找不到资产                                               |
| ------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Ethereum 主网 | 使用 Routescan，无需账户或 API 密钥。支持 ERC-20 代币以及受支持的 ERC-721/ERC-1155 持有资产。 | 使用**导入代币 → 添加自定义**。                              |
| Base          | 未配置默认发现 API。网络及其 RPC 仍然可用。                                                   | 通过合约地址添加资产，或配置您有权访问的兼容区块浏览器 API。 |
| Arbitrum One  | 未配置默认发现 API。网络及其 RPC 仍然可用。                                                   | 通过合约地址添加资产，或配置您有权访问的兼容区块浏览器 API。 |
| 其他 EVM 网络 | 取决于该网络配置的区块浏览器 API。                                                            | 如果发现功能不可用，请通过合约地址添加资产。                 |

未配置区块浏览器 API 时，Pali 会直接显示合约地址表单，不显示选项卡，并提供简短提示和**代币导入帮助**链接。清空 API URL 不会移除网络或已导入的资产。没有区块浏览器 API 时，交易历史依赖本地保存的交易和 RPC 查询，可能无法恢复完整的较早交易记录。

## 手动添加代币或 NFT

1. 选择正确的网络和账户。
2. 打开**导入代币**。如果显示选项卡，请选择**添加自定义**。
3. 输入资产在该网络上的合约地址。
4. 检查检测到的资产详情。如果是 ERC-1155 资产，还需输入代币 ID。
5. 导入资产。

请使用项目公布或可信区块浏览器显示的合约地址。互不相关的合约可能使用相同的代币名称，同一个地址在不同网络上也可能对应不同的资产。

## 配置区块浏览器 API

RPC URL、区块浏览器网站和区块浏览器 API URL 的用途不同。RPC 将 Pali 连接到网络；区块浏览器网站用于在浏览器中查看地址和交易；区块浏览器 API 提供已索引的持有资产和交易历史。

1. 打开 Pali 的网络选择器，选择**管理网络**。
2. 选择要编辑的 EVM 网络旁边的铅笔图标。
3. 找到**区块浏览器 API URL（可选）**。粘贴下方示例中适用的 API URL。除非您也打算修改 RPC URL 和链 ID，否则请保留原值。
4. 选择**保存**。Pali 会在保存前检查 RPC 和区块浏览器 API 的基本访问情况。通过访问检查并不代表所有发现或历史记录端点均受支持。
5. 切换到另一个网络，再切换回刚才编辑的网络。这会刷新当前网络的 API 设置。重新打开**导入代币 → 您的代币**，使用新的 API 加载持有资产。

如果要添加新网络，请在网络选择器中选择**自定义 RPC**。该表单包含相同的可选区块浏览器 API 字段。要关闭某个网络的索引发现功能，请清空该字段并保存。

## 支持的格式与 URL 示例

### Ethereum：Routescan

内置的 Ethereum API URL 为：

```text
https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api
```

无需添加密钥即可公开访问。Pali 使用 Routescan 的持有资产 API 进行发现，并使用其兼容 Etherscan 的 API 获取交易历史。服务商的索引可能不完整或存在延迟。仅修改该 URL 中的链编号，并不代表 Routescan 支持相应网络。有关覆盖范围和端点，请参阅 [Routescan API 参考](https://routescan.io/docs/api)。

Routescan 当前文档规定的无密钥访问限制为**每秒 2 次请求、每天 10,000 次调用**。Pali 会控制请求间隔并缓存结果，但仍受服务商限制。请参阅 [Routescan 当前限制](https://routescan.io/docs/plans-and-limits/rate-limits)和[套餐](https://routescan.io/docs/plans-and-limits/api-keys-and-pricing)。

要使用个人 Routescan API 密钥，请替换下方的 `YOUR_API_KEY`：

```text
https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api?apikey=YOUR_API_KEY
```

Pali 通过服务商的 [`apikey` 请求头](https://routescan.io/docs/api/conventions)发送该值。此时适用您所订阅套餐的限额。

### 兼容 Blockscout 的发现功能

Pali 也支持实现 Blockscout **account/tokenlist** 请求格式的区块浏览器 API。请配置 API 的基础 URL，以及所需的链选择参数或 API 密钥；Pali 会提供账户地址和发现请求参数。请参阅 [Blockscout 代币列表文档](https://docs.blockscout.com/devs/apis/rpc/account)。

例如，自托管或服务商支持的 Blockscout API 可以使用：

```text
https://YOUR_BLOCKSCOUT_HOST/api
```

如果服务商要求通过查询参数进行身份验证：

```text
https://YOUR_BLOCKSCOUT_HOST/api?apikey=YOUR_API_KEY
```

上述主机名和密钥都是占位符。请使用支持所选网络且允许您发起请求的服务；仅填写区块浏览器网站的 URL 并不足够。

对于 **Base**，Blockscout 文档提供以下 PRO API 格式：

```text
https://api.blockscout.com/v2/api?chain_id=8453&apikey=YOUR_API_KEY
```

Blockscout 的 Base API 需要经过授权的密钥和付费套餐。请从 [Blockscout 开发者门户](https://dev.blockscout.com)获取密钥，确认套餐允许访问该网络，并替换 `YOUR_API_KEY`。链选择参数是带下划线的 **`chain_id`**。此示例遵循 [Base 官方 API 文档](https://docs.blockscout.com/base-api)，并非无需密钥的公共替代方案。

对于 **Arbitrum One**，对应的链选择参数值为 `42161`：

```text
https://api.blockscout.com/v2/api?chain_id=42161&apikey=YOUR_API_KEY
```

使用此配置前，请向 Blockscout 确认 Arbitrum 的访问权限和端点支持情况。该 URL 遵循其文档中的多链格式；是否可用取决于您的账户和套餐。Pali 不内置共享的 Blockscout 密钥。

### Etherscan 与 Alchemy

如果您的密钥和套餐允许，Etherscan V2 API URL 可以用于受支持的交易历史请求：

```text
https://api.etherscan.io/v2/api?chainid=1&apikey=YOUR_API_KEY
```

请使用所选网络的链 ID，并查看 [Etherscan 的端点和套餐要求](https://docs.etherscan.io/api-reference/endpoint/txlist)。**支持兼容 Etherscan 的交易历史，并不意味着支持自动代币发现。** Pali 尚未实现 Etherscan 单独提供的 [PRO 代币持有量端点](https://docs.etherscan.io/api-reference/endpoint/addresstokenbalance)；仅有 Etherscan 密钥无法启用**您的代币**。

Alchemy 的代币 API 使用不同的请求和响应，包括 [alchemy_getTokenBalances](https://www.alchemy.com/docs/data/token-api/token-api-endpoints/alchemy-get-token-balances)。Pali 没有 Alchemy 代币发现适配器。如果 Alchemy RPC 端点适用于您的网络，可以将其填入 **RPC URL** 字段，但不能将其作为**区块浏览器 API URL** 字段的替代值。

## API 密钥与隐私

区块浏览器 API 密钥用于授权访问服务商，相关请求可能消耗您的使用配额。它与钱包私钥或助记词不同。切勿在 API URL 中输入钱包私钥或助记词。

Pali 将配置的 API URL 保存在扩展程序的网络设置中。任何能够检查这些设置或扩展程序请求的人，都可以看到 URL 中包含的密钥。分享截图、日志或配置示例前，请移除密钥。区块浏览器服务也会收到您请求查询的公开账户地址。请参阅[隐私与安全](./privacy-and-safety)。

## 空结果、API 不可用与重试

- **没有其他代币可导入：** API 在排除已导入资产后，没有返回其他受支持的持有资产。这不能证明账户中没有资产；索引和资产覆盖范围可能不完整。
- **未配置发现功能：** 网络未设置区块浏览器 API URL。请通过合约地址添加资产，或通过**管理网络**配置兼容的服务。
- **API 不可用／禁止访问：** 请检查服务商端点、所选链、API 密钥和套餐。`403` 响应表示服务商拒绝了访问。
- **请求过多：** `429` 响应表示服务商正在限制请求。即使您第一次打开列表，配额也可能已经耗尽。请等待后再选择**重试**；如果持续失败，请检查服务商的使用限制。

发现失败并不代表代币余额为零。索引服务不可用时，您仍可使用**添加自定义**，并通过 RPC 读取余额。
