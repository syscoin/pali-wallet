---
title: Security and operations
---

Institutional passkey integrations should be designed like production account infrastructure, not just a login button.

## Network and verifier dependency

Passkey accounts depend on zkSYS support for verifying P-256 WebAuthn signatures. Do not assume a passkey account can be created on any EVM chain just because the chain supports smart contracts. The chain must have the passkey factory deployed and Pali must have that factory address configured for the active chain.

Today, Pali's configured test deployment is `zkTanenbaum` (`57057`). Treat zkSYS production as the production deployment target for the same architecture once its factory is configured in the wallet.

## Operational checklist

- Decide whether each user receives a shared Pali passkey account or a separate credential.
- Decide whether sponsorship is disabled, gas-only, or required.
- Maintain sponsor service uptime if using `required` mode.
- Monitor relayer failures, expired deadlines, and repeated idempotency keys.
- Provide a user support path for lost devices and failed recovery.
- Document whether the institution can co-authorize execution.

## Funding and deployment

Passkey smart accounts can be counterfactual before first use. The first execution may need a deployment gas payer or sponsor path. Your onboarding flow should explain whether users need to fund the account before using it.

The factory can compute the account address before deployment. This is useful for onboarding because a dapp or institution can display or fund the address before the first on-chain transaction.

## Recovery assumptions

Recovery is wallet-scoped and passkey-scoped. A user generally needs:

- the restored Pali wallet context
- the relevant WebAuthn credential
- chain support for the passkey factory

Recovery is not a custodial backdoor. The chain provides discoverable account lists and public recovery metadata for deployed accounts, but the user still needs the wallet recovery context and the relevant WebAuthn credential to prove control.

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

Use clear policy text. A good policy explains:

- who operates the sponsor service
- what actions require co-authorization
- whether the institution pays gas
- what happens if the sponsor service is unavailable

## Do not rely on policy text for enforcement

`policyText` is a disclosure and wallet metadata field. Enforcement is through on-chain policy and sponsor proof validation.
