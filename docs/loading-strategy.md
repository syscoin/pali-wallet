# Pali Wallet Loading Strategy

Pali should acknowledge work immediately and provide useful feedback within two seconds. RPC responses, hardware prompts, key derivation, signing and chain confirmation can legitimately take longer. A timeout must not be presented as transaction failure or used to invent a successful network switch.

## Startup and recovery

The static HTML loader remains visible until React owns a visible screen. If the application bundle does not load, the loader offers a reload action. `WalletBootstrap` requests authoritative background state and waits for rehydration before mounting wallet routes. An unavailable background worker produces a retry screen instead of routing with an empty default wallet.

Startup and extension-window checks use a soft feedback deadline of 1.8 seconds from page navigation, reserving time to paint a recovery action. Their separate ten-second I/O deadline allows a healthy but slow response to finish after that feedback appears. A fresh service worker can take time to register its listener; completed connection failures are retried within the I/O deadline. User-initiated retry can restart a degraded controller and supersedes the prior attempt. Replies from superseded or expired attempts are ignored.

Cold background initialization clears activity flags left by the previous worker; frontend state hydration preserves flags for operations still running in the current worker. Account-switch failures release their loading flag. Vault read errors and an incomplete vault/key pair fail initialization. They must never be interpreted as a new wallet. Persisted popup-open flags are hints; live extension contexts and tab URLs (including pending navigation) determine whether an approval or hardware view is open. Both kinds of view share a background creation guard through the Chrome creation callback. An abruptly closed hardware tab cannot leave a five-minute approval lock, and the main wallet rechecks when an external tab closes.

## Account and network transitions

`usePageLoadingState` observes real account/network state. `PageLoadingOverlay` delays the spinner for 150 ms and the blocking backdrop for 500 ms to avoid flicker. After two seconds it changes to a nonblocking status message. The underlying operation continues with its actual status.

`AppLayout` keeps header navigation available but makes Home, Faucet, transaction, account-editing, account-management, advanced-settings and account-consent content inert while its account/network context is changing. Removing the global backdrop must not enable signing, sending, importing, deleting or faucet claims against a mismatched context. Case, trailing-slash and encoded-path aliases receive the same guards. Account-removal confirmations also validate context inside the portal and again in the background before deletion. No timer changes the network to idle or declares a connection failure merely because it is slow.

Approval pages retain their own user-consent and transaction lifecycle. A pending approval is never accepted automatically to meet a responsiveness target.

Before routing an approval, the initial external document registers through Chrome's runtime channel. The background checks the created popup's window, top frame, document and nonce, then binds a one-time challenge to its service-worker client identity. Same-document routing and locked-wallet login preserve that identity; another window, reload or stale nonce cannot answer the approval. The gate shows recovery controls at the startup feedback deadline while permitting a valid late handshake until its separate ten-second deadline. Closing a popup cannot overtake an already authenticated response awaiting the requesting document's liveness check.

## Shared controller status

`controllerStatus` owns one runtime listener and one status poller per extension page. Mounted `useController` consumers share that subscription. Identical in-flight status requests and activity updates are coalesced. A logout event invalidates older status replies, preventing a delayed unlocked response from restoring the UI after lock.

A failed or malformed status response marks cached lock state unavailable. The layout shows a reconnect message, keeps sensitive actions inert, and polls again after two seconds. Seed, private-key and wallet-forget views unmount on disconnection, clearing their cached plaintext and requiring fresh authentication after reconnection. Header navigation stays available. A shared lifecycle port marks status unavailable immediately if the worker disconnects. Returning focus or visibility revalidates cached status; late replies from before disconnection cannot restore it. A valid response clears the unavailable state. Read-only status requests have an independent 1.8-second timeout and disable transport backoff because the shared poller owns retries; loss of the worker must not silently look like a healthy unlocked wallet.

Unlock, seed import and new-wallet creation refresh the shared authentication status before entering Home. A stale locked response from before authentication cannot overwrite the fresh result. If creation succeeds but status confirmation fails, the UI returns to the existing-wallet recovery screen instead of repeating creation.

## Onboarding secrets and signing ownership

Onboarding passwords and phrases live only in a short-lived React provider.
Navigation carries no secret route state. Leaving the allowed onboarding steps,
completion, cancellation, hiding the page or unloading clears that state; a
revisit with missing secrets returns to the safe entry screen. A current legacy
history entry can be scrubbed, but already-written browser session files cannot
be erased by this change. Password submission has one synchronous in-flight
guard, consumes failures with a translated message and always releases its
spinner. Once creation is sent, its in-memory secrets are cleared and the UI does not
replay the request after a timeout or lost acknowledgement. The background
reserves creation before waiting for its authentication mutex, so a second
request cannot queue another destructive reset. Inside that mutex, durable
wallet presence prevents a stale setup page from replacing a completed wallet.
An uncertain creation or failed confirmation reloads the whole app document;
WalletBootstrap must hydrate fresh state before routing is available.

Account preparation rejects externally supplied P256 ownership in the
wallet-managed passkey flow. New or replacement credentials use independent
user handles, and pending public credential records are retained through
uncertain installation or hydration outcomes. UI cancellation never implies
that an authenticator credential is unused and safe to delete.

UTXO approval binds signing to the approved account and network. A context
change during validation, metadata retrieval or hardware interaction rejects
stale work. Invalid or unverifiable account inputs produce translated feedback.
The signing request does not automatically retry, and an acknowledged broadcast
remains successful even if the later local history update fails. These checks
do not impose a two-second completion deadline on cryptography or hardware.

Receive is also context-sensitive. Its address, QR code and copy control are
unmounted while an account/network transition or worker disconnection is
unresolved, including after the loading overlay becomes nonblocking. They return
when the context settles. Ordinary balance loading leaves Receive available.

Faucet claims remain inert during those same unresolved context changes,
including after the two-second overlay becomes nonblocking. The claim control
becomes usable again only when the account/network context is authoritative;
header navigation stays available throughout.

## Smart-account infrastructure setup

The Advanced settings card shows explanatory status after 1.2 seconds of waiting, leaving room for route transitions within the two-second feedback target. It distinguishes unavailable status from missing infrastructure and offers a read-only status check. New feedback is translated in every supported locale without inline translation defaults.

Status checks refresh on focus, after deployment finishes or errors, and every five seconds while pending or unavailable (thirty seconds when healthy). A deployment request is never automatically retried. Pending work disables duplicate submission on its chain while allowing navigation and deployment on another chain. Remaining unsigned work stops when wallet context changes; already submitted transactions can still confirm. Neither a UI deadline nor a missing receipt proves that a transaction failed.

## Lists and stale data

The account selector mounts its account rows only while the menu is open. Closing it removes the hidden list from Home and other routes; reopening still exposes every account. Account management computes the HD-account count once per render rather than once for every row.

Dapp account consent, assets, NFTs and transaction lists render 50 rows initially, with explicit load-more controls. Account consent searches all eligible accounts and keeps the selected account visible. Incoming balance updates do not reset the selection or repeat connection initialization. Search and sort run on the full applicable collection before slicing, so an item outside the first page remains discoverable. This limits initial DOM work; repeatedly loading every page still grows the DOM and is not virtualization.

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
