# Additive EVM fee and receipt reads (phase B)

`EvmTransferReadRpc` is a read-only capability. It has no signer, storage port,
transaction journal, `eth_sendRawTransaction` method, network selector or UI.
Its caller supplies a synchronous revision guard; every asynchronous boundary
checks the guard, and request groups abort on failure. Input fields are detached
and validated before the first await. The existing Ethereum preparation,
confirmation, receipt and broadcast path is unchanged. These adapters are not
wired into `NativeTransfers` yet. No additional network can send.

## Fees and consent

Fee inputs are exact type-2 native transfer DTOs. No signature, private key,
calldata, access list or arbitrary derivation path is admitted. The adapter
constructs canonical unsigned bytes itself. Quotes bind sender, registration,
profile/version, unsigned-envelope hash and sampled block number/hash. Sender
is a separate field because an unsigned Ethereum envelope does not encode it.
The builder accepts only registry-owned network and profile instances and the
complete required component list: Base L1-data plus operator, Rollux L1-data,
and no extras for execution-only/Nitro profiles. Unqualified models reject.
A current chain check precedes address disclosure; a second check and canonical
block-hash readback finish every quote. RPC observations remain a provider trust
boundary, not independent chain proofs.

`envelopeFeeCapUnits` is gas limit times signed max fee per gas. Estimated
execution uses the sampled base fee plus approved priority fee, capped by that
signed price. `extras` lists uncapped estimated charges separately.
`estimatedFeeUnits` combines estimated execution and extras;
`fundingEstimateUnits` combines transfer value, execution cap and extras.
`maximumTotalUnits` is null whenever an extra exists, including a zero estimate.
No estimated-Max balance-spend feature is provided. A lower/equal extra estimate
can preserve the exact approved envelope; increased extras, different sender,
envelope, profile, registration or expired quote require fresh review.
The host must separately refresh nonce and affordability at confirmation.
Expiry is `expiresAtMonotonicMilliseconds`. The constructor clock option and
refresh comparison argument are `monotonicMilliseconds`; all must share one
stable monotonic origin (default `performance.now()`). Wall-clock `Date.now()`
values must not be mixed with these timestamps.

| Network | Fee query | Receipt observation / remaining send gate |
| --- | --- | --- |
| Ethereum | EIP-1559 execution only | New adapter checks canonical receipt block, finalized height and consumed nonce; existing terminal path remains unchanged pending integration review. |
| NEVM 57 / 5700 | Execution-only candidate | Finalized-tag response is labelled `nevm-depth-observation`; never terminal-eligible here. Explicit confirmation policy and native qualification remain. |
| Arbitrum One | Supplied gas limit includes publication cost; verify `eth_estimateGas` fits it, add no separate L1 surcharge | Settlement unqualified; matching node fee/finality and native qualification remain. |
| Base | Source-pinned Jovian GPO: `getL1FeeUpperBound(unsignedByteLength)` and `getOperatorFee(gasLimit)` | Both extras are estimates; settlement and native qualification remain. |
| Rollux | Source-pinned legacy GPO: `getL1Fee(canonicalUnsignedBytes)` | No modern OP method probing/fallback. L1 remains uncapped; node charging, settlement and native qualification remain. |
| zkTanenbaum | Unqualified; fee/receipt reads reject before RPC | Pubdata billing and finality semantics remain unresolved. |

`feeSourceQualified` describes the fee model or oracle source correspondence,
not full sending qualification. Every profile exposes `newSendEnabled: false`.
Existing Ethereum signing gates remain the separate unchanged runtime policy.

## Oracle identity

Base/Rollux read the exact GPO proxy at
`0x420000000000000000000000000000000000000f`. Before oracle calls they verify
proxy bytecode hash, EIP-1967 implementation slot, implementation bytecode hash,
version, and (Base only) all three Fjord/Isthmus/Jovian flags. All reads use the
same sampled block. Unknown code, changed implementation/version/flags, method
errors, invalid ABI, overflow and inconsistent block state fail closed.
A method error is never a zero fee or a request to try another API/endpoint.

