---
title: Recovery and backups
---

Backups matter because Pali is non-custodial. The wallet cannot recover a seed phrase, password, private key, or passkey authenticator secret for you.

## Seed phrase backup

Write down your wallet seed phrase and keep it offline. Anyone with the seed phrase can control the derived accounts.

## Unlock password

The optional **Suggest a memorable password** action creates an unlock password, not your Secret Recovery Phrase. Save it in your password manager. A smart-account passkey does not replace the wallet unlock password.

## If you forget the password

On the locked screen, select **Forgot password? Recover with seed**, enter this wallet's Secret Recovery Phrase, and choose a new password. The old password is not required. A different phrase is refused before the wallet is reset.

The current flow recreates the first seed-derived HD account. Re-add other seed-derived accounts in their original derivation order. Recovery does not move your funds.

Your seed cannot decrypt separately imported keys encrypted with the forgotten password; keep their own backups. Reconnect hardware wallets. Custom settings and smart-account/passkey setup need their own records or backups and are not guaranteed by seed recovery alone.

If recovery fails, check your phrase and retry. If it keeps failing, restart your browser. Never clear wallet storage to work around an operational error.

## Unlocking and passkey changes

An unavailable browser service, storage problem, or unsupported cryptographic capability can prevent unlocking without meaning that your password is wrong. Read the error, restore the required service or connection, and retry unlocking. Do not delete or reimport the wallet to work around an operational error. Operational errors do not count as failed password attempts.

Replacing a passkey can leave both the previous and replacement credentials available. The previous credential may still control another chain or a shared policy. Do not delete either credential just because setup was cancelled or failed; first confirm which credentials the relevant accounts still require. Keep the current wallet data while investigating an interrupted change.

## Passkey backup status

Passkeys can be device-bound or synced by the platform account provider. Pali surfaces backup-related status where available, but the exact behavior depends on the authenticator, browser, and operating system.

You may see status that suggests whether a passkey is device-bound, backup-eligible, or backed up/synced. A synced passkey is usually more convenient because it can follow you through a platform account such as Apple, Google, or Microsoft. A device-bound passkey or hardware security key can be stricter, but losing that device may make recovery harder.

| Status you may see | What it means | Convenience | Security tradeoff | Good fit |
| --- | --- | --- | --- | --- |
| Backed up or synced | The passkey appears to be stored by a platform passkey provider and may sync to other trusted devices. | Highest. You can often recover after replacing a phone or laptop by signing back into the platform account. | The passkey secret is still protected by the platform passkey system, but the security boundary includes the platform account, account recovery process, and synced devices. | Everyday wallets, dapp accounts, institution onboarding, and smaller balances. |
| Backup eligible | The authenticator says the passkey can be backed up or synced, but it may not currently be synced. | Medium to high, depending on whether sync is enabled. | Future platform settings may move the credential into cloud sync. Review the provider and device settings if this matters to you. | Users who want recovery flexibility but still want to inspect whether sync is active. |
| Device-bound or not backed up | The passkey appears tied to one authenticator or device. | Lower. If the device is lost and no other recovery path exists, recovery can be harder or impossible. | Stronger isolation because control is concentrated in that authenticator instead of a cloud-synced account. | Larger balances, higher-security accounts, hardware security keys, and cold-wallet-style usage. |
| Unknown or unavailable | The browser, OS, or authenticator did not expose enough backup information. | Unknown. | Do not assume either cloud recovery or device-bound isolation. Treat it as ambiguous until you verify the authenticator setup. | Temporary use, testing, or cases where you can independently verify the passkey provider. |

Cloud-synced passkeys are still secure for normal use: the private key is not handed to Pali or the dapp, WebAuthn remains origin-bound, and user verification is still performed by the platform authenticator. The tradeoff is that the platform account becomes part of your wallet security model. For cold storage, treasury funds, or large long-term balances, prefer a device-bound authenticator or hardware security key and keep only smaller operational funds in synced passkey-controlled accounts.

Backup status is a signal to help you choose between convenience and security. It does not replace your seed phrase backup, and it does not mean Pali or an institution can recover a passkey secret for you.

