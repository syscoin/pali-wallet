# Native transfer journal

`NativeTransferJournal` is an internal prerequisite for native transfers. It does not enable sending by itself, and it is not exposed to screens. Its storage port must be the wallet-owned transactional SQLCipher adapter.

The current scope is seed-derived Ethereum accounts and plain ETH transfers (signed type 0 or type 2, chain ID 1, empty calldata). The journal validates the serialized transaction, recovers the sender, computes its hash locally and binds it to the wallet fingerprint. Records and calldata remain bounded.

The host must save the signed bytes and then await the durable `attempted` transition before calling a network broadcaster. A failed or ambiguous write stops submission. A process restart treats `attempted` and `submitted` records as unresolved and queries the same hash. It must not automatically choose another nonce or create a replacement. A later wallet lock cannot revoke signed bytes already returned by the SDK.

Only the receipt-validation host may mark an attempted transaction confirmed or reverted. The journal itself does not query or establish chain inclusion/finality. It never deletes an unresolved transaction. Terminal records may be replaced only by a strictly later nonce. On eligible account removal, a terminal journal may instead be pruned in the same compare-and-set transaction as the catalogue change, requiring its exact validated value; an absent journal must remain absent. Pending or unknown outcomes are never pruned. Account zero retains the legacy global key; other indices have stable scoped keys. Activity/history storage remains a separate feature.

Instances sharing the wallet storage capability share a serialized queue, and initial creation uses the adapter's atomic create-if-absent operation. The native storage lease excludes multiple owners within the application process; cross-process exclusion is not established. The supported deployment uses one wallet-authority process. Public UI projections must omit raw transaction bytes and the wallet fingerprint.

The send authority may also retire a record as `nonce-consumed` when the RPC reports a finalized account nonce greater than its saved nonce but cannot provide the original receipt. This does not label the original transfer successful or failed. The UI keeps its hash, explains the unavailable outcome, and requires a new explicit transfer decision. It never retries an obsolete nonce automatically. Finality observations retain the configured RPC trust assumption; they are not independent consensus proofs.
