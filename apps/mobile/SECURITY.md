# Security scope and release gates

## Current trust boundary

Native onboarding offers create, restore and watch-only choices. The native wallet development flow accepts test recovery phrases and uses the shared software keyring for creation/import, unlock and seed backup. Runtime crypto/storage checks and session capabilities are mandatory; UI visibility is never an authorization boundary. The development flow also supports public balances and receive address/QR/copy/share on seven built-in EVM networks. Password-confirmed native ETH signing and submission remain limited to Ethereum; the picker and portfolio do not grant unsupported signing capabilities. Account creation, selection, rename, eligible removal and restoration use a durable wallet-bound catalogue; up to 20 accounts may be active with derivation indices 0–4095. New indices are monotonic, removed indices remain restorable, and account zero or the selected account cannot be removed. The host binds the exact reviewed envelope and writes its encrypted signed-transaction journal before submission; explicit retries reuse those same signed bytes. Imported or hardware signing accounts, other assets, additional signing networks and dapp signing are not enabled by this flow. Switching accounts revokes stale operations without moving their journals; removal atomically prunes only a validated terminal journal or requires its continued absence. Full feature equivalence remains incomplete. An end-to-end native testnet transfer, physical-device behavior and signed release artifacts remain unqualified. The design preview has no authority and must remain isolated from real wallet state. No screen, URL or QR payload may enable an unsupported capability.

A native watch-only account may persist public addresses in platform protected storage. That does not establish a secure vault implementation. Public addresses and their association with this device still deserve privacy protection. Network requests disclose queried addresses to the configured service; never add an analytics, crash-reporting or address-enrichment service without a separate product/privacy decision.

Native custody uses an application-private SQLCipher database with a random device key in SecureStore, in addition to the SDK's password-encrypted records. A native directory adapter excludes the database from OS backups and rejects unexpected file types. Its lease admits one wallet owner within the current application process; cross-process exclusion is not established. Atomic record creation and wallet-bound backup receipts are mandatory. A missing key, a missing database after completed provisioning, corruption or a failed/ambiguous commit never authorizes erasure or replacement. SecureStore accessibility is not biometric authorization. Device compromise and an unlocked application remain outside the protection promised by database encryption.

PBKDF2/HKDF/AES-GCM are provided by narrow native key handles using CryptoKit/CommonCrypto on iOS and JCA/Bouncy Castle KDFs on Android. QuickCrypto supplies Node compatibility for SDK dependencies, not vault AES-GCM authentication classification. Production KDF parameters are unchanged. Only typed native authentication failures map to `OperationError`. Startup known-answer checks are capability checks, not an independent cryptographic audit.

Every native wallet session is revoked on background/inactive state and Android focus loss. Capture and app-switcher protection are requested before custody initialization and retained for the process lifetime. These APIs still require physical-device verification. Recovery words never enter public snapshots or the clipboard; JavaScript strings and keyboard memory cannot be guaranteed to be zeroized. Release builds remove console calls. No notification registration exists yet; adding it requires an explicit privacy design and must not grant custody authority.

Operation identity includes account, network, endpoint and a session/generation value. Returning from A to B to A is not the same authority context. Locking, backgrounding, account changes and network changes must invalidate pending work. A late network result cannot overwrite a newer context. Failed reads and unavailable balances must remain distinct from a valid zero or an absent account.

## Required before accepting wallet secrets

1. **One authoritative wallet.** Adapt the extension's tested operations behind explicit native interfaces. UI state is a projection, not authorization. Do not expose keyring records or generic method traversal across a bridge. Untrusted dapp content must not share a privileged wallet context.
2. **Native durable vault.** Preserve the shared keyring's password-encrypted vault envelope and recovery semantics. The native software host uses `KeyringStoragePort.createManyIfAbsent` to atomically create the direct logical record keys `vault` and `vault-keys`. The SQLCipher adapter serializes their values and commits both records in one transaction; `set` and `deleteItem` must also acknowledge completion. A sequence of independent writes is insufficient. Keep unsupported records intact and fail closed. Use an appropriate encrypted transactional store for large vault data; protected key/value storage is not a substitute for that store.
3. **Key access and backup policy.** Define native wrapping-key access, biometric invalidation, device migration, reinstall, OS backup exclusions, password fallback and deliberate export behavior. Biometrics do not replace recovery. A seed does not restore imported keys, passkey credentials or randomly generated private notes. Never silently discard unsupported records.
4. **Lifecycle and interruption.** Test process termination at every creation, commit, migration and recovery boundary. Reconcile interrupted writes before onboarding or rehydration. Test inaccessible key storage, storage exhaustion, successful writes with lost acknowledgments, failed deletion and resumed stale work. A read error must not authorize overwriting a vault.
5. **Secret lifetime and native privacy.** Keep secrets out of Redux, public snapshots, logs, telemetry, clipboard by default, app-switcher snapshots and untrusted web content. Verify secure input, screenshot/background behavior, keyboard/autofill handling and accessibility on actual supported devices. UI PIN dots are not authentication or brute-force protection.

## Required before transactions

- Use exact integer amounts and independent network identity checks. Show asset, complete recipient, account, network, amount and maximum fee before explicit confirmation. Invalidate review if its context or material transaction data changes.
- Persist the necessary intent/reservation before crossing a submission boundary. A timeout or process kill may mean broadcast acceptance is unknown. Reconcile using transaction/status evidence; never automatically retry a potentially accepted transfer.
- Qualify one native testnet transfer end to end before expanding support. EVM and UTXO/PSBT need separate acceptance. Test cancellation, duplicate taps, fee changes, insufficient funds, wrong chains, malformed responses and A-B-A races.
- Add dapp approvals, hardware transport, passkeys, smart accounts and private-note/prover operations only behind their own validated capabilities and threat models. Chain discovery is not proof that a feature works on that chain.

## Device and release qualification

Build and inspect signed release artifacts for both platforms. Test supported physical iOS and Android devices, including the slowest supported hardware, with cold start, unlock latency, large state, long histories, offline/slow RPC, background/resume and memory pressure. Verify accessibility, text scaling, safe areas, software keyboards and native back gestures. Validate transport security and release permissions against actual binaries.

Source review, unit tests, a browser preview, prior extension QA, the attached PDF and the video do not establish these properties. Keep a release checklist with exact commit, OS/device, build configuration, observed result and unresolved limitations. Do not describe this foundation as production-ready until the applicable gates have evidence.

## Native startup import order

The native entry registers a minimal loading shell, qualifies and installs native
crypto, then evaluates the application graph. This order is a security boundary:
BIP39's noble dependency snapshots `globalThis.crypto` when its module loads.
The web entry uses its usual watch-only application startup. If native crypto
qualification fails, watch-only UI may load, while the memoized rejected native
gate continues to prohibit custody. No fallback RNG is installed.

The isolated native qualification entry obeys the same ordering and checks the
real generated mnemonic against entropy observed from the qualified native
provider. Node ordering probes reproduce both the stale import failure and the
ordered success using the installed BIP39/noble browser module; those probes do
not replace native simulator/device qualification.
