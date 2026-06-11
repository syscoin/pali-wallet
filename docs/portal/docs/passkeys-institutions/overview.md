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

## Two roles: validators sign, guardians recover

ERC-7579 separates module roles, and Pali leans into that separation deliberately:

- **Validators** are the signing authority. A validator decides whether a given approval (passkey proof, ECDSA signature, composite policy result) authorizes an account action. Only validators can approve transactions.
- **Executors** add account behavior that is not a signature. Pali's guardian recovery module is an executor: guardians cannot sign or move funds, they can only schedule a timelocked replacement of the active validator.

Keeping these roles separate is what makes recovery safe to recommend. A guardian compromise does not give an attacker signing power — it gives them a delayed, visible, cancelable recovery attempt.

## Composite signing policies

The composite validator combines child validators under a threshold, which turns one account into a policy engine:

- **1-of-N** — any of several authenticators can approve. Convenient for personal accounts with a passkey on each device.
- **t-of-N** — a quorum must approve. The natural shape for shared treasuries, desks, and team-controlled accounts.
- **N-of-N** — every configured validator must approve. Maximum-assurance accounts.

Composites can nest: a child of a composite can itself be a composite, so hierarchical policies — for example, "the CFO key AND (any 2 of 3 desk passkeys)" — are expressible without custom contracts. Guardian recovery remains independent of whatever validator policy is active.

## Validator agility and post-quantum readiness

Because authorization lives in replaceable modules, the account is not married to any signature scheme. Today Pali ships ECDSA (the wallet-owned default), P-256 WebAuthn passkeys, and the composite validator. When new validator types are deployed — including post-quantum signature schemes — they install onto the same account at the same address. At that point per-transaction authorization can run with no ECDSA in the loop at all. Funds, history, and integrations never move; only the signing authority evolves.

## Why passkeys matter

Passkeys use WebAuthn. Most platform passkeys sign with ES256, which is ECDSA over the P-256 curve. A normal EVM EOA uses secp256k1, so a passkey is not a normal Ethereum private key.

Pali's P-256 WebAuthn validator lets the smart account verify passkey proofs on-chain. The user approves with the browser or operating system passkey UI, while the passkey private key stays inside the authenticator or platform account.

## For institutions and teams

Institutions should treat Pali smart accounts as account infrastructure, not only as a passkey login flow. The useful controls are operational:

- Use passkeys for lower-friction onboarding when a user should not handle a raw private key.
- Use wallet-owned ECDSA or composite validators when a team, hardware wallet, or controlled owner set must co-authorize actions.
- Use guardian recovery for a delayed replacement path when the active authenticator is lost.
- Keep gas payer accounts funded because the current Pali flow uses wallet-paid deployment and execution.
- Document who controls each validator, who the guardians are, and what the recovery delay means for the user.

The wallet UI is intentionally explicit when a dapp requests an external ECDSA owner. That address can approve future account actions, so Pali shows it separately and requires acknowledgement before continuing.

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

Pali smart accounts work on compatible EVM chains where the Pali smart-account infrastructure exists at the addresses Pali expects. The shipped wallet config includes known deployments, and Pali can also deploy the required infrastructure for the active EVM network from the wallet itself. If the network exposes the canonical CREATE2 deployer, open Pali Settings, go to Advanced, and use **Smart account setup** to deploy the missing factory and module contracts.

Passkey validators need P-256 WebAuthn verification support. Many modern EVM environments expose this through a P-256/passkey precompile, but integrators should verify chain support before relying on passkey validators.

| Network | Chain id | Status in this Pali build |
| --- | --- | --- |
| `zkTanenbaum` | `57057` | Configured for the Pali smart-account factory and modules. |
| `zkSYS` | Production config dependent | Intended production target once the factory and module addresses are ready for the production network. |
| Other compatible EVM chains | Chain-specific | Use Pali's in-wallet Smart account setup flow to deploy the required infrastructure when the network has canonical CREATE2 support. |

If a dapp calls `wallet_prepareSmartAccount` before the active chain has the required contracts available to Pali, Pali rejects the request instead of creating local-only metadata.

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
