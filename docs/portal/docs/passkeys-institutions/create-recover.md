---
title: Create and recover passkey accounts
---

`wallet_createPasskeyAccount` creates a new passkey smart account for dapp onboarding. Pali creates or selects a WebAuthn credential, deploys the smart account on-chain, confirms the deployed recovery metadata, and writes the account into local wallet state after confirmation.

The local wallet state represents deployed passkey accounts. Recovery is available from Pali settings for accounts that already exist on-chain.

## Smart account and factory structure

The passkey system has two on-chain pieces:

- **Factory:** creates accounts, computes counterfactual addresses, exposes recovery lookups, and can deploy plus execute the first action.
- **Smart account:** stores recovery metadata, nonce, sponsor policy, and validates WebAuthn/P-256 execution proofs before running calls.

The factory account parameters include:

| Parameter | Meaning |
| --- | --- |
| `passkeyX`, `passkeyY` | P-256 public key coordinates extracted from the WebAuthn credential. |
| `credentialIdHash` | Hash of the WebAuthn credential id. |
| `rpIdHash` | WebAuthn RP ID hash from authenticator data. |
| `originHash`, `originLength` | Extension-origin binding data from WebAuthn client data. |
| `salt` | Deployment salt that lets one credential control more than one smart account. |

The smart account exposes execution, signature validation, nonce, sponsor policy, and recovery metadata reads. Pali uses that metadata to reconstruct accounts after local state loss.

## Create with sponsorship disabled

```js
const passkeyAccount = await window.ethereum.request({
  method: 'wallet_createPasskeyAccount',
  params: [
    {
      label: 'Pali Wallet Passkey',
      sponsor: {
        mode: 'disabled',
      },
    },
  ],
});
```

## Create with sponsor policy

<figure>
  <a className="pali-media-link" href="/img/screens/passkey-create-required.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/passkey-create-required.png" alt="Pali passkey account creation popup with required sponsor policy details" />
</a>
  <figcaption>Required sponsorship shows the sponsor URL, signer, and policy text before the user approves.</figcaption>
</figure>

```js
const passkeyAccount = await window.ethereum.request({
  method: 'wallet_createPasskeyAccount',
  params: [
    {
      label: 'Institution Managed Account',
      sponsor: {
        mode: 'required',
        url: 'https://institution.example/sponsor/user-123',
        signer: '0xSponsorSignerAddress',
        policyText:
          'This account requires institution co-authorization for execution.',
      },
    },
  ],
});
```

## Creation and deployment behavior

When a dapp requests a passkey account:

1. Pali verifies the active chain supports passkey smart accounts.
2. Pali creates a fresh deployment salt for the new account path.
3. Pali obtains or creates the WebAuthn credential profile.
4. Pali computes the counterfactual address and deployment metadata.
5. Pali asks the user for a passkey assertion over the deployment approval hash.
6. Pali submits `createAccount`, or `createAccountAndExecute` when an initial sponsor policy action is needed, through the configured deployment gas payer.
7. Pali waits for confirmation, reads the smart account recovery metadata from-chain, and verifies it matches the prepared credential and origin data.
8. After confirmation, Pali creates the local passkey account and connects it to the requesting dapp.

If the resulting address is already present locally as a deployed passkey account, Pali can reuse that local account.

## What determines the address?

The smart account address is derived from factory inputs including passkey public coordinates, credential hash, origin data, RP ID hash, and deployment salt. Each new account path uses a fresh deployment salt, so one credential can control multiple smart accounts.

## If the user loses local Pali data

<figure>
  <a className="pali-media-link" href="/img/screens/settings-passkey-recover.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-passkey-recover.png" alt="Pali settings screen for recovering passkey smart accounts" />
</a>
  <figcaption>The recovery screen discovers on-chain passkey accounts that match the selected authenticator credential.</figcaption>
</figure>

If the browser profile, extension storage, or local passkey account metadata is lost, the chain can still contain enough public metadata to recover the account:

1. Pali requests a discoverable WebAuthn assertion from the user's authenticator.
2. Pali queries the factory registry by credential hash.
3. Pali reads each candidate account's recovery metadata.
4. Pali skips accounts already present locally.
5. Pali imports matching accounts back into local wallet state.

Settings recovery discovers deployed accounts and imports every matching account the registry exposes for the credential.

## RP ID and credential name

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-assert.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-assert.png" alt="Browser or operating system passkey assertion prompt" />
</a>
  <figcaption>Recovery and execution require a WebAuthn assertion from the relevant passkey credential.</figcaption>
</figure>

The browser controls the effective RP ID for extension-origin WebAuthn unless an RP ID is provided by the wallet path. Pali labels the default shared credential as `Pali Wallet Passkey` and uses the requested account label for user-facing account association.
