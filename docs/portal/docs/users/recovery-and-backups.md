---
title: Recovery and backups
---

Backups matter because Pali is non-custodial. The wallet cannot recover a seed phrase, password, private key, or passkey authenticator secret for you.

## Seed phrase backup

Write down your wallet seed phrase and keep it offline. Anyone with the seed phrase can control the derived accounts.

## Passkey backup status

Passkeys can be device-bound or synced by the platform account provider. Pali surfaces backup-related status where available, but the exact behavior depends on the authenticator and operating system.

## Recovering passkey accounts

Pali passkey recovery uses wallet-scoped recovery metadata and on-chain account discovery. The recovery flow:

1. Requests a discoverable WebAuthn assertion.
2. Looks up matching smart accounts from the factory registry and creation logs.
3. Skips accounts already in the wallet.
4. Adds recoverable accounts when sponsor metadata can be resolved.
5. Warns if sponsor URL metadata is needed for a required sponsor policy.

## Dapp create/recover idempotence

When a dapp calls `wallet_createPasskeyAccount`, Pali first checks whether an existing on-chain passkey account matches the requested sponsor policy. If the matching account already exists locally, Pali reuses it instead of creating a duplicate. If it exists on-chain but not locally, Pali can recover it into the wallet.
