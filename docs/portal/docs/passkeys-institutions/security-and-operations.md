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
- sponsor URL metadata if the recovered account uses required sponsorship and Pali cannot infer the URL

Recovery is not a custodial backdoor. The chain provides discoverable public metadata and account lists, but the user still needs the wallet recovery context and the relevant WebAuthn credential to prove control.

## Credential backup status

Pali may surface WebAuthn credential backup status when the browser and authenticator expose it. Treat this as operational signal, not as an on-chain security rule.

Backup status can indicate whether a credential appears device-bound, backup-eligible, or currently backed up/synced by the platform passkey provider. A synced passkey can improve convenience and device-loss recovery because the user may restore the credential through their Apple, Google, Microsoft, or other platform account. The tradeoff is that the effective security boundary now includes that platform account, its recovery process, and any devices where the passkey is synced.

For higher-assurance institutional accounts, decide and document whether synced passkeys are acceptable. Some institutions may prefer platform-synced passkeys for user recovery and onboarding; others may prefer device-bound authenticators or hardware security keys for stronger isolation and a stricter recovery process.

## User communication

Use clear policy text. A good policy explains:

- who operates the sponsor service
- what actions require co-authorization
- whether the institution pays gas
- what happens if the sponsor service is unavailable

## Do not rely on policy text for enforcement

`policyText` is a disclosure and wallet metadata field. Enforcement is through on-chain policy and sponsor proof validation.
