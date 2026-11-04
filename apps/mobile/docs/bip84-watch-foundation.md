# Public BIP84 discovery host foundation

This module is an internal, unconnected host foundation. It does not add a wallet
account, accept an extended public key, write a vault record, or enable a new UI
capability. Existing single-address watch behavior and native EVM custody remain
unchanged. It is not a UTXO ledger, coin selector, balance attestation, or a
spending/protected-output decision.

`Bip84Discovery` takes a fixed Bitcoin or Syscoin network, an opaque public source
ID, a synchronous public derivation port, an address-usage reader and a synchronous
context guard. The future adapter must bind one reviewed BIP84 account public key
and fixed network to that source ID. It must derive only the requested receive
(branch 0) or change (branch 1) index. This change contains no key parser or crypto
implementation. The official SDK 2.1 dependency, public account-key validation,
record codec, recovery inventory integration and complete user flow remain gates
for integration. Synthetic witness programs in tests establish orchestration,
not SDK or device qualification.

Each user-requested pass has two workers, one sequential worker per branch. A
branch stops after 20 consecutive addresses without historical transactions,
pending transactions, confirmed units or signed pending units. Historical use of
a now-empty address still resets the gap. A pass examines at most 100 new indices
per branch; all indices are within 0–4095. Limits produce `partial`, never a claim
that all account activity was discovered. `gap-reached` means only that the local
20-address stopping rule was satisfied; used addresses beyond a gap can exist.

The supplied reader validates fixed coin/network metadata and genesis before
sending any address. It samples a numeric block-height hash and repeats that
same-height hash and synchronized metadata after the pass. This detects sampled
chain changes but does not make independent address responses atomic or prove
provider truth. There is no wall-clock freshness authority. No xpub is sent to the
provider. Individual derived addresses and their association are still private
user information; a future UI must explain their disclosure to the fixed provider.
There is no endpoint fallback or redirect following.

A pass is bounded to 30 seconds, 32 KiB per consumed response and 512 KiB across
all consumed responses including metadata/anchors. Concurrent responses share
one synchronous byte counter. These bounds govern consumed/parsed data, not all
bytes a native HTTP stack may receive or allocate before cancellation. Abort,
failed/missing data, wrong identity, response limits and failed anchor checks
invalidate the pass and cancel its owned work. New passes and cancellation clear
displayed totals synchronously. Incomplete responses never imply zero.

Only successful verified prefixes are retained in the live scanner. Explicit
`resume` continues that in-memory prefix; the result marks when observations span
passes, so those totals cannot be presented as one current account snapshot.
`refresh` starts at index zero. A restored cursor is strictly parsed, bound to the
expected network/source and exposed only as an advisory hint. It never skips any
prefix, grants ownership or carries a trusted completion bit. No persistence is
implemented here. Reentrant scans are rejected before callbacks; the owner must
revoke its generation on every account/network change, including A–B–A, and on
lifecycle departure. Context guards must be synchronous and throw when stale.

The shared bounded text reader retains its previous call signature and default
16 KiB limit. Its optional fourth argument receives only each consumed chunk's
byte count (or the UTF-8 count of a native buffered string). The hook must return
undefined synchronously; thrown budget/abort failures propagate, promise/thenable
returns reject and stream cancellation remains in `finally`. Existing mobile
balance, transfer, token, explorer, receipt and HTTP-qualification callers omit
the hook and retain their existing limits. No extension source imports this
mobile helper.
