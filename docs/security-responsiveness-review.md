# Pali Wallet security and responsiveness review

Review date: 2026-10-08. Scope: the Chrome extension in this checkout, its installed dependency graph, production bundles, and disposable Chromium profiles. This is a code review with targeted fixes and runtime checks, not a formal cryptographic audit or a certification that every wallet operation finishes in two seconds.

## Upstream keyring release

Keyring 1.0.612 is now published; the earlier E404/publication notes below describe their dated validation snapshots. The cryptography follow-up targets upstream core 1.0.29 and keyring 1.0.613 from [sidhujag/sysweb3#16](https://github.com/sidhujag/sysweb3/pull/16). Those new packages require their own publication and clean-install validation. No package patch is included here. Earlier patched-dependency measurements retain their historical snapshot labels. Released keyring 1.0.611 still collapses operational errors into authentication failures and must not be substituted for the corrected version.

## Account-data and request-work containment

### Automatic account repair preserves saved data by failing closed

The former `MainController.repairCorruptedAccounts()` removed every HD account before asynchronously deriving replacements. `removeAccount` also removes the account's asset and transaction records. A later derivation failure could therefore leave a partial wallet; logging the error did not restore those records.

The former `repairCorruptedAccountsWithSession()` derived replacements before deleting accounts, but called `addNewAccount()` repeatedly against the unchanged account state. That API chooses its next index from the current state, so staging could produce repeated account IDs. Neither repair path treated an address mismatch as a reason to abort. The subsequent collection of remove/create dispatches was not an atomic transaction.

Both destructive routines have been removed. A synchronous preflight checks saved HD identities, addresses, public-key metadata and the default account before an unlocked session becomes usable or transfers to a target vault. Sparse IDs above zero remain valid. Incomplete data produces an explicit recovery error; accounts, assets, labels and history are preserved. An incomplete target is rejected before session transfer and rolls back to the source vault. First-account derivation rechecks the session and saved records immediately before commit. Operational failures after authentication clear the restored session without charging a wrong-password attempt or disturbing a newer session.

The keyring's `needsAccountCreation` flag can also mean that the selected account is missing, rather than proving a legacy migration. First-account creation is now limited to a genuinely empty HD collection with the expected initial selection, preventing an existing account zero and its history from being overwritten.

This contains the automatic data-loss risk; it does not reconstruct damaged accounts. A future recovery implementation needs explicit derivation at a requested index, validation of every expected identity, preservation of account metadata/assets/history, a session/context check immediately before commit, and one atomic commit. Do not equate a recoverable seed with recoverable imported-account metadata or transaction history.

Evidence: [MainController](../source/scripts/Background/controllers/MainController.ts), [vault reducers](../source/state/vault/index.ts).

### Signing payload work is bounded before admission and approval

Request-count limits alone did not bound payload complexity. Typed-data parsing and recursive validation, full signing previews, PSBT parsing/input traversal and batch-call traversal could all perform excessive synchronous work for one request.

The content script now checks JSON work before runtime transport. The background independently checks the request before queue admission, network waits, parsing or approval. An iterative byte/depth/value guard rejects excessive data and cycles without first stringifying it. Typed-data limits also bound schema expansion and reject duplicate field names; a cheap PSBT reader checks binary work before the normal parser. Signing previews use compact full data rather than depth-amplifying pretty printing.

These are wallet compatibility policies, not protocol maximums:

| Work | Limit |
| --- | --- |
| General request | 1 MiB estimated serialized UTF-8, depth 32, 10,000 values |
| Personal/typed signing request | 64 KiB |
| Batch calls | 50 calls and 128 KiB |
| Typed schema | 64 types, 128 fields per type, 512 fields total |
| Typed expansion | 4,096 operations and depth 16 |
| PSBT | 512 KiB decoded, 200 inputs, 200 outputs, 4,096 key/value pairs and 64 KiB metadata |

Excessive requests return invalid-parameters errors before approval. Valid requests above these limits need smaller batches or a reviewed policy change. No message or transaction is silently truncated and no batch is partially signed. Transport cloning, browser scheduling, hardware prompts and admitted cryptographic work can still take time; asynchronous timers cannot interrupt JavaScript already running synchronously. A cancellable worker remains a possible later improvement for expensive admitted operations.

Evidence: [request budget](../source/utils/requestPayloadBudget.ts), [typed-data budget](../source/utils/typedDataWorkBudget.ts), [request pipeline](../source/scripts/Background/controllers/message-handler/request-pipeline.ts), [signing view](../source/pages/Transactions/SignEth.tsx).

## Intermittent correct-password lockout

The reported symptom has a plausible implementation cause. The published `@sidhujag/sysweb3-keyring` 1.0.610 and 1.0.611 `unlock()` caught every exception and returned `canLogin: false`. Pali then treated that result as an invalid password and charged a failed attempt. A temporary storage failure, KDF/platform failure or failure rebuilding a session after successful decryption could therefore consume an attempt with the correct password. The configured threshold is ten attempts followed by five minutes of lockout.

The initial source fix in [sidhujag/sysweb3#15](https://github.com/sidhujag/sysweb3/pull/15), now published as 1.0.612, distinguishes operational errors from failed vault authentication and clears partially restored secrets. Genuine authentication failures still count. That initial change preserved encryption algorithms and stored key formats. The later KDF and persistence correction described below targets core 1.0.29/keyring 1.0.613 and adds an explicit legacy profile and authenticated-encryption write policy. Pali contains no package patch.

Upstream regressions exercise the implementation with real WebCrypto decryption: transient/missing storage, wrong passwords, legacy vaults, a failed second vault read, post-authentication failures, platform/key-import errors and malformed envelopes. Pali controller tests verify the expected error contract with controlled keyring results; they do not change the behavior of released 1.0.611.

This identifies a mechanism consistent with the user's report, not a reproduction of that historical incident. Failed authentication and damaged ciphertext cannot always be distinguished cryptographically.

The browser smoke test also exposed a separate UI race: successful unlock navigated to Home before the shared lock-status snapshot refreshed, so the protected route could send the user straight back to login while the background remained unlocked. Unlock now awaits a fresh authoritative status, invalidating older reads, before navigating or completing an external login. The final Chrome smoke test remained on Home after unlocking; missing balance data is handled as a separate loading condition.

## Security and robustness changes made

| Area | Result |
| --- | --- |
| Site permissions | Permissions use the complete HTTP(S) origin, including scheme and non-default port. Trusted-site checks require an exact HTTPS host. Legacy hostname-only grants are inactive until the user reconnects the site; they remain removable. |
| Response ownership | Provider results return through the originating runtime callback instead of a tab-wide broadcast. A response cannot be consumed by another frame/document merely because it shares the tab. |
| Approval ownership | The created popup's browser window/document identity receives a private challenge that binds its ServiceWorker client before routing. Responses require that client, the nonce and the expected route. Cloned windows and reloaded documents cannot inherit approval authority. Login redirects encode the complete signing payload, including literal `#`, `&`, `+` and `%` characters. |
| Request lifetime | Queued requests carry cancellation and document identity. Tab navigation/closure cancels work; approval pages check document liveness. Stale requests are rejected before approval/results. |
| Admission control | Maximum four pending requests per origin and 64 overall, including read-only requests. Queues rotate between origins, expire after 30 seconds, and network-readiness waits stop after 15 seconds. These are resource bounds, not transaction completion promises. |
| Delivery failures | Content-script requests retry only when Chrome confirms that no receiving listener exists. A closed response channel is ambiguous and must not replay signing or broadcasting. |
| Account privacy | Locked account/xpub queries do not expose account data. UTXO history uses the account connected to the requesting site, rather than whichever account is currently selected in the UI. |
| Privileged fetches | Asset metadata requests validate the GUID and use the configured active UTXO backend. A site cannot supply an arbitrary privileged fetch URL. |
| Signing worker | Offscreen signing messages require this extension's exact background-worker sender, with no sender tab. |
| Secret access and locking | Password operations are serialized. Public unlock arguments cannot bypass the persisted attempt limit. Delayed unlock/seed/private-key results are rejected after lock, reset or network/keyring changes. Lock clears every cached keyring, not only the active one. |
| Secret UI | Private-key validation results are bound to their account/network context. Unmounted password inputs discard late validation results. Seed, private-key and wallet-removal views unmount when the worker becomes unavailable, removing cached secrets and requiring fresh authentication after reconnect. |
| Storage isolation | Startup restricts `chrome.storage.local` to trusted extension contexts. Global/vault/profile read errors propagate; an unreadable vault is not treated as absent. An incomplete encrypted-vault/key pair enters recovery. |
| Initialization recovery | UI routes wait for authoritative state. Reinitialization replaces stale controller handlers, so a degraded handler cannot keep answering after recovery. |
| Token display | Metadata/cache identities include the transaction's chain and account context. A delayed metadata response from another network/account cannot relabel a transaction. |

Chrome documents that local storage is exposed to content scripts by default and can be restricted through `setAccessLevel`: [Chrome storage API](https://developer.chrome.com/docs/extensions/reference/api/storage?hl=en).

Document-liveness checks cannot reverse a signature or transaction already produced/broadcast. Frame navigation can race the final check. Treat an ambiguous submission result as unknown and inspect wallet/chain activity before manually resubmitting.

## Responsiveness and loading changes

- Routes import their actual modules instead of the all-pages barrel. Opening the start screen no longer loads the entire page tree.
- The static loader survives failed JavaScript loads and offers reload. Startup has a soft 1.8-second feedback deadline and a separate ten-second I/O deadline, so a valid late reply can still succeed. Explicit retry supersedes the old attempt.
- Long account/network transitions switch from a blocking overlay to nonblocking progress after two seconds. Navigation remains available; transaction/account/module-consent content stays inert while its context is changing.
- A failed/malformed controller status read marks the cached status unavailable, shows a reconnect message and disables sensitive content. Polling retries after two seconds; it does not silently present stale state as healthy.
- Each extension page shares one controller listener and one coalesced status poller. Repeated hook consumers no longer multiply identical background requests.
- Asset, NFT and transaction lists initially render 50 rows. Search/sort operate before slicing; explicit load-more remains available. This reduces initial DOM work but is not full virtualization: loading every page still grows the DOM.
- Removed repeated full-history sorting from each UTXO transaction row. Pagination and display caches reject results belonging to a previous account/network, including committed A-to-B-to-A switches.
- Unknown Home balances retain a visible pending status, followed by slower-than-expected feedback after 1.8 seconds. The UI does not turn unknown funds into a loaded zero; Send stays disabled and Receive remains usable.
- Removed unused duplicate locale copies and preserved UTF-8 in minified output. Added a production bundle-size budget command.

See [loading strategy](loading-strategy.md) for the maintained behavior and validation commands.

## Validation

Before rebasing onto current master and moving the dependency fix upstream, the scoped suite passed: **107 suites, 874 tests**. This historical run included a local dependency patch that is no longer shipped. TypeScript passed. ESLint reported zero errors and six configuration/naming warnings; `git diff --check` passed. It includes origin/approval isolation, cancellation, bounded admission, lock/session races, storage failure recovery, actual dependency error classification, fresh status before authentication navigation, late startup replies, stale account data, large lists and Home balance feedback. Additional regressions cover preserved account data, stale selections, orphan metadata, lock/data changes during derivation, sparse-array amplification, typed schema work and PSBT counts. These tests do not substitute for real-device release testing.

The earlier isolated Chrome production build passed. Both historical builds used the same machine/configuration and excluded packaging/report plugins; figures below are raw bytes unless stated otherwise.

| Metric | Before | After |
| --- | ---: | ---: |
| HTML initial app JavaScript | 1,476,859 | 1,479,420 |
| Total JavaScript for the fresh Start route | 2,379,521 | 1,491,009 |
| Initial app JavaScript, gzip | 448,969 | 452,318 |
| Start-screen route-containing chunk | 902,463 | 11,389 |
| Background JavaScript | 4,202,303 | 4,216,342 |
| Content-script JavaScript | 11,094 | 14,784 |
| Total unpacked extension | 8,632,973 | 8,431,467 |

Total JavaScript needed by the fresh Start route falls about **37.3%**. The large improvement is its deferred chunk, not the initial entry bundle: security/recovery logic slightly increases the entry. Total unpacked size falls about 2.3%. The route chunk's reduction must not be interpreted as a 99% reduction in total startup JavaScript. Shared dependencies still dominate the roughly 1.48 MB initial JavaScript, and the background remains roughly 4.22 MB. All new size budgets pass.

A synthetic render of 1,000 assets mounted 50 icons in each ERC20, NFT and SPT list, reducing initial rows by 95%. The roughly 6–8 ms component rendering samples were measured in Node; they are not browser end-to-end latency measurements.

Chromium 149.0.7827.55 ran in disposable profiles on an Apple M5 Max, 18 cores, 48 GiB RAM. Fresh startup samples were 460 ms normally, 463 ms at 4x CPU throttling, and 491 ms offline. The longest task in the 4x sample was 139 ms. Existing-wallet startup took 478 ms; a stale persisted popup flag did not block startup. These are individual local samples, not percentiles or low-end-device guarantees.

Simulated hung worker, hung window lookup and missing entry bundle showed recovery at 1,801–1,803 ms. Late worker/window replies were still accepted automatically after roughly 5.49/2.97 seconds, with recovery feedback near 1.80 seconds. A deliberately blocked main thread delayed feedback until 2.044 seconds: the browser cannot paint during a synchronous two-second block. The new payload-work limits reduce privileged parsing and signing work; they cannot prevent the browser from cloning a page message before the content-script guard runs.

The startup matrix precedes the final unlock-to-route synchronization fix. A separate production Chrome smoke before the surgical containment fixes imported a disposable seed, locked the wallet, reloaded, unlocked with the correct password in approximately 250 ms, and verified that Home remained visible after 2.2 seconds with the background unlocked and no background errors. Condensed measurements are saved in [security-responsiveness-evidence.json](security-responsiveness-evidence.json).

A second disposable-profile run before the surgical containment fixes explicitly stopped the extension worker after lock, then reopened the wallet. Loss of an in-memory marker confirmed that the worker restarted. The correct password unlocked in 182 ms; Home remained visible after 2.2 seconds, with the background unlocked, the password field absent and no background errors. This exercises worker restart, rather than waiting out every possible idle/autolock configuration.

That earlier production build including the surgical fixes and local dependency patch repeated the disposable import, lock, confirmed worker shutdown/restart, correct-password unlock and stable Home check. Unlock took 180 ms; Home remained visible after 2.2 seconds, the background stayed unlocked, and no background errors were recorded.

An actual local dapp page exercised that snapshot’s content script and background at 4x CPU throttling. Eight hostile fixtures covered oversized personal signing, deep nesting, wide arrays, an oversized batch, deep typed-schema expansion, duplicate typed fields, an oversized PSBT body and a real 201-input PSBT. Each returned `-32602` in under 5 ms in this local sample, opened no approval page, and left liveness checks working. The page recorded no long tasks during these requests. Accepted-fixture regressions include EIP-712 Mail, Permit, 50 recipients/calls and real 200-input/output PSBTs. These measurements are local samples, not worst-case latency guarantees.

## Initial PR integration snapshot

At this initial snapshot, the Pali PR targeted **4.0.70** and keyring **1.0.612**, rebased onto master `94a1cde5`. The dependency was built and locally packed from [sidhujag/sysweb3#15](https://github.com/sidhujag/sysweb3/pull/15), commit `27e4409`; no local package patch or Git dependency workaround was shipped. Publication was still pending at that time, and a future integrity hash was not fabricated in the lockfile.

The integrated suite passes **114 suites, 947 tests**, plus TypeScript and the production Chrome build. All bundle budgets pass: background JavaScript is 4,229,863 bytes, content script 14,784 bytes, and the unpacked extension 8,445,605 bytes. Fresh Start JavaScript remains 1,491,009 bytes; the historical original-checkout baseline above remains labelled separately.

That snapshot's disposable-profile Chrome checks using the upstream source package passed: correct-password unlock after confirmed worker restart took 184 ms and remained on Home after 2.2 seconds, with no background errors. Eight hostile dapp requests rejected within 4.3 ms at 4x page CPU throttling, opened no approval page and recorded no long tasks. These are individual local samples.

Rebase review also found an interaction with master's receipt-refresh queue: reset now cancels queued/in-flight receipt work and invalidates balance freshness before any await. Three regressions verify that old receipt, token-preflight and ordinary native-balance results cannot commit after the same account/network context is restored.

## Adversarial follow-up

A second review and actual approval-flow testing found additional problems in the initial PR snapshot:

- Approval responses checked the initial `external.html` path even after the same document routed to a signing screen. The popup now registers its browser window/document, receives a private challenge and binds its ServiceWorker client before routing. Only that client and approval nonce can complete the request. Authenticated responses survive an immediate popup close while the requesting document's liveness is checked. An abandoned, unbound popup expires after ten seconds; recovery controls appear near 1.8 seconds and valid late handshakes remain accepted.
- Returning from login concatenated decoded signing data into a URL. Encoding that data preserves literal delimiters and Unicode through the login and signing routes.
- Wallet creation could navigate using an older locked status, just as unlock could. Both import and new-wallet creation now confirm a fresh status before entering Home; a failed confirmation returns to the existing-wallet login path.
- Home and account-consent controls now remain inert during context changes or worker unavailability. Seed/private-key/wallet-removal screens unmount on lost worker connectivity. Case, trailing-slash and encoded-path aliases receive the same guards as canonical routes. A shared lifecycle port detects worker disconnection immediately, and focus/visibility changes revalidate cached status rather than waiting for the periodic poll.
- Controller status reads now disable the transport's additional connection retries. The shared poller owns recovery, so one status check has a 1.8-second deadline instead of extending that deadline with transport backoff. Other controller operations retain their existing retry behavior.
- A tab could navigate after the background selected notification recipients. The injected notification now checks the exact approved origin again immediately before dispatching account or xpub data.
- Delayed network activation, vault reads and queued persistence could restore old state after reset. Reset generations and ownership checks protect hydration, caches, persistence and completion callbacks. New network requests are rejected while reset is in progress. Reset drains serialized writes and clears the live vault before releasing the persistence lock. Valid source-vault snapshots are queued before target activation so ordinary cancellation does not discard unsaved source data. Cancelled switches and explicit keyring setup failures reject instead of returning a successful chain result. Ordinary cancellation can restore an uncommitted source vault; a reset can never trigger that stale rollback. If cancellation happens after session transfer during first-account derivation, a queued switch on that target completes guarded initialization before reporting success. Existing accounts and their metadata are preserved. Creation and reset serialize with authentication; creation also rejects stale completions and prevents a network switch from taking its partially initialized session.

The upstream keyring follow-up also fixed retry after interrupted legacy migration, validated legacy inner-secret decoding before rewriting the vault, and made secret-buffer clearing independent of random-number generation. The upstream source for that snapshot is `15dd94f`, with 28 focused WebCrypto regressions and 300 passing tests across 19 suites. Local and GitHub Codex code/security reviews found no remaining issues on that upstream commit. Pali's installed validation package matches all 116 files from its local npm pack; this is not an npm publication.

### Prior validation snapshot: authentication and routing

The source commit for this prior snapshot is `dd73ffb927fcb60260f989d08379aad00b5af5ed`, with runtime-source fingerprint `aec0d3cf52578c4765998753486f83ad98cb79d061bfd1ff8380869a98648413` (scope and dependency artifact recorded in the evidence JSON). The scoped suite passes **120 suites, 1,052 tests**. TypeScript and the isolated production Chrome webpack build pass; ESLint reports zero errors and six existing warnings. This build uses the upstream keyring package for that snapshot and omits ZIP packaging and the bundle visualizer.

All size budgets pass. Final app JavaScript is 1,481,546 bytes, external-page JavaScript 1,478,526 bytes, background JavaScript 4,235,977 bytes, and content-script JavaScript 14,784 bytes. The unpacked extension is 8,458,621 bytes. Fresh Start loads 1,493,155 bytes of JavaScript, **37.25% less than the original-checkout baseline** above; this is not a comparison against current master.

Four disposable-profile Chrome checks pass for that snapshot. Routed connection, personal signing and typed signing return verified results; a forged main-view response and a cloned approval URL in another window cannot complete the request. Locked approval routing preserves literal URL delimiters. A delayed handshake displays recovery in 1,862 ms and accepts its valid late reply. Correct-password unlock after confirmed worker restart takes 185 ms and remains on Home after 2.2 seconds. Terminating an unlocked worker removes a revealed seed in 4 ms; it never reappears after reconnect or protected-route revisit without authentication. Eight hostile dapp fixtures at 4x page CPU throttling reject within 4.9 ms, open no approval and record no page long tasks. These are individual local samples on the hardware stated above, not percentile or worst-case guarantees.

The local Codex loop reviewed the full PR, then found the interrupted-account-initialization race in a follow-up diff. The repair includes a reproducer using two public network-switch requests and the real serialization mutex; Codex's subsequent review found no actionable regression. The full test suite and Chrome checks above were rerun on the resulting source.

**Publication status at that snapshot:** npm returned E404 for keyring 1.0.612. That version has since been published. The local package validated the reviewed source but did not establish a successful registry install. The newer core 1.0.29/keyring 1.0.613 follow-up has a separate publication and clean-install gate.

## Smart-account deployment follow-up

A disposable Chrome extension profile reproduced a deployment failure against an isolated EVM: the first contract was mined, the next send reused a cached pending nonce and failed with `nonce too low`, and the settings card retained its old missing count. The local-account deployment path now obtains a fresh pending nonce through a raw RPC call and advances its nonce floor after each acknowledged transaction.

Infrastructure reads now expire and can be explicitly refreshed. Each send rechecks the contract's code, and context checks stop remaining unsigned work when the account, network, provider or wallet session changes. Deployment jobs and pending records are independent per chain; status caches also distinguish RPC endpoints. A pending transaction on one chain does not prevent deployment on another. General infrastructure deployment has no zkSYS-only gate; precompile-dependent features retain their separate network requirements.

The settings card refreshes after success or failure, periodically checks pending work, and refreshes on focus. Unknown status is not presented as missing CREATE2 support. Mutations are never automatically retried. Slow status and deployment operations display translated explanatory feedback after 1.2 seconds, reserving time for route transitions; slow RPCs and chain confirmations may continue after that feedback appears. All new strings exist in the nine supported locale files and use the configured English fallback without inline `defaultValue` strings.

The journal is internal recovery data. The settings card displays readiness, the remaining-contract count and pending status, with a manual status check; it does not display a per-contract journal or transaction history. Fresh on-chain checks also recognize infrastructure deployed by another account.

The GitHub review also identified a queued network switch that could leave the persisted active-vault pointer behind the live state, and a stale account-removal confirmation on the Manage Accounts page. The pointer is now marked dirty at the actual cross-vault commit. Manage Accounts is guarded during transitions/disconnection; its portal confirmation is invalidated when context changes, and the background checks the expected account/network/vault context before removing any data.

A small public per-chain journal records a unique attempt before broadcast and upgrades it with the acknowledged transaction hash. It is independent of the currently selected vault, and storage failures are not treated as an empty journal. Receipts must identify the expected hash; stale readers can clear only the attempt they observed. Locally selected nonces allow a fresh mined nonce to identify consumed, cancelled or replaced attempts. Definite pre-broadcast rejections release their reservation; ambiguous failures retain it until chain evidence resolves the outcome. An unknown or dropped attempt with neither deployed code nor a mined nonce advance remains conservatively pending. Hardware paths choose their own nonce in the current upstream package, so recovery trusts a hardware nonce only after acknowledgment. If the first journal upgrade fails after broadcast, the controller retries that same attempt with the recovered hash and validated acknowledged nonce. Both hardware-account regressions then recover a reverted receipt after worker restart. Permanent storage failure still retains the reservation; physical device signing remains untested.

The upstream keyring also classifies errors at the actual broadcast boundary. Fee lookup, gas estimation and device-signing failures before broadcast are marked as safe to retry; a provider error after a broadcast attempt cannot inherit that marker from an earlier call. Pali similarly marks its own pre-sender failures. A reservation write that finishes after its timeout is cleaned up by exact attempt identity because the sender was never invoked. A successful late clear also removes the same known-unsent attempt from memory, allowing retry without restarting the worker; a failed clear retains the reservation and an older clear cannot remove a newer attempt.

Status reads have one 18-second total budget and a 1.8-second batch-probe deadline, leaving time for individual RPC fallback. The UI transport waits up to 20 seconds while explanatory feedback remains visible from 1.2 seconds. Tests cover a hung batch with working four-second individual calls, an exhausted overall budget and the longer UI transport deadline. Terminal history entries cannot mask a later pending deployment.

Local Codex review also found that the upstream hardware signer returns a generic signature-failure error when a device operation is rejected. Recognizing that exact pre-broadcast failure for hardware accounts releases the reservation; the same text from a local account remains ambiguous. Regression tests exercise cancellation, restart and retry for both hardware account types.

The follow-up review also reproduced a separate EIP-5792 batch-submission issue in Chrome. A local EVM accepted a `wallet_sendCalls` transaction while its RPC acknowledgment was withheld. Navigating the requesting dapp closed the popup and allowed the same app-provided bundle ID to open another signing prompt. Returning an RPC error after acceptance also left the original popup's Sign button enabled. These are dapp batch-submission paths, separate from the infrastructure deployment journal.

Batch submission now persists its boundary before invoking a sender. A unique approval reservation and a separate identity for each send reject stale cleanup, progress and completion messages. Each acknowledged hash is saved before sending the next call. Unknown submissions retain duplicate-ID protection across navigation, worker restart, expiration and capacity pressure; a full registry rejects new work instead of evicting an unresolved submission. Known partial failures can finish with status 600, definite failures before any broadcast with 400, and uncertain submissions remain 100. The popup stops remaining work and disables retry after an uncertain send or an acknowledged hash that could not be persisted. Explicit pre-broadcast failures remain retryable. The explanation is translated in all nine locales.

Validated broadcast facts survive the controller error boundary and smart-account error normalization. The shared smart-account submission helper and EOA batch sender disable automatic transport replay; a signature-metadata retry is allowed only before submission or after an authoritative pre-broadcast rejection without an acknowledged hash. A fresh request with a different bundle ID is still a separate request: this protection does not infer duplicate intent from transaction contents.

The handler also binds EOA batches to the approved account, chain, RPC and vault. The sender checks that context before and after asynchronous preflight and immediately before entering the keyring, supplies the approved chain ID explicitly, and stops remaining unsigned calls if context changes. An acknowledged hash is retained if context changes before history persistence.

The 500-account fixture exposed a separate hardware setup launch issue: the menu's `window.open` child lacked extension runtime APIs and stayed at bootstrap recovery, whereas direct navigation read the same 308,828-byte wallet state in 4 ms. Both hardware setup entry points now use `chrome.tabs.create`; the same fixture then read its state in 5 ms and displayed the device choices. No physical hardware signing was performed.

Abruptly closing that hardware tab without an unload event also left a recent stored popup flag, blocking subsequent dapp approvals for five minutes. Hardware and dapp views now use one background creation guard. Live extension contexts and tab URLs, including pending navigation, determine exclusion; stored flags only notify the UI. The guard covers the Chrome creation callback, releases on failure and refuses to create when browser detection fails. The main wallet rechecks external-tab closure without interrupting ordinary browsing.

The same 500-account fixture exposed a consent-screen bottleneck: all accounts mounted balance loaders, and incoming balance updates reinitialized the connection selection. At 4x page CPU throttling, the original connection screen took 2.57–2.72 seconds to become actionable and 3.64 seconds to confirm. Connection and account-change consent now render 50 matching accounts initially, search every eligible account, and support loading more. The selected account remains visible even outside the search results; account-change consent also preserves the currently connected account. Balance updates cannot reset the proposed selection. The shared balance component subscribes only to the network state it needs.

A subsequent restart of the retained fixture found another real failure: all 500 accounts and the selected account were present, but the persisted `isSwitchingAccount` flag kept Home blocked after successful unlock. A synchronous dapp account switch can save that transient flag before clearing it in memory. Cold background initialization now clears orphaned activity flags before exposing the controller; frontend rehydration still preserves live activity guards. Failed account-switch persistence also releases its own loading flag. Neither change alters the selected account or deployment/submission journals.

### Deployment and large-wallet validation snapshot

Pali source `870845125220ca48b1d20efa3d964e35ccf7fbb2` and runtime-source fingerprint `42edecd60b5f399531b90c52c0df27ba426fef5db9cf134535bf233e20ce99e3` pass **135 suites and 1,263 tests**. The source package is upstream keyring `5e253bf4c6be7431d9608c4d0168d85fba7e5b09`; all 116 installed packed files match its local tarball. That upstream revision passes **20 suites and 315 tests**, including 30 authentication and 13 broadcast-boundary regressions. TypeScript, production Chrome webpack, translations and bundle budgets pass; ESLint has zero errors and six existing warnings.

The production Chrome fixture deploys all ten infrastructure contracts on four isolated EVM chains. Chain B completes while A remains pending. Revisiting A and restarting the worker preserve its pending attempt; refreshing status does not resend. Switching networks while an RPC acknowledgment is withheld and terminating the worker before another acknowledgment both preserve the original attempt. After mining, each affected chain resumes only its remaining contracts and finishes with exactly ten deployment transactions. Slow status feedback appears in **1,329 ms from navigation** and deployment feedback in **1,308 ms from clicking Deploy**.

The same build passes approval, idle-unlock, secret-disconnect and hostile-request checks. The delayed approval handshake shows recovery in **1,882 ms**; valid personal/typed signatures and locked routing remain functional. A standalone hardware page routes normally, excludes overlapping dapp prompts and permits dapp approvals again after closing. These are popup coordination checks, not physical-device signing. Correct-password unlock after a confirmed worker restart takes **163 ms**, with Home remaining stable. Worker termination removes a revealed seed in **3 ms**. Eight hostile requests at 4x page CPU throttling reject within **4.5 ms**, without an approval page or recorded page long task.

The sendCalls Chrome checks hold a real local-chain broadcast acknowledgment, navigate the requesting dapp, and verify that the original bundle ID rejects with 5720 both before and after worker restart. A second check returns an RPC error after chain acceptance: the popup disables Sign, shows the translated uncertainty message, and status remains 100. Both fixtures finish with exactly one transaction. Two separate two-chain checks switch networks after the first call is accepted. Interrupting its RPC acknowledgment keeps the outcome pending at 100; switching after the acknowledgment but before the second call retains the hash and reports the partial batch as 600 on its original chain. Neither case sends a second transaction.

The retained-profile run verifies the executing service-worker script hash against the rebuilt bundle before timing. It reopens the same wallet that previously restored an orphaned account-switch flag. The large-wallet fixture contains **500 real HD accounts** derived through the wallet controller, sharing one EVM vault with zero balances and no asset/history load. Each operation has three samples at normal speed and at 4x page CPU throttling. The background worker and local RPC are unthrottled. Stable Home means an actionable account header and settled native balance; independent transaction-history loading is excluded. The machine is an Apple M5 Max with 18 logical CPUs and 48 GiB RAM.

| Operation | Normal median / max (ms) | 4x UI median / max (ms) |
| --- | ---: | ---: |
| warm reopen to stable Home | 200 / 207 | 368 / 395 |
| open account selector | 170 / 175 | 349 / 364 |
| select another account to stable Home | 150 / 158 | 539 / 560 |
| open Manage Accounts | 100 / 106 | 295 / 324 |
| cold worker reopen to login ready | 379 / 394 | 445 / 471 |
| correct password unlock to stable Home | 229 / 250 | 321 / 323 |

The closed selector has zero mounted account rows. Keyboard opening, Escape/focus restoration, reopening, first/last account selection and hardware setup entry are checked. Cold-worker fixtures explicitly persist the selected account outside the timed phase; ordinary session-only selection behavior is unchanged. The same fixture then opens hardware setup from the actual account menu and abruptly closes its tab; the main wallet and subsequent approvals recover without waiting for a stale flag. Separate connection and account-change consent checks run at 4x page CPU throttling with balance reads queued. Search reaches the last account, selected/current accounts stay visible under no-match searches, arriving balances preserve selection, and approval returns the expected account.

| Consent check (4x UI CPU) | Actionable (ms) | Search/select max (ms) | Confirm (ms) |
| --- | ---: | ---: | ---: |
| close connection approval with cached balances | 600 | — | — |
| select first/last and confirm while balances load | 571 | 343 | 205 |
| request permissions with selected/current accounts pinned | 583 | 373 | 153 |

These consent lists initially mount at most 52 accounts (50 results plus selected/current accounts) rather than all 500. The first round used cached balances and verifies approval closure/rejection; the later rounds exercise arriving balance updates. Background balance reads remain independent of the usable consent controls.

Fresh Start loads **1,494,440 bytes** of JavaScript, **37.2% less** than the original-checkout baseline. The unpacked extension is **8,522,724 bytes**; the background bundle is **4,277,963 bytes** against its 4,300,000-byte budget. These are local samples, not percentile or worst-case guarantees. Source/dependency fingerprints, fixtures and timings are in the `smartAccountFollowup` entry of [security-responsiveness-evidence.json](security-responsiveness-evidence.json).

## RPC identity and Firefox follow-up

Runtime source `76e9f44dada1bae28b8b50ababf5ef49dc220c9a` has fingerprint `d72cae6d6e0b2a0836caa762d410c71e8d41cba13284802bbc0c75b7f315c9aa`. Validation used a clean Git archive with the reviewed local dependencies, not a clean registry install. The test-only receiving-origin correction supplies Istanbul bookkeeping when executing the real serialized browser callback in an isolated context.

Window ownership now compares the URL protocol and host with `runtime.getURL('/')`, accepting Firefox's `moz-extension:` UUID host as well as Chrome. The 56 focused tests cover approval and hardware routes, live/pending tabs, foreign extensions, lookalike hosts and recovery after closure. The existing recovery messages are translated in all nine locales without fallback text in the calls.

Those window tests do not establish full Firefox support. Both the base and current normal Firefox targets generate a service-worker-only Manifest V3 background, and the base approval response path already requires `navigator.serviceWorker.controller`. Firefox does not support that background configuration ([Mozilla documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background#browser_support)). A background-page manifest and authenticated transport are separate platform work; this Chrome-focused change does not silently weaken document binding to accommodate that unsupported path.

One unresolved infrastructure deployment now owns its chain ID across RPC aliases. The durable v2 journal records the original exact RPC URL: another endpoint exposes the reservation as pending and cannot reconcile or clear it. In-memory jobs and journal writes serialize by chain ID, including a second request arriving before the first journal write. Different chain IDs still deploy concurrently. Legacy v1 pending records lack RPC identity and remain conservatively pending. No migration is provided for the never-shipped endpoint-qualified v2 format from the intermediate PR revision. Seventy-five focused tests cover endpoint aliases, stored worker recovery, concurrent admission and stale completions.

The combined suite passes **136 suites and 1,291 tests with coverage enabled**, plus TypeScript, scoped lint and the production Chrome build. Fresh disposable Chrome profiles repeat the four-chain infrastructure and approval/hardware tests. Switching to an alias of the same chain cannot duplicate a pending deployment, including after a worker restart with an unknown acknowledgment. All four chains finish with exactly ten deployment transactions. Status feedback appears in **1,322 ms**, deployment feedback in **1,351 ms**, and delayed-approval recovery in **1,898 ms**. Personal/typed signatures, locked routing, hardware exclusion and recovery after hardware-tab closure pass with no recorded background errors.

Fresh Start loads **1,494,387 bytes** of JavaScript, **37.2% less** than the original baseline. The background is **4,279,812 bytes** and the unpacked extension **8,524,585 bytes**; all size budgets pass. The 500-account timings above remain explicitly tied to runtime `87084512`; they were not rerun for these narrow changes. Detailed follow-up data is in `rpcAndFirefoxFollowup` in the evidence JSON.

At this snapshot, a separate focused cryptography and key-management review had eight open findings. Their subsequent remediation is described below. These regression results and prior review completions are not a cryptographic security sign-off.

## Network-removal follow-up

Source `70502d7d22ca518a8a29ba7f53596c2f58d862da` has runtime fingerprint `0aa24dc5a635c6121dfab025d92865ccf6444d1bca93115bb7f32479ebb77390`. A slow network switch must not allow deletion of the vault it is still loading. Network edit/custom-RPC pages now remain inert through context changes, including route aliases. A confirmation already open in a portal is hidden and cleared when a transition starts or the background becomes unavailable; its callbacks recheck live state.

The background independently rejects removal during switches and refuses active-network or active-UTXO-vault deletion. Removal reserves synchronously, rechecks session and network identity at lock boundaries, and awaits vault cleanup under the network-switch and persistence mutexes. New switches, edits and additions cannot race that cleanup. An addition that was already awaiting metadata rechecks before committing. Storage errors propagate and the reservation always releases. The UI consumes failures, shows a neutral message translated in all nine locales, and clears only the completed request's selection.

At this network-removal snapshot, the combined suite passes **138 suites and 1,337 tests with coverage enabled**, including 23 new backend removal regressions and nine network-management UI tests. TypeScript, scoped lint, translation consistency, independent review and the production Chrome build pass. Validation uses a clean Git archive and the same reviewed local dependency package.

Fresh Start loads **1,494,543 bytes** of JavaScript, **37.2% less** than the original baseline. The background is **4,281,681 bytes** and the unpacked extension **8,528,108 bytes**; all budgets pass. The preceding four-chain/alias/approval browser checks remain bound to runtime `76e9f44d`; the 500-account measurements remain bound to `87084512`. They are not relabelled as reruns of this later guard change. The separate crypto findings were still open at this snapshot.

## Cryptography and key-management remediation

The focused review identified eight concrete findings, using synthetic keys, offline signing and disposable browser profiles. All eight now have source fixes. The follow-up targets core **1.0.29** and keyring **1.0.613**; published **1.0.612** does not contain these newer library corrections. Final package and combined-build validation are recorded separately below.

| Finding | Source correction |
| --- | --- |
| C1: onboarding secrets in browser history | Passwords and phrases stay in a short-lived React provider. Routes receive no secret state; completion, cancellation, route exit, hiding and page unload clear the provider. Current legacy history entries are scrubbed, but this cannot erase copies previously written to browser session files. Password submission is serialized. Once creation is requested, the UI clears its secrets and cannot replay it after a lost reply; the background also rejects concurrent creation and checks durable wallet presence inside its mutex before any reset. Uncertain creation reloads the app document so bootstrap cannot reuse a pre-creation state snapshot. |
| C2: unacknowledged external P256 ownership | Wallet-managed account preparation rejects dapp-supplied P256 configuration before any credential or account operation. An id-only passkey request creates a wallet-owned credential; standard local ECDSA ownership remains supported. |
| C3: signing outside the approved UTXO account | Approval captures the connected account and network. Signing checks session/context at asynchronous boundaries and authenticates paths, public keys and actual spent scripts against the selected account. Full-root derivation remains bounded. Standard P2WSH, wrapped P2WSH and P2SH multisig can sign the selected member; foreign hints are hidden from the signer and restored only to non-finalized output PSBTs after signing, so another cosigner can continue. Joint transactions do not sign foreign inputs and require an authenticated unfinished input from the selected account when unfinished inputs exist. Hardware conversion preserves finalized foreign inputs: Trezor receives them as `EXTERNAL`, and Ledger retains their final fields. |
| C4: destructive passkey replacement | A replacement uses an independent random user handle. It cannot replace the credential-manager entry still needed by an active composite policy. Failed rotations preserve the original credential and the pending replacement. |
| C5: deleting a possibly installed passkey | Pending credential metadata is saved under the account before installation. Confirmed adoption is recorded before hydration, and completion clears only the matching creation slot. Cancelled, failed or restarted flows do not automatically signal credential deletion or prune older credentials. Persistence failure stops installation or retains recovery records. |
| C6: swallowed asynchronous storage failures | Core storage methods return the actual write/removal promises. Keyring migration awaits them and orders profile/ciphertext writes so a rejected write remains retryable instead of silently discarding recovery metadata. Fresh creation uses an atomic create-if-absent capability for the salt/ciphertext pair. Native extension storage holds a Web Lock across the absence check and one batch commit; custom/shared backends must provide an explicit atomic capability. Failed encryption or writes leave no orphan record, and a failed write releases the lock for retry. |
| C7: incompatible fallback derivation | New encrypted writes require WebCrypto and AES-GCM. Authenticated legacy data can select a persisted 20,000-round profile; new wallets use the existing 900,000-round profile. Profile persistence precedes rewrapping, rejected writes preserve readable state, and later successful unlock can retry a pending rewrap. Existing account-key wrapping is preserved; this is not a claim that every historical key has been re-encrypted with stronger parameters. |
| C8: Trezor transaction-field loss | Conversion preserves locktime and explicit sequence zero without mutating the previous-transaction hash. Returned version, locktime, inputs, sequences and outputs must match the approved unsigned transaction before witness data is accepted. A mutated device reply is rejected rather than imported, and finalized foreign inputs remain intact. |

Independent offline checks exercise the real new keyring/HD signer for all three multisig forms: only the selected account signs, same-wallet other-account hints gain no signature, foreign-only unfinished PSBTs reject, existing external signatures survive, and a standard external cosigner with a different derivation path can complete the returned partial PSBT. The passkey tests exercise real component handlers with synthetic controllers, and a disposable Chromium authenticator confirms that independent user handles preserve the old credential. No real wallet, live hardware signature or funded broadcast was used for these crypto regressions.

The preceding validation snapshot uses Pali runtime `0235f38f167a9dc8a54570a9e5ec9aa71a2c72b8`, runtime fingerprint `c3819c8a61f1a1561916a556992460dbde34566eb020efb28fb94ab433e86010`, and [sysweb3#16](https://github.com/sidhujag/sysweb3/pull/16) commit `2a0f9bcb6ac099286da93c99b8363ef900748305`. All **127 packed package files** match the rebuilt upstream artifacts. No local dependency patch is shipped.

- **148 Pali suites / 1,424 tests** pass with coverage, plus TypeScript, translation checks, production webpack and bundle budgets. Full-snapshot ESLint has zero errors and two existing warnings. **31 upstream workspace suites / 467 tests** pass across keyring, network and utils; both package builds pass.
- Real Chrome fault injection confirms that a rejected fresh-vault batch leaves no salt or ciphertext, retry works after worker restart, and stale setup documents cannot replace a completed wallet before or after worker restart. A withheld successful creation acknowledgement triggers a full new bootstrap, recovers the existing wallet, and preserves the original password. A controlled cross-context creation race produces two winners with an unguarded check/write sequence, but only one winner and one matching salt/ciphertext pair with the atomic capability. Rejected writes release the Web Lock for retry.
- Current Receive and Faucet browser checks pass. Receive hides its address, QR code and copy control during unresolved context changes; Faucet claims stay inert after the two-second overlay becomes nonblocking. Both recover after the context settles, while header navigation remains available.
- Current real Chrome creation, import and reload flows pass. After closing each disposable profile, the password and recovery phrase have no plaintext matches in the inspected profile files. These checks prevent new persistence; they cannot remove old filesystem copies.
- Current approval ownership, cloned-window rejection, personal/typed signatures, locked routing and hardware-window exclusion/recovery checks pass. Delayed approval feedback appears at **1,876 ms**, with no recorded background errors. This tests window coordination; no physical device signed.
- The preceding `363ab482`/`16baa93` snapshot verified four isolated EVM chains each finish all ten deployments without duplicate sends. Pending chain A does not prevent B; switching RPC aliases, withholding acknowledgements and restarting the worker retain the original attempt. Status and deployment feedback appear at **1,328 ms** and **1,311 ms**.
- Fresh Start loads **1,498,386 bytes** of JavaScript, **37.0% less** than the original baseline. Background JavaScript is **4,271,961 bytes**; the unpacked extension is **8,537,288 bytes**. All budgets pass.
- The current installed-graph primitive checks pass 240 BIP39 vector cases, 34 BIP32 assertions, 14 invalid extended-key cases, 15 BIP340 verification/four signing cases, 128 deterministic low-S ECDSA cases and 128 elliptic verification cases. EIP-191/EIP-712 recovery, known digests, invalid scalar rejection and AES-GCM tamper/wrong-key rejection pass. Variable-message BIP340 vectors beyond the adapter's 32-byte interface are explicitly excluded.

A scoped local Codex review of earlier follow-ups drove the atomic-write, joint-signing, durable-admission and full-bootstrap corrections above. All eight findings have source fixes; that is not blanket security assurance. GitHub code reviews completed without actionable findings on Pali runtime `0235f38f` and sysweb3 `2a0f9bc`; separately requested security reviews are not yet confirmed complete for those revisions. The native atomic-create capability requires the actual `chrome.storage.local` or `browser.storage.local` adapter identity and Web Locks. Its lock covers the absence check and batch commit within that extension-origin storage partition. Custom or shared backends require an explicit atomic `createItemsIfAbsent` implementation; the built-in memory backend provides one. Sequential-only adapters fail before writing. Offline hardware regressions cover finalized foreign inputs and reject transaction-mutating replies; no physical device was used.

The six affected public user/developer guides are synchronized across English, Spanish, Portuguese, French, German, Russian, Chinese, Japanese and Korean. All nine production locale builds and all 54 updated routes pass validation. The guides describe supported behavior directly, including interrupted setup, unlock recovery, context guards, passkey changes and account-scoped PSBT signing.

The exact artifacts, timing scope and reports are recorded in `cryptoFollowup` in [security-responsiveness-evidence.json](security-responsiveness-evidence.json). The **05:26 UTC** registry check still returned E404 for core **1.0.29** and keyring **1.0.613**. The package owner must publish core first, then keyring, and clean registry CI must be rerun before release. Local source-package validation does not satisfy that publication requirement.

The earlier 500-account timings remain bound to `87084512`; the four-chain deployment checks remain bound to `363ab482`/`16baa93`. Earlier loading reductions, approval timings and suite counts retain their original snapshot boundaries. They do not become measurements of the current snapshot. This work does not establish a whole-library proof, constant-time behavior, complete SLH-DSA known-answer coverage, reproducible WASM provenance, or physical-device compatibility. See [unlock and migration behavior](keyring-unlock-errors.md) and [loading strategy](loading-strategy.md).

## PSBT compatibility and complete review-thread reconciliation

A later base-versus-head reproduction confirmed a real regression: selected-account key-path Taproot inputs carrying a derivation path but omitting `tapInternalKey` signed with published keyring 1.0.612 and were rejected by the account guard. The guard now derives the candidate public internal key, applies any supplied Merkle root, and requires its P2TR output to match the actual spent script before private signing. Missing-key inference rejects `tapLeafScript`, `tapScriptSig`, and nonempty BIP371 leaf hashes. Existing explicit-key behavior is retained. This restores the supported key-path cases; it does not add script-path, MuSig or hardware Taproot support.

The older Ledger review comment also remained applicable after finalized-input preservation was implemented. Enrichment now skips a finalized SegWit input when it already carries `witnessUtxo`. Unfinished inputs missing `nonWitnessUtxo` and finalized inputs lacking both prevout forms retain the existing lookup requirement. Offline real-PSBT tests cover native and nested SegWit finalized inputs, plus both negative controls. Device responses are mocked.

The combined source is sysweb3 `2a575108be2306d5a007dbd997c2f9903e411e03`, installed as exact local core 1.0.29/keyring 1.0.613 packs into a clean archive of Pali `120eab6a` (unchanged runtime `0235f38f`, fingerprint `c3819c8a61f1a1561916a556992460dbde34566eb020efb28fb94ab433e86010`). All **127 packed files** match rebuilt upstream files and the installed copies. The keyring archive SHA-256 is `691561ab4b12b789ba709241da2d8c8825f1ad567f0961777a4f53cc369f308f`; core remains `9b105282a91ea87ca3fc4c14f9910e8fc558820baa93b9976cacfecdba41d235`.

- **32 upstream suites / 485 tests** pass. All **14 Taproot tests** and **10 Ledger finalized-input tests** pass, including regressions demonstrated failing before their repairs. A separate six-suite review run passes 136 tests.
- **148 Pali suites / 1,424 tests** pass with coverage using those installed packages. TypeScript, production Chrome build and bundle budgets pass. The compiled installed public signer produces valid Schnorr signatures for the three restored Taproot variants and explicit-key controls.
- Fresh Start still loads **1,498,386 bytes**, **37.0% less** than baseline. Background JavaScript is **4,272,146 bytes**, and the unpacked extension is **8,537,473 bytes**.
- Earlier UI, creation, passkey, infrastructure and documentation browser results retain the source boundaries above; those runs are not relabelled as reruns of this PSBT change. No physical hardware signed.

Every reported review thread was checked against source rather than relying on its resolved flag:

| PR | Reconciled result |
| --- | --- |
| sysweb3 #16 | All five reported findings have source fixes and regression coverage: finalized hardware inputs, existing-record initialization, cross-context creation, finalized witness enrichment, and script-path metadata in inferred Taproot keys. |
| Pali #851 | Eleven of thirteen findings are implemented. Package publication remains an applicable release prerequisite. The Firefox background-page approval transport is not implemented; the default base and current manifests/transports already lack that platform path, so this is recorded as a pre-existing unsupported path, not a completed fix. |

The fresh code review of sysweb3 `2a575108` [completed without reporting major issues](https://github.com/sidhujag/sysweb3/pull/16#issuecomment-6075223604); all five reported threads are resolved. The exact head and result are recorded in `psbtCompatibilityFollowup.review` in [the evidence file](security-responsiveness-evidence.json). Earlier no-new-finding review responses are not evidence that all older comments were addressed. The separate security-review summary has no confirmed completion for this new head. The source/test matrices, failed-before/passed-after reports and latest package/build data are recorded separately from the previous snapshot.

The refreshed registry check still returns E404 for core 1.0.29 and keyring 1.0.613. The owner must publish core first, then keyring, followed by clean registry CI. Neither a package publication nor a merge was performed.

## Dependency findings

The read-only production-dependency audit reported 381 dependency-path findings: 3 critical, 241 high, 131 moderate and 6 low; these represent 57 distinct GHSA URLs across 18 packages. Build/test tools are also listed under this project's `dependencies`. These counts are not counts of reachable extension exploits.

| Package/path | Assessment and follow-up |
| --- | --- |
| axios 1.18.1 | Browser adapter is emitted. Review a scoped update to at least 1.20.0 and test RPC, hardware/CDN, timeout, cancellation and FormData behavior. Node HTTP/2/proxy findings do not directly describe this browser adapter. Prototype-pollution gadget findings require a separate pollution primitive; this pass did not establish one. [Advisory](https://github.com/advisories/GHSA-vh66-26gq-q6x8), [advisory](https://github.com/advisories/GHSA-r4gj-5m52-g5wh). |
| pbkdf2 3.1.6 | The bundle uses `lib/sync-browser.js`; the new repeated-long-password-prehash issue concerns `lib/sync.js`, which the browser mapping replaces. Consider 3.1.7 after derived-key known-vector checks. Do not present it as a demonstrated Chrome exploit fix. [Advisory](https://github.com/advisories/GHSA-477h-4r7f-fvrx). |
| elliptic 6.6.1 | Emitted through hardware-wallet dependencies; advisory describes risky/non-constant-time implementation and lists no patched release. Upstream replacement needs signature/address/hardware vectors. No remote key-extraction exploit was demonstrated here. [Advisory](https://github.com/advisories/GHSA-848j-6mx2-7j84). |
| react-router(-dom) 6.30.4 | Review patch 6.30.6 for one redirect issue; another backslash issue lists 7.18.0. A major router migration needs navigation tests. The SSR hydration issue does not describe this client-rendered extension. [Advisory](https://github.com/advisories/GHSA-jjmj-jmhj-qwj2), [advisory](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6). |
| protobufjs 7.4.0 / 7.5.5 | Installed through Trezor dependencies but absent from the recursively inspected emitted module graph. The critical schema issue requires attacker-controlled descriptors; no such shipped path was identified. Later advisories require versions through 7.6.5. Track upstream updates. [Advisory](https://github.com/advisories/GHSA-xq3m-2v4x-88gg). |

No blanket dependency upgrade was applied. The dependency assessment distinguishes advisory presence, emitted modules and demonstrated reachability; it does not prove absence of vulnerabilities.

## Limits and release follow-up

Account-data preservation, bounded request work and the additional findings above have targeted fixes. Corrupted data still needs a deliberate recovery implementation, and unusually large valid requests may exceed wallet policy. Dependency updates and real-device release testing remain follow-up work. Hardware prompts, slow RPCs, cryptographic operations and chain confirmation can legitimately take more than two seconds. Feedback and safe navigation are the target; an arbitrary timer must never authorize, cancel an already broadcast transaction, invent a successful network switch, or imply that an unknown submission failed.

Expand release testing to real Ledger/Trezor devices, older supported Chrome versions, low-memory devices, large restored wallets and malicious payload fixtures. Initial rendering was bounded and measured, but every combination of account/network/hardware state has not been exercised. Keep the size check in the production release process:

```sh
yarn test source tests --runInBand --coverage=false
yarn type-check
yarn build:chrome
node scripts/check-bundle-size.js build/chrome
```

The unrestricted root Jest command also discovers unrelated pre-existing Playwright files under untracked `artwork/`; the scoped project command above excludes that directory. No files in `artwork/` were changed.
