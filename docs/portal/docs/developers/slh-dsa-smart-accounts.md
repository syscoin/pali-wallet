---
title: SLH-DSA smart accounts
---

Pali smart accounts support modular validators. The post-quantum validator uses wallet-managed **SLH-DSA-SHA2-128s** signing. The user-facing label may say post-quantum or SLH-DSA; the protocol-facing authenticator id is `slh-dsa`.

This page is for dapp developers, reviewers, and operators integrating with Pali smart accounts.

:::caution Alpha note
Pali smart accounts and the SLH-DSA validator are early infrastructure. Start with supported test networks or small-balance accounts, keep a recovery or fallback validator path, and avoid dapp UX that assumes fixed setup or signing times.
:::

## Rationale

Classical EVM EOAs use secp256k1 ECDSA. Most passkeys use P-256 ECDSA. Both families rely on elliptic-curve discrete logarithms, which are the class of signatures threatened by a large enough fault-tolerant quantum computer running Shor's algorithm.

SLH-DSA is different: it is a stateless hash-based signature scheme standardized by NIST in FIPS 205. The security argument is based on hash functions rather than discrete logarithms. The tradeoff is practical: signatures and verification keys are larger, and signing is much heavier than ECDSA or WebAuthn.

Smart accounts are the right place for this because validators are replaceable modules. The account address can stay stable while the active validator changes between ECDSA, passkey, composite policy, and SLH-DSA.

## Current scope

Pali supports SLH-DSA as a local, wallet-managed smart-account authenticator:

- The dapp requests `authenticator: { id: 'slh-dsa' }`.
- Pali provisions the local key material itself.
- Dapp-supplied SLH-DSA public key configs are rejected.
- Pali prepares local signer state and public precompute cache before validator activation.
- The smart account rotates to the SLH-DSA validator only after the wallet can prove it has matching local signer state.

Pali does not currently support arbitrary external SLH-DSA keys supplied by a dapp. That restriction is intentional: accepting unprovisioned public keys would let a dapp create an account that Pali cannot sign for.

## Dapp request

Use `wallet_prepareSmartAccount` and request the SLH-DSA authenticator by id:

```js
const smartAccount = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [
    {
      label: 'Post-quantum test account',
      authenticator: { id: 'slh-dsa' },
    },
  ],
});
```

Do not include `keyId`, `pkSeed`, `pkRoot`, or other SLH-DSA key material in the dapp request. Pali treats the local signer as wallet-managed state and will reject dapp-supplied SLH-DSA configs.

## Signing flow

For an active SLH-DSA smart account, Pali signs the smart-account action hash with the local SLH-DSA signer. The signer checks that:

- the target account id is known when the flow is signing for a non-active smart account;
- the active validator metadata is hydrated;
- the active validator module is `slh-dsa`;
- the validator public key matches the local signer state;
- the encrypted local state can be decrypted for the current wallet session.

If any check fails, Pali refuses to sign and asks the user to regenerate local state or use another approval path.

## Recovery and guardians

Guardian recovery can involve smart-account guardians. If the guardian is itself an SLH-DSA smart account, the approval must be signed against the guardian account, not whichever account is currently active in the wallet UI. Pali passes the target smart-account id through the signing context for these flows.

The recovery module verifies guardian approvals through normal signature checking: ECDSA for EOAs and ERC-1271 for contract accounts. That means a smart-account guardian can enforce its own validator policy, including SLH-DSA, once it is deployed and locally signable.

## Local state boundaries

Pali separates several kinds of SLH-DSA state:

- **Encrypted local signer state:** account-specific signing material encrypted through the wallet session.
- **Runtime signer state:** decrypted state held only while the wallet is unlocked.
- **Public precompute cache:** large public tree data used to make signing practical.
- **Setup status and prepared signer metadata:** non-secret records used by the UI to resume or finalize setup.

Wallet lock clears runtime state and cancels active offscreen SLH-DSA work. Wallet forget/import reset removes encrypted signer state, public precompute cache, setup status, and prepared signer metadata.

## Performance notes

SLH-DSA signing is intentionally heavier than ECDSA. Pali uses WebAssembly and offscreen workers so the wallet UI can remain responsive, but performance still depends on browser scheduling, extension worker limits, CPU availability, and whether the precompute cache is warm.

Integrators should expect:

- setup to take longer than ECDSA or passkey setup;
- signing to take longer than ECDSA or passkeys;
- progress UI to be important for user trust;
- browsers to throttle workers differently when devtools or background tabs are involved;
- reset and lock paths to cancel long-running offscreen work.

Do not design dapp UX around fixed signing times.

## Signature limit and gas shape

Pali's current SLH-DSA signer profile has an absolute per-key capacity of `2^24` signatures. Pali reserves `1,000` signatures for validator rotation retries, so the normal signing budget is `2^24 - 1,000`. The limit is not expected to matter for normal wallet use, but it is enforced: once `signatureCount >= signatureLimit`, Pali refuses normal signing and only allows the reserved budget for explicit `rotateValidator` executions.

That limit is part of the practicality tradeoff. The local cache is sized for this profile, and the resulting SLH-DSA signature is `3,856` bytes. The signature is much larger than ECDSA or WebAuthn signatures, so Pali uses validator-aware gas budgets before signing the `UserOperation`.

Current wallet constants:

- absolute signature capacity: `2^24`;
- normal signature limit: `2^24 - 1,000`;
- reserved rotation signatures: `1,000`;
- signature length: `3,856` bytes;
- SLH-DSA `preVerificationGas`: `130,000`;
- SLH-DSA `verificationGasLimit`: `700,000` conservative upper bound.

Future wallet releases can guide proactive rotation before the limit is reached. The important rule for integrators is that Pali will not silently spend the reserved rotation budget on normal dapp activity.

## Network requirements

The active EVM network must have compatible Pali smart-account contracts and the SLH-DSA validator deployed at the configured address. Hydration tolerates networks where older smart-account infrastructure exists but the SLH-DSA validator is not deployed: in that case Pali treats the SLH-DSA module as unavailable instead of failing unrelated ECDSA or passkey smart accounts.

For production deployments, verify:

- factory and account contract addresses;
- validator and executor module addresses;
- EntryPoint compatibility;
- gas estimation for larger SLH-DSA signatures;
- bundler or transaction relay behavior for larger calldata;
- user-facing recovery and fallback policy.

## Review checklist

For audits and reviews, pay close attention to:

- account-id binding for non-active smart-account signing;
- stale metadata hydration;
- dapp-supplied key rejection;
- wallet lock and reset cleanup;
- duplicate transaction submission;
- missing-module behavior on partially deployed networks;
- gas estimation and calldata size handling.

## References

- [NIST FIPS 205: Stateless Hash-Based Digital Signature Standard](https://csrc.nist.gov/pubs/fips/205/final)
- [NIST SP 800-230 initial public draft](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-230.ipd.pdf)
- [NIST SP 800-208: Recommendation for Stateful Hash-Based Signature Schemes](https://csrc.nist.gov/pubs/sp/800/208/final)
- [NIST post-quantum cryptography project](https://csrc.nist.gov/projects/post-quantum-cryptography)
- [RFC 8391: XMSS, a hash-based signature system](https://www.rfc-editor.org/rfc/rfc8391)
- [The SPHINCS+ submission and specification](https://sphincs.org/)
- [ERC-1271: Standard signature validation method for contracts](https://eips.ethereum.org/EIPS/eip-1271)
- [ERC-4337: Account abstraction](https://eips.ethereum.org/EIPS/eip-4337)
- [ERC-7579: Modular smart accounts](https://eips.ethereum.org/EIPS/eip-7579)
