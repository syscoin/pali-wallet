---
title: Passkey accounts
---

Passkey accounts are EVM smart accounts controlled by WebAuthn credentials. Instead of signing with a normal EOA private key, the user approves actions with the device or account passkey UI provided by the browser and operating system.

Behind the scenes, WebAuthn passkeys use P-256 signatures. zkSYS passkey accounts are built so those P-256 proofs can be verified by the smart account/factory system, which is why a biometric or platform passkey approval can authorize an on-chain action.

## Why use a passkey account?

- Easier institutional onboarding.
- Smart account policy support.
- Optional sponsor services for gas or co-authorization.
- Batch execution with a single user approval.
- Recovery from on-chain registry data when local wallet metadata is missing.

## Shared and separate passkeys

<figure>
  <a className="pali-media-link" href="/img/screens/settings-passkey-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-passkey-create.png" alt="Pali settings screen for creating a passkey account" />
</a>
  <figcaption>Users can create passkey accounts from Settings as well as from dapp requests.</figcaption>
</figure>

Pali can use a shared wallet passkey profile or create a separate passkey credential for an account. Shared passkeys are convenient for users who want one wallet-controlled passkey. Separate passkeys can help institutions isolate credentials per service or policy.

## Deployment

A passkey smart account may exist as a counterfactual address while Pali prepares creation, but Pali only saves the account locally after the deployment transaction is confirmed and the on-chain recovery metadata matches the credential.

If a sponsor policy is selected during creation, Pali can deploy the account and apply the initial policy in the same on-chain transaction. Later policy changes are separate on-chain transactions and require another passkey approval.

## Network support

Passkey accounts require zkSYS passkey smart account contracts and P-256 verification support. In this Pali build, `zkTanenbaum` testnet is configured for passkey account creation. zkSYS production support uses the same model once the production factory address is configured in the wallet.

## Recovery

<figure>
  <a className="pali-media-link" href="/img/screens/settings-passkey-policy.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-passkey-policy.png" alt="Pali passkey account policy settings screen" />
</a>
  <figcaption>The passkey policy screen shows sponsor mode, signer, URL, and backup status where available.</figcaption>
</figure>

If local wallet state is deleted or the wallet is restored, Pali can recover passkey smart accounts from the on-chain factory registry and event logs. Recovery still needs a WebAuthn assertion from the relevant passkey.

One passkey credential can control multiple smart accounts. Because new accounts use fresh deployment salts, Pali recovers them from the on-chain registry rather than by locally guessing indexes.
