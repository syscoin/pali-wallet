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

There is no native network picker wiring yet. Public watch-only reads can use
all registrations. Native transfer entry points remain explicitly gated to
Ethereum; selecting another network cannot access an Ethereum journal, sign,
authorize submission or query the hardcoded Ethereum transfer RPC. The next
slice must provide CAS-protected per-account multi-network journal containers.

Seven successful chain/fee RPC probes are not send qualification. Future send
needs per-chain fee and receipt conformance and native offline signing. OP-stack
chains need L1-data and possibly operator fee adapters; Rollux's legacy fee API
must not be replaced with an assumed newer API. Arbitrum estimate semantics and
zkSYS fees need explicit contracts. An uncapped L1 estimate must never be called
an absolute maximum total, and RPC method failures must not be interpreted as
zero fees. No real-fund transactions are required for qualification.
