# Pali Wallet security and responsiveness review

Review date: 2026-10-08. Scope: the Chrome extension in this checkout, its installed dependency graph, production bundles, and disposable Chromium profiles. This is a code review with targeted fixes and runtime checks, not a formal cryptographic audit or a certification that every wallet operation finishes in two seconds.

## Upstream keyring release

Pali 4.0.70 targets keyring 1.0.612 from [sidhujag/sysweb3#15](https://github.com/sidhujag/sysweb3/pull/15). No package patch is included here. The package will be published separately; until then validation uses its upstream source build. Earlier patched-dependency measurements below retain their historical snapshot labels. Released keyring 1.0.611 still collapses operational errors into authentication failures and must not be substituted for the new version.

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

The source fix is tracked in [sidhujag/sysweb3#15](https://github.com/sidhujag/sysweb3/pull/15). It distinguishes operational errors from failed vault authentication and clears partially restored secrets. Genuine authentication failures still count. Encryption algorithms and stored key formats stay unchanged. Pali contains no package patch; Pali now targets the fixed 1.0.612 release, which will be published separately.

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

The ready Pali PR targets **4.0.70** and keyring **1.0.612**, rebased onto master `94a1cde5`. The dependency was built and locally packed from [sidhujag/sysweb3#15](https://github.com/sidhujag/sysweb3/pull/15), commit `27e4409`; no local package patch or Git dependency workaround is shipped. Publication of the npm artifact is handled separately, and its future integrity hash is not fabricated in the lockfile.

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

The upstream keyring follow-up also fixed retry after interrupted legacy migration, validated legacy inner-secret decoding before rewriting the vault, and made secret-buffer clearing independent of random-number generation. The final upstream source is `15dd94f`, with 28 focused WebCrypto regressions and 300 passing tests across 19 suites. Local and GitHub Codex code/security reviews found no remaining issues on that upstream commit. Pali's installed validation package matches all 116 files from its local npm pack; this is not an npm publication.

### Final validation snapshot

The final source commit is `dd73ffb927fcb60260f989d08379aad00b5af5ed`, with runtime-source fingerprint `aec0d3cf52578c4765998753486f83ad98cb79d061bfd1ff8380869a98648413` (scope and dependency artifact recorded in the evidence JSON). The scoped suite passes **120 suites, 1,052 tests**. TypeScript and the isolated production Chrome webpack build pass; ESLint reports zero errors and six existing warnings. This build uses the final upstream keyring package and omits ZIP packaging and the bundle visualizer.

All size budgets pass. Final app JavaScript is 1,481,546 bytes, external-page JavaScript 1,478,526 bytes, background JavaScript 4,235,977 bytes, and content-script JavaScript 14,784 bytes. The unpacked extension is 8,458,621 bytes. Fresh Start loads 1,493,155 bytes of JavaScript, **37.25% less than the original-checkout baseline** above; this is not a comparison against current master.

Four final disposable-profile Chrome checks pass. Routed connection, personal signing and typed signing return verified results; a forged main-view response and a cloned approval URL in another window cannot complete the request. Locked approval routing preserves literal URL delimiters. A delayed handshake displays recovery in 1,862 ms and accepts its valid late reply. Correct-password unlock after confirmed worker restart takes 185 ms and remains on Home after 2.2 seconds. Terminating an unlocked worker removes a revealed seed in 4 ms; it never reappears after reconnect or protected-route revisit without authentication. Eight hostile dapp fixtures at 4x page CPU throttling reject within 4.9 ms, open no approval and record no page long tasks. These are individual local samples on the hardware stated above, not percentile or worst-case guarantees.

The local Codex loop reviewed the full PR, then found the interrupted-account-initialization race in a follow-up diff. The repair includes a reproducer using two public network-switch requests and the real serialization mutex; Codex's subsequent review found no actionable regression. The full test suite and Chrome checks above were rerun on the resulting source.

**Publication remains a release blocker:** npm still returns E404 for keyring 1.0.612. The owner requested that version in advance and will publish it separately. The local package validates the reviewed source but does not make registry CI green. Publish the upstream artifact and rerun clean CI before merging or releasing Pali.

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
