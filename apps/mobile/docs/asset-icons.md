# Asset icon identity

Both hosts use `source/shared/assetIconIdentity.ts` to match an EVM asset by chain and contract, or an SPT by chain and asset GUID. Symbols are fallback text, never proof that an asset owns a particular logo. Provided precision must agree with a configured identity. Native network artwork remains separate from token artwork.

The bundled mappings include SYSX on Syscoin mainnet/Tanenbaum, zkSYS on chain 57057, and the configured USDC contracts on Sepolia, Syscoin Tanenbaum and zkSYS Tanenbaum. These display mappings do not change discovery, amounts, signing, bridge routes or transaction policy. A logo is not an issuer, bridge-backing or contract-code attestation.

The zkSYS and L2 USDC identities are recorded in the reviewed `syscoin/zksync-os-server` explorer manifest (`scripts/explorer/blockscout/token-metadata.zksys.json`, commit `5797cec9`). The configured L2 USDC reports its L1 address as `0xb26b0ec48ed88347ed89874411cae4a1ecdf97fd`; the Syscoin Tanenbaum endpoint reports USD Coin/USDC with six decimals there. Sepolia's configured collateral token is `0x1c7d4b196cb0c7b01d743fbc6116a902379c7238` with six decimals. These public observations corroborate the display configuration; they are not independent consensus verification.

For other assets, native reuses image metadata returned by existing validated CoinGecko market requests. It accepts only HTTPS raster paths on the configured CoinGecko image hosts. The RAM cache holds at most 64 identity/registration-scoped URIs; it does not add a per-row token lookup service. Native `Image` performs the image request, so the URI limit is not an image-byte or transport concurrency guarantee. Failed image URLs fall back across remounts and may retry after five minutes when existing market metadata is refreshed.

Extension review screens use bundled artwork or a safe existing cached raster, and may join a request already started by the normal icon loader. They do not start a new remote icon request while requesting signing consent. The normal asset screens retain the existing image loader and cleanup behavior.

Holdings, asset pickers, send forms, single/batch reviews, approvals and activity/detail rows use the same identity policy. Mixed-asset or identity-less activity keeps its generic direction marker. All-networks activity retains its separate network badge; a concrete network does not gain a redundant badge.
