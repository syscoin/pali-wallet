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

If local wallet state is deleted or Pali is installed on a new device, Pali can recover passkey smart accounts from the on-chain factory registry and event logs. Any Pali install with access to the same passkey credential can discover matching deployed accounts after a WebAuthn assertion, skip accounts already present locally, and import the selected accounts.

One passkey credential can control multiple smart accounts. Because new accounts use fresh deployment salts, Pali recovers them from the on-chain registry rather than by locally guessing indexes.

## Guardian recovery

Pali uses self-custodial recovery guardians for production passkey account recovery. A guardian is a backup EVM wallet, imported account, or hardware wallet that the user controls separately from the active passkey. While the passkey still controls the account, the user can add or remove guardians and update the recovery wait period from the policy screen.

Guardian recovery is not instant. Starting recovery creates a replacement passkey, asks the configured guardian to sign the recovery intent, and submits a timelocked recovery request. After the wait period has passed, anyone can finalize the recovery transaction. The user can then use normal passkey recovery to import the account with the replacement passkey.

The guardian signature binds the chain, guardian recovery validator, account address, replacement passkey identity, recovery nonce, and expiry. This prevents reusing a guardian signature for a different account, chain, or passkey while still allowing the recovery start transaction to be relayed.

Technical note: the guardian recovery validator stores a per-account guardian set, threshold, delay, and pending recovery. Pali currently exposes the simple 1-of-1 guardian flow for UX clarity, while the contract supports threshold policies such as 1-of-N or M-of-N.

## Dapp-created accounts

Dapps can request guardian recovery metadata during `wallet_createPasskeyAccount`:

```
{
  "label": "Trading desk",
  "recovery": {
    "guardian": {
      "address": "0x...",
      "delay": 86400
    }
  }
}
```

Pali does not automatically attach a dapp-provided guardian during account creation because the wallet cannot authenticate that address yet. If a dapp suggests a guardian, Pali warns the user and lets them create the account, then the user can add their own trusted guardian from the passkey account policy screen. Future versions may add a trusted dictionary or whitelist for known default guardians.
