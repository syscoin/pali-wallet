---
title: Smart accounts and validators
---

Pali smart accounts are EVM contract accounts that can be controlled by modules. A passkey is one supported way to control a smart account. Instead of signing every action with a normal EOA private key, the user can approve actions with the browser or operating system passkey UI.

Behind the scenes, WebAuthn passkeys use P-256 signatures. Pali's passkey validator is built so those P-256 proofs can be verified by the smart account. That is why a biometric or platform passkey approval can authorize an on-chain action without exposing the passkey private key to Pali or the dapp.

## Why use a smart account?

- Modular approval methods for everyday use.
- Wallet-owned ECDSA control when a normal wallet key should own the account.
- Co-managed policies through composite validators.
- Batch execution with a single user approval.
- Guardian recovery after a timelock.
- Deterministic account creation so Pali can reconstruct account records.

## Passkeys, ECDSA, and co-managed accounts

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-create.png" alt="Pali settings screen for creating a smart account" />
</a>
  <figcaption>Users can create modular smart accounts from Settings or from dapp requests, then choose the validator that controls approvals.</figcaption>
</figure>

Pali supports three validator styles:

- **Passkey:** the browser or operating system asks for WebAuthn approval.
- **ECDSA:** configured EVM owner addresses approve account actions.
- **Composite:** child validators are combined under a threshold, such as passkey or ECDSA.

Think of validators as the answer to "who can approve actions for this account?" — and the useful part is that the answer can change without changing your account:

- **Any one of my sign-ins** (1-of-N): approve with whichever passkey or key is handy.
- **A few of us together** (t-of-N): a quorum of people or devices must agree, ideal for shared funds.
- **All of us together** (N-of-N): every configured sign-in must approve, for the most sensitive accounts.

Policies can even contain other policies, so a team can express things like "the lead's key plus any two desk passkeys." Your address, balances, and history stay exactly the same when the policy changes — and because signing is modular, future signature types (including post-quantum ones) can be adopted on the same account later.

Guardians are intentionally **not** part of this list. A guardian can never approve a transaction; their only power is to start a slow, visible recovery if you lose access. That separation protects you from lost access without giving anyone day-to-day control.

Pali can use a shared wallet passkey profile or create a separate passkey credential for an account. Shared passkeys are convenient for users who want one wallet-controlled passkey. Separate passkeys can help isolate credentials per service or policy.

## Deployment

A smart account may exist as a counterfactual address while Pali prepares creation. Pali derives the address from deterministic factory inputs, deploys through the Pali factory, and saves durable account metadata locally.

The account starts from a wallet-owned bootstrap validator for deterministic deployment. If the user or dapp selected a passkey or another validator, Pali installs that validator and removes the bootstrap validator through a smart-account execution.

## Network support

Smart accounts require the Pali factory and module contracts to exist at the addresses Pali uses for the active chain. In this Pali build, `zkTanenbaum` testnet is configured for smart-account creation, and zkSYS production support uses the same model once the production factory and module addresses are configured.

Other compatible EVM chains can use the same contracts. When the active network has canonical CREATE2 support, Pali can deploy the missing smart-account setup from inside the wallet: open Settings, go to Advanced, and use the **Smart account setup** Deploy button. Passkey validators need P-256 WebAuthn verification support, which many modern EVM environments expose through a P-256/passkey precompile.

## Recovery

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-policy.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-policy.png" alt="Pali smart-account policy settings screen" />
</a>
  <figcaption>The smart-account policy screen shows installed modules, active validator details, guardian recovery, and module management.</figcaption>
</figure>

If local wallet state is deleted or Pali is installed on a new device, deterministic Pali smart accounts can be reconstructed from wallet metadata and chain configuration. Accounts with passkey validators still need access to the relevant passkey credential to approve actions.

One passkey credential can control multiple smart accounts. Pali separates the passkey credential profile from each deployed account's smart-account metadata.

## Guardian recovery

Pali uses self-custodial recovery guardians for smart-account recovery. A guardian is a backup EVM wallet, imported account, or hardware wallet that the user controls separately from the active validator. While the account is healthy, the user can add or remove guardians and update the recovery wait period from the policy screen.

Guardian recovery is not instant. Starting recovery creates a replacement recovery target, asks the configured guardian to sign the recovery intent, and submits a timelocked recovery request. After the wait period has passed, anyone can finalize the recovery transaction. The user can then operate the account with the replacement validator.

The guardian signature binds the chain, account address, recovery module, recovery salt, execution mode, and recovery calldata. Pali uses a fresh salt for each recovery attempt, and the module permits only one active recovery per account.

Technical note: the guardian recovery executor stores a per-account guardian set, threshold, delay, expiration, and pending recovery. Pali currently exposes simple guardian flows for UX clarity, while the module supports threshold policies such as 1-of-N or M-of-N.

## Dapp-created accounts

Dapps can request a smart account with `wallet_prepareSmartAccount`:

```
{
  "label": "Trading desk",
  "authenticator": {
    "id": "p256-webauthn"
  }
}
```

Dapps can also request an ECDSA validator:

```
{
  "label": "Trading desk",
  "authenticator": {
    "id": "ecdsa",
    "config": {
      "owners": ["0x..."],
      "threshold": 1
    }
  }
}
```

If the requested ECDSA owner is not a local Pali account, Pali shows a warning and requires explicit acknowledgement before continuing.
