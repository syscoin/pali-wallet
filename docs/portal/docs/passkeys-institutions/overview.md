---
title: Passkeys and institutions
---

Pali passkey smart accounts let a dapp request on-chain account creation from the wallet while the user controls execution through WebAuthn.

This is useful for:

- institutional onboarding
- sponsor-backed gas flows
- co-authorized policies
- wallet-managed account recovery after wallet reinstall
- atomic multi-call workflows
- dapps that want passkey UX without building a wallet

## Why zkSYS passkeys are possible

Passkeys use WebAuthn, and WebAuthn's standard signing algorithm is ES256: ECDSA over the P-256 curve, also known as secp256r1. Generic EVM wallets normally use secp256k1 EOAs, so a passkey signature is not directly an EOA signature.

Pali's passkey accounts are zkSYS smart accounts designed around on-chain P-256 verification. The wallet extracts the WebAuthn public key coordinates, challenge, authenticator data, client data, and P-256 signature, then the smart account/factory path verifies that proof against the account's registered metadata. That is what makes device biometrics or platform passkeys usable for account authorization while keeping the private key inside the user's authenticator.

The practical result is a wallet UX that feels like biometric login, but authorizes a chain action:

1. The dapp requests a passkey smart account creation or batch execution.
2. Pali prepares an action hash for the exact chain, account, calls, nonce, deadline, and sponsor policy.
3. The browser/OS asks the user for passkey approval.
4. The zkSYS smart account verifies the P-256 WebAuthn proof on-chain before executing.

## Supported networks

Passkey accounts are not enabled on every EVM chain. They require a configured passkey factory and zkSYS P-256 verification support.

| Network | Chain id | Status in this Pali build |
| --- | --- | --- |
| `zkTanenbaum` | `57057` | Configured. Factory: `0x04a52bc8B5fadBfeBBAF927832d545a270cA0cAb`. |
| `zkSYS` | TBD in wallet config | Intended production target for the same passkey architecture once the factory address is configured in Pali. |

If a dapp calls `wallet_createPasskeyAccount` on a network without a configured factory, Pali rejects the request instead of creating unsupported metadata.

## Dapp method

<figure>
  <a className="pali-media-link" href="/img/screens/passkey-create-disabled.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/passkey-create-disabled.png" alt="Pali wallet_createPasskeyAccount popup with sponsorship disabled" />
</a>
  <figcaption>The default dapp-driven passkey flow should start with sponsorship disabled unless the institution explicitly needs sponsor policy.</figcaption>
</figure>

```js
const account = await window.ethereum.request({
  method: 'wallet_createPasskeyAccount',
  params: [
    {
      label: 'Pali Wallet Passkey',
      sponsor: { mode: 'disabled' },
    },
  ],
});
```

The result includes the smart account `address` and public passkey metadata. Pali returns it only after the creation transaction is confirmed and the deployed account metadata has been verified on-chain.

## Sponsor modes

| Mode | Meaning |
| --- | --- |
| `disabled` | No sponsor policy. The wallet/user pays gas. |
| `gasOnly` | Sponsor service may pay gas. Pali requires a sponsor URL for this mode; if sponsorship fails, wallet-gas fallback can be allowed. |
| `required` | Sponsor co-authorization is required by policy. A signer is required; the sponsor URL is optional when Pali can obtain the signer proof from a local account in the wallet. |

## User control

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-create.png" alt="Browser or operating system passkey creation sheet" />
</a>
  <figcaption>After wallet review, the browser or operating system handles WebAuthn passkey creation.</figcaption>
</figure>

The user sees the requesting site, label, sponsor mode, signer, URL, and policy text before approving. The browser or OS then shows the WebAuthn passkey prompt when a credential or policy assertion is required. Pali shows deployment and confirmation progress before the account is connected to the dapp.

<figure className="pali-video-card">
  <video controls poster="/img/screens/passkey-dapp-onboarding-video.png" src="/video/passkey-dapp-onboarding.mp4" title="Passkey dapp onboarding flow"></video>
  <figcaption>Passkey onboarding flow: branded intro, dapp request, and Pali account approval.</figcaption>
</figure>
