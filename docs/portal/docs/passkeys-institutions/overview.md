---
title: Pali smart accounts
---

Pali smart accounts are contract wallets that Pali can create, connect, and operate for the user. The everyday UX can feel like a normal wallet account: review the dapp request, approve with a passkey or wallet key, and Pali submits the transaction. Under the hood the account is modular, so authorization and recovery can be upgraded without replacing the account address.

For non-technical users, the important idea is simple:

- **One account address:** the smart account is the address dapps see and funds are held there.
- **Flexible sign-in:** a passkey, a wallet-owned ECDSA key, or a co-managed policy can authorize actions.
- **Better recovery options:** guardian recovery can replace the active validator after a timelock.
- **Batch actions:** multiple contract calls can be approved as one reviewed action.
- **Clear wallet prompts:** Pali shows what a dapp is asking for before creating or changing the account.

## Technical model

The current Pali account design is based on ERC-7579-style modules and ERC-4337-style execution encoding:

- `PaliSmartAccount` is the account contract. It executes calls, validates signatures through installed validator modules, and exposes EIP-1271 signature checks.
- `PaliSmartAccountFactory` derives deterministic account addresses and deploys accounts with initial modules.
- Validator modules decide who can authorize actions. Pali currently supports ECDSA, P-256 WebAuthn passkeys, and a composite validator.
- Executor modules add account features that are not ordinary signatures. Pali currently uses a guardian recovery executor.
- Pali stores durable account metadata locally so it can reconstruct deterministic accounts by wallet anchor, account index, chain, factory, and module configuration.

The factory creates the account with a bootstrap wallet-owned ECDSA validator first. If a dapp requested a passkey or another supported validator, Pali deploys the account and then performs a wallet-signed module replacement. This keeps deployment deterministic and gives Pali a known local signer for the first on-chain setup action.

## Why passkeys matter

Passkeys use WebAuthn. Most platform passkeys sign with ES256, which is ECDSA over the P-256 curve. A normal EVM EOA uses secp256k1, so a passkey is not a normal Ethereum private key.

Pali's P-256 WebAuthn validator lets the smart account verify passkey proofs on-chain. The user approves with the browser or operating system passkey UI, while the passkey private key stays inside the authenticator or platform account.

## Dapp method

Dapps request creation with `wallet_prepareSmartAccount`:

```js
const account = await window.ethereum.request({
  method: 'wallet_prepareSmartAccount',
  params: [
    {
      label: 'Trading account',
      authenticator: { id: 'p256-webauthn' },
    },
  ],
});
```

If no authenticator is supplied, Pali defaults to a passkey-backed account. Dapps may request an ECDSA validator, but Pali distinguishes wallet-owned ECDSA owners from external addresses. External owner addresses are shown explicitly and require an extra user acknowledgement because those addresses can approve future smart-account actions.

## Supported networks

Smart accounts are not enabled on every EVM chain. The chain must have the Pali factory and modules configured in the wallet. Passkey validators also require P-256 verification support.

| Network | Chain id | Status in this Pali build |
| --- | --- | --- |
| `zkTanenbaum` | `57057` | Configured for the Pali smart-account factory and modules. |
| `zkSYS` | Production config dependent | Intended production target once the factory and module addresses are configured in Pali. |

If a dapp calls `wallet_prepareSmartAccount` on an unsupported network, Pali rejects the request instead of creating local-only metadata.

## User control

<figure>
  <a className="pali-media-link" href="/img/screens/browser-passkey-create.png" target="_blank" rel="noreferrer">
  <img src="/img/screens/browser-passkey-create.png" alt="Browser or operating system passkey creation sheet" />
</a>
  <figcaption>After wallet review, the browser or operating system handles WebAuthn passkey creation when the selected validator is passkey-based.</figcaption>
</figure>

The user sees the requesting site, account label, requested authenticator, and any external ECDSA owner addresses before approving. The browser or OS shows the WebAuthn prompt when Pali needs a new passkey credential. Pali shows deployment, module installation, and confirmation progress before the smart account is connected to the dapp.

<figure className="pali-video-card">
  <video controls poster="/img/screens/passkey-dapp-onboarding-video.png" src="/video/passkey-dapp-onboarding.mp4" title="Passkey dapp onboarding flow"></video>
  <figcaption>Smart-account onboarding flow: branded intro, dapp request, passkey prompt when needed, and Pali account approval.</figcaption>
</figure>
