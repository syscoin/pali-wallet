---
title: Create and recover smart accounts
---

`wallet_prepareSmartAccount` creates a Pali smart account for dapp onboarding. Pali derives the account, deploys it through the configured factory, installs the requested validator when needed, connects the account to the requesting dapp, and writes durable account metadata into local wallet state.

The local wallet state represents smart accounts Pali can operate. A smart account may be controlled by a passkey validator, an ECDSA validator, a composite validator, or guardian recovery modules installed after creation.

## Smart account and factory structure

The smart-account system has these pieces:

- **Factory:** computes deterministic addresses and deploys accounts with initial module data.
- **Smart account:** executes calls, tracks installed modules, and asks validator modules to approve signatures.
- **Validators:** authorize actions. Pali supports ECDSA, P-256 WebAuthn passkey, and composite validators.
- **Executors:** add account features. Pali uses guardian recovery as an executor module.

The factory account parameters include:

| Parameter | Meaning |
| --- | --- |
| `salt` | Deterministic deployment salt derived by Pali from wallet anchor, account index, chain, and account version. |
| `initialValidator` | Validator module used for bootstrap deployment. Pali uses a wallet-owned ECDSA validator for deterministic setup. |
| `initData` | Encoded validator initialization data. |

After deployment, Pali can install the requested validator and remove the bootstrap validator in one smart-account batch. That is why a dapp can request a passkey-controlled account while Pali still keeps the first deployment path deterministic.

## Create a passkey-controlled account

```js
const smartAccount = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [
    {
      label: 'Pali Wallet Passkey',
      authenticator: { id: 'p256-webauthn' },
    },
  ],
});
```

If the dapp omits `authenticator`, Pali uses the passkey path by default. Pali creates a WebAuthn credential when the request does not provide passkey public-key metadata.

## Create an ECDSA smart account

```js
const smartAccount = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [
    {
      label: 'Team account',
      authenticator: {
        id: 'ecdsa',
        config: {
          owners: ['0xOwnerAddress'],
          threshold: 1,
        },
      },
    },
  ],
});
```

ECDSA owners that are already local Pali wallet accounts are treated as wallet-owned. External ECDSA owner addresses are allowed only after an explicit warning and acknowledgement because those addresses can approve future smart-account actions.

## Creation and deployment behavior

When a dapp requests a smart account:

1. Pali verifies the active chain has Pali smart-account infrastructure configured.
2. Pali derives the next deterministic account descriptor and counterfactual address.
3. Pali creates or normalizes the requested authenticator.
4. Pali shows the dapp host, account label, authenticator type, and any external ECDSA owners.
5. Pali creates the account locally and deploys it on-chain with the bootstrap validator.
6. If the requested validator differs from the bootstrap validator, Pali installs the requested validator and uninstalls the bootstrap validator through a smart-account execution.
7. Pali waits for confirmation, stores durable smart-account metadata, and connects the account to the dapp.

If the resulting address is already present locally, Pali can reuse that local smart account.

## What determines the address?

The smart account address is derived from the factory, account implementation, bootstrap validator init data, and Pali's deterministic deployment salt. Pali derives the salt from a wallet anchor and account index, so accounts are recoverable by wallet metadata instead of by random local state.

## If the user loses local Pali data

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-recover.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-smart-account-recover.png" alt="Pali settings screen for recovering smart accounts" />
</a>
  <figcaption>The recovery screen helps restore smart-account access by reconstructing Pali-created accounts or using guardian recovery to replace the active validator.</figcaption>
</figure>

If the browser profile, extension storage, or local smart-account metadata is lost, recovery depends on the account's current modules:

- Deterministic Pali-created accounts can be reconstructed from wallet anchor, chain, account index, and factory configuration.
- Passkey validators still require the relevant WebAuthn credential to authorize future actions.
- Guardian recovery can replace the active validator after the configured delay if the original approval method is unavailable.

Pali recovery is self-custodial. It is not a server backdoor and it cannot bypass the account's installed modules.

## RP ID and credential name

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-assert.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-assert.png" alt="Browser or operating system passkey assertion prompt" />
</a>
  <figcaption>Recovery and execution require a WebAuthn assertion from the relevant passkey credential.</figcaption>
</figure>

The browser controls the effective RP ID for extension-origin WebAuthn unless an RP ID is provided by the wallet path. Pali labels the default shared credential as `Pali Wallet Passkey` and uses the requested account label for user-facing account association.
