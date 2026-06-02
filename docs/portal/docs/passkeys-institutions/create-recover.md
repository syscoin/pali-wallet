---
title: Create and recover passkey accounts
---

`wallet_createPasskeyAccount` is intentionally idempotent for dapp onboarding. Pali checks recoverable on-chain accounts before creating a new credential/account path.

## Smart account and factory structure

The passkey system has two on-chain pieces:

- **Factory:** creates accounts, computes counterfactual addresses, exposes recovery lookups, and can deploy plus execute the first action.
- **Smart account:** stores recovery metadata, nonce, sponsor policy, and validates WebAuthn/P-256 execution proofs before running calls.

The factory account parameters include:

| Parameter | Meaning |
| --- | --- |
| `recoveryId` | Wallet-scoped recovery anchor derived from Pali wallet context, chain id, and factory address. |
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

## Recovery-before-create behavior

When a dapp requests a passkey account:

1. Pali verifies the active chain supports passkey smart accounts.
2. Pali checks whether the passkey can recover an on-chain account matching the requested sponsor policy.
3. If the matching account exists locally, Pali reuses it.
4. If the matching account exists on-chain but not locally, Pali imports it.
5. If an account exists for the same sponsor URL hash but mode or signer differs, Pali rejects with a recovery mismatch.
6. If no matching account exists, Pali proceeds with new account creation.

## What determines the address?

The smart account address is derived from factory inputs including passkey public coordinates, credential hash, origin data, RP ID hash, recovery ID, and deployment salt. Sponsor URL text is not itself the address seed, but sponsor policy is used by the recovery matching logic for institution-scoped onboarding.

## If the user loses local Pali data

<figure>
  <a className="pali-media-link" href="/img/screens/settings-passkey-recover.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/settings-passkey-recover.png" alt="Pali settings screen for recovering passkey smart accounts" />
</a>
  <figcaption>The recovery screen discovers on-chain passkey accounts that match the restored wallet and authenticator.</figcaption>
</figure>

If the browser profile, extension storage, or local passkey account metadata is lost, the chain can still contain enough public metadata to recover the account:

1. The user restores or opens Pali with the wallet context that anchors the recovery ID.
2. Pali requests a discoverable WebAuthn assertion from the user's authenticator.
3. Pali queries the factory registry by recovery ID and credential hash.
4. Pali reads each candidate account's recovery metadata.
5. Pali skips accounts already present locally.
6. Pali imports matching accounts back into local wallet state.

For dapp-driven create/recover, Pali also compares the recovered account's sponsor mode, signer, and URL hash to the dapp's requested sponsor policy. This prevents an institution from silently binding the user to a different sponsor policy than the one the dapp requested.

## RP ID and credential name

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-assert.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-assert.png" alt="Browser or operating system passkey assertion prompt" />
</a>
  <figcaption>Recovery and execution require a WebAuthn assertion from the relevant passkey credential.</figcaption>
</figure>

The browser controls the effective RP ID for extension-origin WebAuthn unless an RP ID is provided by the wallet path. Pali labels the default shared credential as `Pali Wallet Passkey` and uses the requested account label for user-facing account association.
