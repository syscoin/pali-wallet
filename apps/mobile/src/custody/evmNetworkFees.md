# Generic EVM transfers

The mobile host uses one transaction flow for every saved EVM registration. The
built-in networks are initial registrations, not an allowlist for sending.
Native coins and ERC20 transfers capture the selected chain, RPC endpoint and
registration fingerprint before review. Changing the account or registration
invalidates the review and outstanding work.

The shared keyring's public `evm-fees` module owns gas-price recommendations,
legacy/type-2 selection, zero-priority handling and the explicitly unsupported
priority-RPC fallback. The extension transaction engine delegates to that same
module. Mobile supplies its bounded, cancellable JSON-RPC reader; it does not
construct a broad provider or duplicate SDK fee arithmetic.

Live preparation, token preparation and exact-envelope rechecks use the same
reader. Gas estimation includes the actual transaction type, chain, nonce,
recipient, value, calldata and selected fee fields for every network. The RPC
block gas limit bounds the estimate. A failed read or malformed response never
becomes a guessed successful quote. Before signing, the host rechecks the
approved envelope, current nonce, available balance, token precision and token
balance. Increased required gas or unaffordable reviewed costs require review.

The fee limit is the signed envelope's gas limit multiplied by its fee cap (or
legacy gas price). It is not a promise that every protocol-specific charge is
encoded in that envelope. No network-name branches or mobile-maintained L1
oracle code hashes decide ordinary transfer support.

A canonical receipt confirms the transaction immediately; status zero means
reverted. Ordinary transfers do not wait for a finalized tag, an arbitrary
confirmation count or L1 settlement. Each later refresh can revise the observed
result after a reorg. A missing receipt and increased sender nonce prove only
nonce use; they never prove this transaction succeeded or identify its
replacement. Oversized or malformed receipts remain unavailable.

The private journal stores verified signed bytes before a broadcast can occur.
Submission is never automatically retried. A user-authorized retry retains the
same bytes and hash. Public activity is a revisable observation, while the
journal preserves the original transaction identity. Different chains do not
share a nonce reservation.

This mobile app is unreleased. Its journal and account catalogue each have one
canonical version-1 format. Older development shapes have no migration path;
unknown data is rejected and retained, never silently replaced or deleted.

Host tests exercise built-in and custom chain IDs through this single path.
Native Android/iOS qualification and device signing remain separate evidence;
a JavaScript test, bundle export or generic registration does not establish
production readiness.
