# EVM registry and durable network context

The pure `source/shared/evmNetworks.ts` registry supplies extension default EVM
objects and the mobile public-read table. Extension exports preserve their prior
field values and alias identity; host copies remain mutable. Shared definitions
are immutable and import no browser, SDK, storage or network code. The seven
registrations are Ethereum, Syscoin NEVM, Base, Arbitrum, Rollux, Syscoin NEVM
Testnet and zkTanenbaum Testnet. All use Ethereum derivation SLIP-44 60. Testnets
are labelled in public mobile data. UTXO identities remain separate.

Catalogue value version2 remains at the stable `native-wallet-catalogue-v1`
physical key. It stores all seven exact registrations, including a deterministic
Keccak-256 registration hash over ID/kind/chain/SLIP-44/endpoint/native-asset and
testnet fields. A default endpoint or registration change cannot overwrite a
stored mismatch. Such a change needs a separate reviewed migration. Password,
recovery and vault rewrites still require atomic catalogue rebinding.

Existing committed version1 values have one explicit decoder. Their historical
Ethereum endpoint and exact record shape are validated; every live account is
checked against authenticated SDK derivation before the v2 CAS. Migration retains
wallet fingerprint, account IDs, addresses, labels, indices, tombstones and
Ethereum selection, increments catalogue revision once, and reads back the full
committed record. Failed/ambiguous writes quarantine until close/reopen. Unknown
versions, malformed values and mismatched identities are never recreated.
Migration does not write or rename transaction journals.

Network selection is a host/runtime capability in this slice. It uses the same
exclusive admission and revision revocation as HD account mutations, commits the
selected registration atomically, and updates the SDK network only for a current
acknowledged result. Reopen hydrates the persisted selection. One HD60 account
family is shared across these EVM networks; selecting a chain neither allocates
an account nor changes its derivation path. No seed/private key/session field
enters the catalogue or public projection.

The native network picker uses this durable selection and labels test networks.
New public EVM watch accounts can read all registrations; existing watch records
retain only their explicitly saved network/address mappings. Native transfer capabilities are explicit: Ethereum supports native ETH and
ERC20; fixed Syscoin NEVM Testnet (5700) supports native TSYS only. Other
networks remain read-only. Reviews, RPC instances and signing requests bind the
selected immutable registration and endpoint. Selecting another network cannot
access the prior network's journal or authorize its pending operation. CAS-protected per-account multi-network journal containers now preserve
recovery identities; their presence does not enable additional signing.

The additive read-only fee and receipt adapters are described in
[evmNetworkFees.md](evmNetworkFees.md). Their fee quotes do not change Ethereum signing or broadcast. Ethereum
receipt recovery now uses the canonical observation checks; NEVM testnet native sending uses the separate explicit 12-confirmation depth
policy; no other new chain is enabled. Source-pinned Base and Rollux
oracle queries use unsigned payloads only. Their L1/operator charges remain
estimates, with no absolute maximum total. Arbitrum's gas estimate includes L1
publication cost; NEVM finalized tags provide depth observations rather than
independent ChainLock proof. zkSYS stays unqualified. Further send integration
requires per-chain conformance, receipt-policy review and native offline signing.
No real-fund transactions are required for qualification.