## Recovering smart accounts

**Restoring wallet records and replacing account control are different operations.** Restoring a seed or discovering an existing smart account brings records back into Pali; it does not bypass the account's current signing policy or undo a completed guardian recovery.

Pali smart-account recovery depends on the installed modules. A passkey-controlled account needs the relevant WebAuthn credential to approve future actions. A guardian recovery module can replace the active validator after the configured timelock if the guardian threshold signs the recovery intent. The recovery flow may:

1. Reconstruct deterministic Pali account records from wallet metadata.
2. Ask for a WebAuthn assertion when a passkey validator must prove control.
3. Use guardian recovery when the active validator needs to be replaced.
4. Skip accounts already in the wallet.
5. Show recoverable accounts with balance and activity hints where available.
6. Import the accounts selected by the user.

### Guardian recovery quick guide

- Set up a separately controlled guardian while your current approval method still works. New policies offer 3- or 7-day waits; the 10-minute choice is for known testnets only. Existing on-chain settings remain authoritative.
- Start recovery with the configured guardian and a replacement approval method you control. The old method remains active until the request is finalized on-chain. After the waiting period, finish recovery before its expiry; the account address and funds stay in place.
- For an unexpected request, use **Disable guardian recovery** from that account's recovery settings while you still control its current approval method. Confirmed removal invalidates pending recovery and removes the recovery path; it cannot undo a recovery already finalized. This action needs gas. Check an uncertain transaction on-chain before retrying.
- Optionally enroll the deployed smart account in **Sysnode Account → Recovery alerts** using a verified email and a wallet signature. No keys are shared, and email cannot cancel recovery. Verify that monitoring is active; a delayed or missing email is not evidence of safety.

Follow the [complete guardian recovery guide](./smart-account-validators#guardian-recovery) for setup, finalization, ownership, and monitoring limits. Keep replacement credentials backed up; do not erase previous credentials that other accounts or networks may still use.

## Dapp creation and wallet recovery

When a dapp calls `wallet_prepareSmartAccount`, Pali creates a smart account and saves durable metadata locally after deployment and any requested validator setup completes. Pali also keeps local records of pending passkey setup before installation, so an interrupted change does not silently discard those recovery details. These records do not replace a seed backup or access to the passkey.

If a smart account exists on-chain and is missing locally, use Pali's wallet recovery flow. Pali skips accounts already present locally and lets the user choose which remaining accounts to import.

## Recovery screens

These screenshots use the English interface and example accounts. Labels and networks may differ in your wallet.

### Choose a guardian

<figure>
  <a className="pali-media-link" href="/img/screens/settings-smart-account-recover.png" target="_blank" rel="noreferrer">
    <img src="/img/screens/settings-smart-account-recover.png" alt="Pali guardian address and recovery waiting-period choices" />
  </a>
  <figcaption>Choose the guardian address and waiting period before approving setup. The 10-minute option shown is for testnets; new production policies offer 3 or 7 days.</figcaption>
</figure>

### Review recovery removal

<figure>
  <a className="pali-media-link" href="/img/screens/guardian-recovery-disable.png" target="_blank" rel="noreferrer" style={{ maxWidth: 400, margin: '0 auto' }}>
    <img src="/img/screens/guardian-recovery-disable.png" alt="Pali confirmation for disabling guardian recovery" />
  </a>
  <figcaption>Review the account, network, and warning before confirming. This removes guardian recovery on-chain; it does not just disable emails.</figcaption>
</figure>

### Verify alert monitoring

<figure>
  <a className="pali-media-link" href="/img/screens/sysnode-recovery-enrollment.png" target="_blank" rel="noreferrer" style={{ maxWidth: 400, margin: '0 auto' }}>
    <img src="/img/screens/sysnode-recovery-enrollment.png" alt="Sysnode linked recovery-alert account awaiting initial chain checks" />
  </a>
  <figcaption>Linking an account is not enough: this example is still checking chain history. Wait for active monitoring, and remember that alerts can be delayed.</figcaption>
</figure>
