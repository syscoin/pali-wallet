# Pali Wallet Loading Strategy

Pali should acknowledge work immediately and provide useful feedback within two seconds. RPC responses, hardware prompts, key derivation, signing and chain confirmation can legitimately take longer. A timeout must not be presented as transaction failure or used to invent a successful network switch.

## Startup and recovery

The static HTML loader remains visible until React owns a visible screen. If the application bundle does not load, the loader offers a reload action. `WalletBootstrap` requests authoritative background state and waits for rehydration before mounting wallet routes. An unavailable background worker produces a retry screen instead of routing with an empty default wallet.

Startup and extension-window checks use a soft feedback deadline of 1.8 seconds from page navigation, reserving time to paint a recovery action. Their separate ten-second I/O deadline allows a healthy but slow response to finish after that feedback appears. A fresh service worker can take time to register its listener; completed connection failures are retried within the I/O deadline. User-initiated retry can restart a degraded controller and supersedes the prior attempt. Replies from superseded or expired attempts are ignored.

Vault read errors and an incomplete vault/key pair fail initialization. They must never be interpreted as a new wallet. Persisted popup-open flags are hints; live extension contexts determine whether an approval window is open.

## Account and network transitions

`usePageLoadingState` observes real account/network state. `PageLoadingOverlay` delays the spinner for 150 ms and the blocking backdrop for 500 ms to avoid flicker. After two seconds it changes to a nonblocking status message. The underlying operation continues with its actual status.

`AppLayout` keeps navigation available but makes transaction and account-editing content inert while its account/network context is changing. Removing the global backdrop must not enable signing, sending, importing, or deleting against a mismatched context. No timer changes the network to idle or declares a connection failure merely because it is slow.

Approval pages retain their own user-consent and transaction lifecycle. A pending approval is never accepted automatically to meet a responsiveness target.

## Shared controller status

`controllerStatus` owns one runtime listener and one status poller per extension page. Mounted `useController` consumers share that subscription. Identical in-flight status requests and activity updates are coalesced. A logout event invalidates older status replies, preventing a delayed unlocked response from restoring the UI after lock.

A failed or malformed status response marks cached lock state unavailable. The layout shows a reconnect message, keeps sensitive content inert, and polls again after two seconds. A valid response clears the unavailable state. Read-only status requests have an independent 1.8-second timeout; loss of the worker must not silently look like a healthy unlocked wallet.

## Lists and stale data

Assets, NFTs and transaction lists render 50 rows initially, with explicit load-more controls. Search and sort run on the full applicable collection before slicing, so an item outside the first page remains discoverable. This limits initial DOM work; repeatedly loading every page still grows the DOM and is not virtualization.

Pagination is bound to account, network and backend context. A delayed page reply cannot append to a different context, including after leaving and returning to a screen. Locally cached rows are excluded during render as soon as their context changes. UTXO rows use formatting helpers without repeatedly sorting the complete history.

Transaction display caches include account, chain, currency, call and token metadata. Token decimals and symbols are looked up on the transaction's chain; a late metadata result from a different active context is discarded.

## Validation

Run the unit regressions and production bundle budget check:

```sh
yarn test source tests --runInBand --coverage=false
yarn type-check
yarn build:chrome
node scripts/check-bundle-size.js build/chrome
```

Browser checks should cover fresh and existing wallets, offline RPCs, missing application chunks, an unresponsive background worker, recovery, CPU throttling, large histories and rapid account/network changes. A fast empty-wallet startup does not establish a two-second guarantee for every wallet or device.
