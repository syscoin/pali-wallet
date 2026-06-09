---
title: Security and operations
---

Pali smart accounts should be treated like production account infrastructure, not just a nicer login button. The account contract holds assets, and installed modules decide who can move those assets.

## Network and module dependency

Do not assume a Pali smart account can be created on any EVM chain just because the chain supports smart contracts. The chain must have the Pali factory and module addresses configured in the wallet. Passkey validators also require P-256 WebAuthn verification support.

Today, Pali's configured test deployment is `zkTanenbaum` (`57057`). Treat zkSYS production as the production deployment target once the factory and modules are configured in the wallet.

## Operational checklist

- Decide which validator should control the account: passkey, wallet-owned ECDSA, composite, or a later guardian recovery path.
- Treat external ECDSA owners as high-risk. If an address is not a local Pali account, users must understand that it can approve future account actions.
- Decide whether guardian recovery is enabled, who the guardians are, what threshold is required, and how long the recovery delay should be.
- Keep the gas payer account funded for deployment and smart-account executions.
- Monitor failed deployments, failed module installs, expired recovery schedules, and repeated recovery attempts.
- Provide a user support path for lost passkeys, lost wallet state, and failed guardian recovery.

## Creation, funding, and deployment

Pali smart accounts are counterfactual while Pali prepares creation. Pali stores durable metadata locally and deploys the account through the configured factory. Account creation needs a wallet gas payer with enough native token for deployment and any immediate module replacement.

The current flow does not rely on remote gas sponsorship. Pali deploys with a wallet-owned bootstrap validator, then installs the requested validator through an account execution when needed.

The factory can compute the account address before deployment. This is useful for display and funding UX. Production integrations should treat the account as usable after Pali returns success from `wallet_prepareSmartAccount`.

## Validator assumptions

Validators are the account's authorization boundary:

- A P-256 WebAuthn validator means the passkey proof authorizes actions.
- An ECDSA validator means the configured owner addresses authorize actions.
- A composite validator can combine child validators under a threshold.

Installing a malicious validator is equivalent to giving that validator control of the account. Dapps that request module installation or validator replacement must be reviewed carefully by the user.

## Guardian recovery assumptions

Guardian recovery is a delayed validator replacement path. A guardian signature schedules recovery to a new recovery target. After the delay has passed, anyone can finalize the recovery transaction. Pali uses a fresh recovery salt per attempt and the contract permits only one active recovery schedule per account, so a stale guardian signature cannot be replayed forever and parallel active recoveries are blocked.

Guardian recovery is not a custodial backdoor. It only works if the module is installed and the configured guardian threshold signs the recovery intent.

## Credential backup status

Pali may surface WebAuthn credential backup status when the browser and authenticator expose it. Treat this as operational signal, not as an on-chain security rule.

Backup status can indicate whether a credential appears device-bound, backup-eligible, or currently backed up/synced by the platform passkey provider. A synced passkey can improve convenience and device-loss recovery because the user may restore the credential through their Apple, Google, Microsoft, or other platform account. The tradeoff is that the effective security boundary now includes that platform account, its recovery process, and any devices where the passkey is synced.

| Credential status | Institution policy implication | User experience | Risk boundary |
| --- | --- | --- | --- |
| Backed up or synced | Accept when account recovery and onboarding convenience matter more than strict device isolation. | Best device-replacement and multi-device experience. Often the platform default for consumer passkeys. | Trust extends to the platform account, platform recovery flow, and synced devices. |
| Backup eligible | Decide whether eligibility alone is acceptable, because the credential may become synced later. | Flexible, but users may not understand whether sync is active. | Requires clear user guidance and periodic status review if the account value changes. |
| Device-bound or not backed up | Prefer for high-value, treasury, admin, or cold-style accounts. | More friction and more support burden if the device is lost. | Stronger isolation to a specific authenticator or hardware key. |
| Unknown or unavailable | Avoid for high-assurance policy decisions unless you have out-of-band authenticator controls. | User may proceed, but the institution cannot confidently classify the credential. | Ambiguous; do not treat as proof of cloud backup or proof of device-bound isolation. |

For higher-assurance institutional accounts, decide and document whether synced passkeys are acceptable. Synced passkeys are still secure for common wallet and dapp use because Pali and the dapp never receive the passkey private key, WebAuthn remains origin-bound, and the platform authenticator still performs user verification. They are simply not the right default for cold storage, treasury controls, or large long-term balances unless the institution explicitly accepts the platform-account recovery boundary.

## User communication

Use clear language in dapp copy and user support material. A good explanation tells the user:

- who can currently authorize the account
- whether a passkey, ECDSA owner, or composite policy is being installed
- whether any owner address is external to Pali
- whether guardian recovery is enabled and how long recovery takes
- who pays gas for deployment and account actions

## Do not rely on display text for enforcement

Wallet labels and explanatory text are disclosure fields. Enforcement is through on-chain modules and signatures.

## Local storage model

Pali stores these smart-account concepts:

- The passkey credential profile is lightweight local state for WebAuthn credentials: credential id, credential hash, public key, backup status, and display name.
- Smart-account metadata belongs to each account: address, chain id, factory, deployment salt, descriptor, active validator, available modules, installed modules, and deployment status.

The credential profile can exist before an account is created. A local smart account represents a Pali-managed account record that can be deployed, operated, and recovered according to its modules.
