# Sentry node management

Pali holds signing keys and approvals. Sysnode prepares node transactions and
manages the node lifecycle. Hosting providers are optional adapters: neither
operator private keys nor wallet recovery phrases are sent to the dapp or its
backend.

## Keys and roles

Open **Sentry operators** in the wallet menu. The key-import form keeps owner,
operator, voting and collateral roles separate. Legacy operator keys use BLS;
legacy owner/voting/collateral keys use secp256k1. PQ Sentry authorities use the
protocol's **SLH-DSA SHAKE-128s**, not the smart-account SHA2 parameter set.

Use **Batch import** to add up to 20 keys of the selected role and scheme.
Each line accepts a private key, or `label | private key`. Pali identifies invalid
lines before importing; it stores the complete validated batch atomically.
Private values stay masked by default. Editing a batch clears its backup
acknowledgement, and a rejected batch can be corrected without retyping it.

An imported key is encrypted in extension-local storage using AES-GCM. Its
authenticated metadata binds the wallet, Syscoin network, role and public key.
Import, signing, removal and changing the trusted data source require local
wallet reauthentication. Expensive cryptographic work uses a short-lived local
worker that is cancelled on wallet lock/session reset.

**Keep a separate backup of imported node keys.** The wallet recovery phrase
alone does not recreate an externally imported operator/owner key. Removing a
local key does not revoke a node on-chain and does not release its collateral.

## Data sources and network identity

The wallet pins Syscoin mainnet/testnet genesis hashes and address encodings.
An extension-local per-network setting selects the trusted Sentry state
service. Mainnet defaults to `https://sysnode.info`; testnet requires an explicit
configuration. Custom HTTPS services and explicitly configured HTTP loopback
services (`localhost` or `127.0.0.1`) are supported.

Only fixed read-only endpoints are called. No dapp-supplied URL, cookie,
arbitrary JSON-RPC method or backend credential is forwarded. Node identity,
activation state and authority records come from this configured service;
funding transactions come from the wallet's configured Blockbook and are
hash/amount-checked by the shared Sentry SDK. The configured state service is a
trust boundary, not a cryptographic proof of the entire chain.

## Dapp methods

These methods are in the Syscoin provider namespace. Ethereum/MetaMask methods
are unchanged. They require the selected connected Syscoin UTXO account; a
network/account/session change invalidates an open approval.
Submitting another transaction from the same wallet and network also requires
reopening a pending node operation, so a stale approval cannot protect an
output that is being spent. Collateral reservation, final broadcast checks and
release of signed PSBTs share one admission boundary; disclosing a signature or
an uncertain broadcast does not revive old approvals. Linking a node cannot
revoke signatures already returned before the link was prepared, or keys held
elsewhere.

### `sys_getSentryCapabilities`

Returns supported operations, key schemes and roles, without enumerating stored
keys or linked nodes. Capability support does not imply that a particular
network has activated the corresponding PQ operation.

### `sys_linkSentryNode`

```json
{
  "method": "sys_linkSentryNode",
  "params": [
    {
      "version": 1,
      "proTxHash": "<registered node transaction hash>",
      "genesisHash": "<expected Syscoin network genesis hash>"
    }
  ]
}
```

The wallet independently loads and displays the registered node, NEVM address,
service address and collateral outpoint. Approval stores public node identity,
not a key or hosting account. Pali protects the verified collateral outpoint
across this wallet's accounts, including when linked from a reward account.
Other outputs at the same address are unaffected. Linking does not sign or send
a blockchain transaction.

Linked nodes and collateral protection are local wallet metadata, not recovered
from the seed. After restoring on a new device, link your nodes again before
spending from collateral accounts.

Protected collateral can only be unlocked through the wallet's explicit
stop-node acknowledgement and reauthentication. The warning makes clear that
spending it stops the node; removing local protection does not itself spend,
revoke or delete a hosted node.

Approving a new registration also protects its verified, existing collateral
outpoint immediately, before the dapp broadcasts. It is labelled **Pending
registration** until the confirmed node is linked. Closing the dapp, deleting a
signing key or waiting does not silently release it. If registration is
abandoned, release it explicitly in Pali after reviewing the stop-node warning.

