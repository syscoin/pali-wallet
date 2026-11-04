# Native transfer journal

`NativeTransferJournal` is an internal prerequisite for native transfers. It does not enable sending by itself, and it is not exposed to screens. Its storage port must be the wallet-owned transactional SQLCipher adapter.

The initial scope is the first Ethereum account and plain ETH transfers (signed type 0 or type 2, chain ID 1, empty calldata). The journal validates the serialized transaction, recovers the sender, computes its hash locally and binds it to the wallet fingerprint. Records and calldata remain bounded.

The host must save the signed bytes and then await the durable `attempted` transition before calling a network broadcaster. A failed or ambiguous write stops submission. A process restart treats `attempted` and `submitted` records as unresolved and queries the same hash. It must not automatically choose another nonce or create a replacement. A later wallet lock cannot revoke signed bytes already returned by the SDK.

Only the receipt-validation host may mark an attempted transaction confirmed or reverted. The journal itself does not query or establish chain inclusion/finality. It never deletes an unresolved transaction. Terminal records may be replaced only by a strictly later nonce; activity/history storage remains a separate feature.

Instances sharing the wallet storage capability share a serialized queue, and initial creation uses the adapter's atomic create-if-absent operation. Multiple OS processes are excluded by the existing native storage lease. Public UI projections must omit raw transaction bytes and the wallet fingerprint.
