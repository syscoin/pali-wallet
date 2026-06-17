---
title: Post-quantum smart-account signer
---

Pali smart accounts can be controlled by different validators. One supported validator is a local post-quantum signer based on **SLH-DSA-SHA2-128s**, the stateless hash-based signature family standardized by NIST as FIPS 205.

In plain language: this is a way for a smart account to approve actions with a signature scheme designed to resist known quantum attacks against today's ECDSA-style signatures.

:::caution Alpha note
Pali smart accounts and the SLH-DSA validator are early infrastructure. Start with supported test networks or small balances, keep a recovery or fallback validator path, and expect setup/signing to be slower than normal wallet signatures.
:::

## What changes for users

With a normal EVM account, one ECDSA private key controls the address. With a Pali smart account, the address is a contract account and a validator decides what counts as approval. The validator can be ECDSA, passkey, composite policy, or SLH-DSA.

The SLH-DSA option lets the account approve actions with the local post-quantum signer instead of a classical ECDSA validator.

What stays the same:

- Your smart-account address stays the same.
- Dapps still see one EVM account address.
- Pali still shows a transaction or policy prompt before signing.
- Guardian recovery and validator rotation remain smart-account features.

What changes:

- Setup takes longer because Pali prepares a local signing cache.
- Signing can take noticeably longer than ECDSA or passkeys.
- The local signer state must stay available on the device, or you must regenerate it from the wallet.

## When to use it

Use the post-quantum signer when you want quantum-resistant smart-account approval for a test account, research account, or staged rollout.

It protects the smart-account approval signature from known quantum attacks against classical discrete-log signatures. It does not remove normal wallet risks such as phishing, malicious dapps, compromised devices, bad recovery settings, or sending funds to the wrong address.

## How to enable it

1. Open Pali and switch to a supported EVM network.
2. Open **Settings**.
3. Open the smart-account or smart-account policy screen.
4. Choose the **Post-quantum / SLH-DSA** authenticator.
5. Keep Pali open while the local signer cache is prepared.
6. Review the validator switch transaction and submit it.

If Pali says the local signer is missing or does not match the active validator, use the smart-account policy screen to regenerate the local post-quantum signer state. Pali will derive the local setup secret from the wallet and rebuild the cache for that smart account.

## What setup is doing

SLH-DSA is stateless, but fast signing needs precomputed public tree data. Pali prepares and stores a local cache so later signing does not have to rebuild everything from scratch. This cache is not the spending key by itself, but it is tied to the signer and account.

During setup Pali may show progress for the XMSS tree cache. Closing the wallet, locking the wallet, or resetting the wallet can cancel active setup work. If setup is interrupted, start it again from the same screen.

## What signing feels like

ECDSA and passkey signatures are usually quick. SLH-DSA signatures are larger and more computationally expensive. Pali runs the heavy work in an offscreen worker so the UI can keep showing progress, but the operation can still take seconds or longer depending on the device, browser throttling, and whether the local cache is warm.

Keep the browser extension open while signing. Avoid closing the browser, locking the wallet, or resetting the wallet during a signature unless you intend to cancel it.

## Signature limit

Pali's current SLH-DSA profile has an absolute capacity of `2^24` signatures from one prepared local signer. Pali keeps `1,000` signatures in reserve for rotating away from the key, so normal signing stops at `2^24 - 1,000`. That is still more than 16 million signatures, so normal users are not expected to hit it.

The limit exists so Pali can keep the signer practical: it fixes the tree size used for the local cache and keeps signatures compact for this parameter set. If the normal signing budget is exhausted, Pali stops regular signing with that local key and preserves the reserve for validator rotation retries instead of continuing with an exhausted signer.

## Why Pali is adding this

ECDSA and P-256 passkeys are based on elliptic-curve discrete logarithms. A sufficiently capable quantum computer running Shor's algorithm would threaten those signature schemes. SLH-DSA is hash-based and is part of NIST's post-quantum cryptography standards, so it gives Pali a path to quantum-resistant account authorization without changing the smart-account address.

Smart accounts make this practical because the signing method is a replaceable validator module. The same account can start with ECDSA or passkeys, then rotate to SLH-DSA when the user, network, and tooling are ready.

## References

- [NIST FIPS 205: Stateless Hash-Based Digital Signature Standard](https://csrc.nist.gov/pubs/fips/205/final)
- [NIST SP 800-230 initial public draft](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-230.ipd.pdf)
- [NIST post-quantum cryptography project](https://csrc.nist.gov/projects/post-quantum-cryptography)
- [RFC 8391: XMSS, a hash-based signature system](https://www.rfc-editor.org/rfc/rfc8391)
- [ERC-4337 account abstraction](https://eips.ethereum.org/EIPS/eip-4337)
- [ERC-7579 modular smart accounts](https://eips.ethereum.org/EIPS/eip-7579)
