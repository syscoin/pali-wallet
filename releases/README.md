# Store update notices

`wallet-updates.json` is public **data**, not an executable update channel. Both
Pali hosts read the same bounded schema. Wallet/account identifiers are never sent.
The file starts empty: no mobile release or store approval is implied.

Publish an entry only after the version is available in the named store. Update
this file through a reviewed PR after publishing; creating a GitHub release or
uploading an artifact is not sufficient. For staged rollouts, Android also checks
Google Play availability for the current installation before offering its updater.

```json
{
  "platform": "android",
  "version": "5.0.1",
  "build": 2,
  "severity": "important",
  "title": "Improved transaction recovery",
  "summary": "Fixes recovery after an interrupted transfer.",
  "publishedAt": "2026-11-12T18:00:00Z",
  "releaseNotesUrl": "https://github.com/syscoin/pali-wallet/releases/tag/v5.0.1",
  "availability": { "status": "published" }
}
```

Use explicit `routine`, `important`, or `critical` severity, based on actual user
impact. Version numbers do not encode severity. Use `critical` for a security
fix requiring prompt action; `important` for substantial correctness fixes;
`routine` for other improvements. Android `build` is the increasing Play version
code. iOS uses the App Store marketing version (and optionally an increasing build).
Chrome uses its numeric manifest version. Prerelease versions are not advertised.
Keep the feed under 32 KiB and at most 24 entries. Notes are plain text; the only
accepted link is to this repository's release notes. No download URLs are allowed.

Before first iOS publication, set its assigned App Store URL in
`source/shared/walletStores.ts`. Android's package and the Chrome listing are
compiled into Pali. Remote metadata cannot substitute a different store/link.

Pali checks at launch/resume and at most every six hours in a running process.
Manual checks have a one-minute cooldown. Important/critical mobile notices use
existing OS notification permission and are deduplicated per release. Users can
enable/disable these alerts in Help & about. An OS-scheduled background check is
best-effort; this is not an APNs/FCM push service and does not promise immediate
delivery while closed.

Android downloads through the official Play In-App Updates SDK. Installation is
explicit on the locked-wallet surface (or a watch-only view), never during a
signing/recovery flow. iOS opens its App Store listing. Chrome requests the store's
update check and lets Chrome install when the extension becomes idle. Pali never
reloads the extension or replaces running code automatically. Expo OTA updates
remain disabled. Store review and platform signing still control executable code.

These identifiers and policy must be checked against the final signed store builds.
Play installation/update testing needs a store-installed build in an eligible
track; sideloaded/emulator builds are not evidence of Play delivery. iOS needs the
assigned listing, and background delivery/notifications need physical-device QA.
