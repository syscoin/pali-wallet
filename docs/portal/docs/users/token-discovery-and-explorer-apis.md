---
title: Token discovery and explorer APIs
---

Pali can use an explorer API to find tokens and NFTs you can import. You can also add an asset by its contract address. Imported token balances are read through the network's RPC, so automatic discovery is optional.

## What works by default

| Network            | Automatic discovery                                                                                       | If an asset is missing                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Ethereum mainnet   | Routescan, without an account or API key. Supports ERC-20 tokens and supported ERC-721/ERC-1155 holdings. | Use **Import Token → Add Custom**.                                                         |
| Base               | No default discovery API. The network and its RPC remain available.                                       | Add assets by contract address, or configure a compatible explorer API you have access to. |
| Arbitrum One       | No default discovery API. The network and its RPC remain available.                                       | Add assets by contract address, or configure a compatible explorer API you have access to. |
| Other EVM networks | Depends on the explorer API configured for that network.                                                  | Use **Add Custom** if discovery is unavailable.                                            |

When no explorer API is configured, Pali opens **Add Custom**, hides **Your Tokens**, and explains how to add assets or configure an API. Clearing an API URL does not remove the network or its imported assets. Without an explorer API, transaction history relies on locally saved transactions and RPC reads; it may not recover a complete older history.

## Add a token or NFT manually

1. Select the correct network and account.
2. Open **Import Token → Add Custom**.
3. Enter the asset's contract address on that network.
4. Review the detected asset details. For an ERC-1155 asset, also enter its token ID.
5. Import the asset.

Use the contract address published by the project or shown in a trusted explorer. The same token name can be used by unrelated contracts, and an address on one network may identify a different asset on another.

## Configure an explorer API

An RPC URL, an explorer website, and an explorer API URL serve different purposes. The RPC connects Pali to the network; the explorer website opens addresses and transactions in your browser; the explorer API supplies indexed holdings and history.

1. Open Pali's network selector and choose **Manage networks**.
2. Select the pencil icon beside the EVM network you want to edit.
3. Find **Block Explorer API URL (optional)**. Paste the appropriate API URL from the examples below. Keep your existing RPC URL and chain ID unless you intend to change those settings too.
4. Choose **Save**. Pali checks the RPC and basic explorer API access before saving. A successful access check does not guarantee that every discovery or history endpoint is supported.
5. Switch to another network, then switch back to the network you edited. This refreshes its active API setting. Reopen **Import Token → Your Tokens** to load holdings with the new API.

To add a new network instead, choose **Custom RPC** from the network selector. Its form includes the same optional explorer API field. To turn off indexed discovery for a network, clear that field and save.

## Supported formats and URL examples

### Ethereum: Routescan

The built-in Ethereum API URL is:

```text
https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api
```

Leave it without a key for public access. Pali uses Routescan's holdings APIs for discovery and its Etherscan-compatible API for transaction history. Provider indexing can be incomplete or delayed. Changing the chain number in this URL does not establish that Routescan supports another network. See [Routescan's API reference](https://routescan.io/docs/api) for its coverage and endpoints.

Routescan currently documents a keyless limit of **2 requests per second and 10,000 calls per day**. Pali spaces requests and caches results, but provider limits still apply. See [Routescan's current limits](https://routescan.io/docs/plans-and-limits/rate-limits) and [plans](https://routescan.io/docs/plans-and-limits/api-keys-and-pricing).

To use a personal Routescan API key, replace `YOUR_API_KEY` in:

```text
https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api?apikey=YOUR_API_KEY
```

Pali sends this value in the provider's [`apikey` request header](https://routescan.io/docs/api/conventions). Your provider plan's limits apply.

### Blockscout-compatible discovery

Pali also supports explorer APIs that implement Blockscout's **account/tokenlist** request format. Configure the API's base URL and any required chain selector or API key; Pali supplies the account address and discovery request parameters. See [Blockscout's token-list documentation](https://docs.blockscout.com/devs/apis/rpc/account).

For example, a self-hosted or provider-supported Blockscout API can use:

```text
https://YOUR_BLOCKSCOUT_HOST/api
```

If that provider requires query-based authentication:

```text
https://YOUR_BLOCKSCOUT_HOST/api?apikey=YOUR_API_KEY
```

The host and key above are placeholders. Use a service that supports the selected network and permits your requests; an explorer website URL alone is insufficient.

For **Base**, Blockscout documents this PRO API format:

```text
https://api.blockscout.com/v2/api?chain_id=8453&apikey=YOUR_API_KEY
```

Blockscout's Base API requires an authorized key and a paid plan. Obtain the key from [Blockscout's developer portal](https://dev.blockscout.com), confirm your plan's network access, and replace `YOUR_API_KEY`. The selector is **`chain_id`**, with an underscore. This example follows the [official Base API documentation](https://docs.blockscout.com/base-api); it is not a public keyless replacement.

For **Arbitrum One**, the equivalent chain selector is `42161`:

```text
https://api.blockscout.com/v2/api?chain_id=42161&apikey=YOUR_API_KEY
```

Confirm Arbitrum access and endpoint support with Blockscout before using that configuration. The URL follows its documented multichain format; availability depends on your account and plan. Pali does not include a shared Blockscout key.

### Etherscan and Alchemy

An Etherscan V2 API URL can provide supported transaction-history requests when your key and plan allow them:

```text
https://api.etherscan.io/v2/api?chainid=1&apikey=YOUR_API_KEY
```

Use the selected network's chain ID and check [Etherscan's endpoint and plan requirements](https://docs.etherscan.io/api-reference/endpoint/txlist). **Etherscan-compatible history does not imply automatic token discovery.** Pali does not implement Etherscan's separate [PRO token-holdings endpoint](https://docs.etherscan.io/api-reference/endpoint/addresstokenbalance); an Etherscan key alone does not enable **Your Tokens**.

Alchemy's token APIs use different requests and responses, including [alchemy_getTokenBalances](https://www.alchemy.com/docs/data/token-api/token-api-endpoints/alchemy-get-token-balances). Pali has no Alchemy token-discovery adapter. An Alchemy RPC endpoint can be used in the **RPC URL** field if appropriate for your network, but it is not a replacement for the **Block Explorer API URL** field.

## API keys and privacy

An explorer API key authorizes access to that provider and may consume your usage allowance. It is separate from your wallet's private key or recovery phrase. Never enter a wallet private key or recovery phrase in an API URL.

Pali saves a configured API URL in its extension network settings. A key included in that URL is visible to anyone who can inspect those settings or the extension's requests. Remove keys before sharing screenshots, logs, or configuration examples. Explorer services also receive the public account addresses you ask them to look up. See [Privacy and safety](./privacy-and-safety).

## Empty results, unavailable APIs, and retries

- **No additional tokens to import:** the API returned no supported additional holdings after already imported assets were excluded. This does not prove the account has no assets; indexing and asset coverage can be incomplete.
- **Discovery is not configured:** the network has no explorer API URL. Use **Add Custom**, or configure a compatible service through **Manage networks**.
- **API unavailable / access forbidden:** check the provider's endpoint, selected chain, API key, and plan. A `403` response indicates the provider refused access.
- **Too many requests:** a `429` response means the provider is limiting requests. Its quota can already be exhausted when you first open the list. Wait before using **Retry**, and check the provider's usage limits if failures continue.

Discovery failure does not establish that a token balance is zero. You can continue using **Add Custom** and RPC-based balance reads while an indexer is unavailable.
