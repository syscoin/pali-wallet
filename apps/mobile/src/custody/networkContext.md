# Saved EVM network context

The extension and mobile app share the pure built-in definitions in
`source/shared/evmNetworks.ts`. Defaults seed a new catalogue. They do not form a
send allowlist and never replace saved registrations during loading.

The unreleased mobile catalogue has one canonical version-1 shape. It contains
validated, immutable network registrations: ID, name, EVM chain ID, SLIP-44 60,
RPC URL, native symbol/precision, testnet label and deterministic fingerprint.
The fingerprint binds the reviewed fields. Unknown or malformed records fail
closed and remain preserved; there is no development-format migration.

Adding or editing a network explicitly checks the standard RPC chain ID first.
The catalogue mutation uses the same revision-checked authority as account
selection. Outstanding work cannot adopt a late result or silently retarget an
existing signed transaction. Network removal retains unrelated history and
private journal data. An active registration must be switched away from before
removal.

Every valid saved EVM registration can use the shared prepared-signing flow for
native currency or ERC20. Selected registration snapshots flow into balances,
metadata reads, reviews, signing, durable journals and receipt checks. A network
name does not select different fee arithmetic or confirmation policy. Fee and
receipt behavior is documented in `evmNetworkFees.md`.

EVM accounts share their existing SLIP-44 60 derivation, while the chain ID stays
part of transaction and history identity. The catalogue never exposes private
keys, encrypted imported keys, seed material or SDK session objects through its
public projection. UTXO derivation and transaction families remain distinct.