- Shared 2055-byte proxy hash:
  `0x1f958654ab06a152993e7a0ae7b6dbb0d4b19265cc9337b8789fe1353bd9dc35`.
  Exact [Proxy.sol at Rollux commit 404267b7](https://github.com/SYS-Labs/rollux/blob/404267b7d2cc2842d7fbf9bdfb92ac248eed15ef/packages/contracts-bedrock/contracts/universal/Proxy.sol)
  compiled with solc 0.8.15, optimization 999999 runs, London EVM, metadata
  bytecode hash disabled. Current-source proxy code was not substituted.
- Base implementation `0x4f1db3c6abd250ba86e0928471a8f7db3afd88f1`, hash
  `0xe9fc7c96c4db0d6078e3d359d7e8c982c350a513cb2c31121adf5e1e8a446614`,
  version 1.6.0, [Jovian source 773798a6](https://github.com/ethereum-optimism/optimism/tree/773798a67678ab28c3ef7ee3405f25c04616af19)
  pinned by the [official specification](https://specs.optimism.io/protocol/jovian/derivation.html).
  The size API itself adds signature overhead; callers pass unsigned size only.
- Rollux implementation `0xf2ad472ade2009ef5eeb26b7fe27ba9fd27de46a`, hash
  `0xe6aa9feb138f683e03915040bea23c79437eba752f49d49bd0628e2edd2af1ad`,
  version 1.0.0, [historical source 404267b7](https://github.com/SYS-Labs/rollux/blob/404267b7d2cc2842d7fbf9bdfb92ac248eed15ef/packages/contracts-bedrock/contracts/L2/GasPriceOracle.sol).
  Official deployment source metadata matches; constructor evaluation matches
  live runtime. This source adds 68 signature bytes when computing L1 gas. The
  newer 1.3.0 source and Base's APIs are not used for Rollux.

The public bytecode fixture records observed proxy/implementation bytes and
compact compiler/source provenance. Mobile tests verify the pinned bytecode;
they do not repeat the separate source-compilation comparison.
Source correspondence and block-pinned read evidence are finite observations,
not an assurance that these upgradable contracts or endpoints remain unchanged.
Runtime fingerprint checks therefore run on every quote.

## Receipts, bounds and verification

New Ethereum receipt observations match transaction hash, sender and recipient;
fetch the canonical block at the receipt height; require its hash to match;
require finalized height at least the receipt height and nonce consumption at
that finalized height; repeat the receipt and check the finalized block hash.
Missing receipts can establish only `nonce-consumed`, never successful execution.
An oversized initial or repeated receipt remains opaque: only the shared reader's
typed byte-limit error permits a separate finalized-block/nonce observation,
with numeric-block nonce lookup, canonical hash recheck and a final chain check.
An unconsumed nonce or unavailable evidence remains an error, never an absent
receipt that could offer retry. Only Ethereum can mark this observation terminal;
NEVM stays observation-only and unqualified settlement profiles refuse it.
Malformed admitted bodies, recognized RPC errors and transport failures do not
select this path. The receipt budget remains 16 KiB.
NEVM tags are depth lookbacks in the matched Geth source, with observed 11/12
block lags; they are not independent ChainLock proof. Other settlement profiles
remain unqualified and cannot return terminal eligibility.

Ordinary responses retain a 16 KiB limit. Bytecode has a separate 32 KiB response
limit, and block responses have a 512 KiB limit because even header-oriented
`eth_getBlockByNumber(..., false)` includes transaction hashes. Limits apply
before JSON parsing; the common reader permits at most 2 MiB for any explicit
caller. Existing callers still use the unchanged 16 KiB default.

Tests cover exact unsigned serialization and sender binding, integer overflow,
uncapped zero/nonzero extras, reduced versus increased refreshes, source/runtime
fingerprint drift, legacy versus modern methods, nested calldata inspection by
a broadcaster-capable fake RPC, cancellation and A-B-A, separate response bounds,
canonical/orphan receipts and observed versus terminal settlement. This local
phase does not claim physical-device behavior, native multi-network offline
signing, new-chain submission or finality qualification.
