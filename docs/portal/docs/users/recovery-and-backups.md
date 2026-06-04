---
title: Recovery and backups
---

Backups matter because Pali is non-custodial. The wallet cannot recover a seed phrase, password, private key, or passkey authenticator secret for you.

## Seed phrase backup

Write down your wallet seed phrase and keep it offline. Anyone with the seed phrase can control the derived accounts.

## Passkey backup status

Passkeys can be device-bound or synced by the platform account provider. Pali surfaces backup-related status where available, but the exact behavior depends on the authenticator, browser, and operating system.

You may see status that suggests whether a passkey is device-bound, backup-eligible, or backed up/synced. A synced passkey is usually more convenient because it can follow you through a platform account such as Apple, Google, or Microsoft. A device-bound passkey or hardware security key can be stricter, but losing that device may make recovery harder.

| Status you may see | What it means | Convenience | Security tradeoff | Good fit |
| --- | --- | --- | --- | --- |
| Backed up or synced | The passkey appears to be stored by a platform passkey provider and may sync to other trusted devices. | Highest. You can often recover after replacing a phone or laptop by signing back into the platform account. | The passkey secret is still protected by the platform passkey system, but the security boundary includes the platform account, account recovery process, and synced devices. | Everyday wallets, dapp accounts, institution onboarding, and smaller balances. |
| Backup eligible | The authenticator says the passkey can be backed up or synced, but it may not currently be synced. | Medium to high, depending on whether sync is enabled. | Future platform settings may move the credential into cloud sync. Review the provider and device settings if this matters to you. | Users who want recovery flexibility but still want to inspect whether sync is active. |
| Device-bound or not backed up | The passkey appears tied to one authenticator or device. | Lower. If the device is lost and no other recovery path exists, recovery can be harder or impossible. | Stronger isolation because control is concentrated in that authenticator instead of a cloud-synced account. | Larger balances, higher-security accounts, hardware security keys, and cold-wallet-style usage. |
| Unknown or unavailable | The browser, OS, or authenticator did not expose enough backup information. | Unknown. | Do not assume either cloud recovery or device-bound isolation. Treat it as ambiguous until you verify the authenticator setup. | Temporary use, testing, or cases where you can independently verify the passkey provider. |

Cloud-synced passkeys are still secure for normal use: the private key is not handed to Pali or the dapp, WebAuthn remains origin-bound, and user verification is still performed by the platform authenticator. The tradeoff is that the platform account becomes part of your wallet security model. For cold storage, treasury funds, or large long-term balances, prefer a device-bound authenticator or hardware security key and keep only smaller operational funds in synced passkey accounts.

Backup status is a signal to help you choose between convenience and security. It does not replace your seed phrase backup, and it does not mean Pali or an institution can recover a passkey secret for you.

## Recovering passkey accounts

Pali passkey recovery uses wallet-scoped recovery metadata and on-chain account discovery. The recovery flow:

1. Requests a discoverable WebAuthn assertion.
2. Looks up matching smart accounts from the factory registry and creation logs.
3. Skips accounts already in the wallet.
4. Reads account recovery metadata for each candidate account.
5. Adds recoverable accounts to the wallet.

## Dapp creation and wallet recovery

When a dapp calls `wallet_createPasskeyAccount`, Pali creates a passkey account and saves it locally after the deployment transaction confirms and the on-chain metadata matches the prepared passkey credential.

If a passkey account exists on-chain and is missing locally, use Pali's wallet recovery flow. Recovery can import multiple deployed accounts for the same credential because account discovery comes from the factory registry and creation logs.