### `sys_signSentryOperation`

```json
{
  "method": "sys_signSentryOperation",
  "params": [
    {
      "version": 1,
      "operation": "updateService",
      "chain": { "genesisHash": "<hash>", "era": "legacy-v3" },
      "transactionHex": "<funded transaction with unsigned fee inputs>"
    }
  ]
}
```

Supported typed operations are registration, service/NEVM update, registrar
update, operator preparation/rotation and revocation. The wallet's shared SDK
decodes the actual bytes, checks protocol/activation, input amounts, maximum
fee, required authority and exact registration records. Dapp labels and hashes
are not treated as authorizations. An empty NEVM address is shown explicitly as
removal, not as “leave unchanged.”

An operator service update returns operator-authorized transaction bytes. Other
operations can require several distinct authorities: their response includes
`signedAuthorization` and `complete`. The dapp must obtain every remaining
authority before asking the ordinary wallet fee-signing flow to sign the final
transaction inputs. The node payload must not be changed after fee signing.

This method does **not** broadcast. It never returns private keys, does not
silently substitute a different key/legacy scheme, and does not expose a generic
“sign this hash” primitive. A missing authority, unsupported era, changed node
state or expired approval fails closed.

Hardware signing for these node authorizations is not implemented. An imported
software authority or a matching software wallet account is required. Other
wallet hardware features are unchanged.

### `sys_signSentryVote`

```json
{
  "method": "sys_signSentryVote",
  "params": [{
    "version": 1,
    "chain": { "genesisHash": "<hash>", "era": "legacy-v3" },
    "proposalHash": "<governance object hash>",
    "signal": "funding",
    "outcome": "yes",
    "timestamp": 1792252800,
    "nodes": [{
      "proTxHash": "<registered node transaction hash>",
      "collateralOutpoint": { "txid": "<collateral transaction hash>", "vout": 0 }
    }]
  }]
}
```

Supported outcomes are `yes`, `no` and `abstain`, with at most 20 nodes per
approval. The proposal hash is the governance object ID, not its inner data
hash. Pali fetches the proposal and registered voting identities from its
configured service, displays the decision, and checks that state again before
signing. Exact hashes, node identities and the trusted source remain available
under **Review nodes and vote details**.

Voting uses a matching secp256k1 **voting** key, not a BLS operator key. Legacy
compressed and uncompressed voting identities are supported, including a
matching authenticated software wallet account. Missing-key guidance appears
only inside Pali's approval; the provider does not enumerate stored keys.

After password approval, Pali constructs and signs Core's canonical vote
message locally. It returns the complete batch of compact signatures and
vote hashes; it never broadcasts votes or returns partial signing results.
The dapp verifies and submits the votes through its configured backend.
Existing encrypted browser-vault voting, including phone voting, remains a
separate custody option in Sysnode. PQ governance voting is not enabled.

## Repeatable checks

The PR browser-conformance job runs `sentry-operator.journey.spec.ts`,
`sentry-wallet-authority.journey.spec.ts`, `sentry-batch-import.journey.spec.ts`
and `sentry-governance-vote.journey.spec.ts` with a disposable synthetic wallet and
local-only read endpoints. It checks encrypted
key storage across lock/unlock, small-window controls, real BLS and SHAKE-128s
authorizations through the public provider, wrong-network rejection, signature
tampering, imported Taproot WIF owner authorization, public node linking,
persistence across reload/lock and ordinary PSBT
refusal for linked collateral. This does not broadcast or claim a live-chain
registration. Core/SDK vectors and the Sysnode transaction-admission tests cover
the protocol side separately.

The batch and governance journeys also cover atomic encrypted imports,
per-line corrections, independent backup acknowledgements, compact approval
layouts, per-origin account consent, and both legacy vote-signature encodings.

Unit regressions cover canonical encrypted metadata after Chrome storage
reorders keys, role isolation, account/session changes, pre-commit cancellation,
bounded streamed responses, and the persistent collateral registry limits.
