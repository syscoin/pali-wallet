/**
 * Stub for `@ledgerhq/cryptoassets-evm-signatures/data/evm/index`.
 *
 * hw-app-eth only uses this embedded dataset (~130KB of base64 blobs for 20
 * chains) as an OFFLINE fallback: `ledgerService.resolveTransaction` first
 * fetches the up-to-date ERC-20 signature list from the Ledger CDN
 * (cryptoassetsBaseURL, enabled by default). With the stub, online behavior
 * is unchanged; offline, unknown tokens simply won't be clear-signed with
 * ticker/decimals on the device.
 */
export const signatures = {};
