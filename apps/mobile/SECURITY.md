# Security scope and release gates

## Current trust boundary

This mobile foundation is watch-only. It has no seed intake, private-key storage, PIN authentication, signing implementation or broadcast implementation. The design preview has no authority and must remain isolated from live public account state. No screen, URL, QR payload or UI flag may enable an unsupported capability.

A native watch-only account may persist public addresses in platform protected storage. That does not establish a secure vault implementation. Public addresses and their association with this device still deserve privacy protection. Network requests disclose queried addresses to the configured service; never add an analytics, crash-reporting or address-enrichment service without a separate product/privacy decision.

Operation identity includes account, network, endpoint and a session/generation value. Returning from A to B to A is not the same authority context. Locking, backgrounding, account changes and network changes must invalidate pending work. A late network result cannot overwrite a newer context. Failed reads and unavailable balances must remain distinct from a valid zero or an absent account.

## Required before accepting wallet secrets

1. **One authoritative wallet.** Adapt the extension's tested operations behind explicit native interfaces. UI state is a projection, not authorization. Do not expose keyring records or generic method traversal across a bridge. Untrusted dapp content must not share a privileged wallet context.
2. **Native durable vault.** Preserve the extension/keyring vault protocol and migration/recovery semantics. Its custom storage client requires atomic `createItemsIfAbsent` over the prefixed serialized records and completion-aware writes/deletes. A sequence of independent writes is insufficient. Use an appropriate encrypted transactional store for large vault data; protected key/value storage is not a substitute for that store.
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
