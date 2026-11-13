# Build and release Pali Wallet

This guide covers the extension. For native toolchains, signing, build numbers and store preparation, see the [mobile build guide](../apps/mobile/README.md#run).

## Extension builds

Install the Node version in [`.nvmrc`](../.nvmrc) and Yarn 1.22.22, then run `yarn install --frozen-lockfile` from the repository root.

- `yarn run build:chrome` builds the production Chrome extension in `build/chrome/` and creates a versioned ZIP in `build/`.
- `yarn run build:canary` builds the diagnostic Canary variant as `5.0.0.N`; each invocation reserves a new increasing number from the repository's Canary counter. `yarn run build:canary:store` also requires a clean source checkout. Use the production Chrome ZIP for a regular release.
- `yarn run build` also runs the Firefox and Opera build scripts. Test each target in its browser before distribution.

The extension and mobile source versions are `5.0.0`. `package.json` is canonical for the extension version and short description; both manifest templates read those fields. Keep the committed root manifest synchronized when deliberately changing the release version. Unpacked development builds display `5.0.0 Development` while keeping numeric version `5.0.0`. Canary uses `5.0.0.N` and the label `5.0.0 Canary (N)`; production artifacts use `5.0.0`. Source changes and draft GitHub releases do not update the published store listing. The manifest and ZIP use the same version. Build manifests and receipts stay under ignored `.pali-build/`; the Chrome production/Canary wrappers do not rewrite the tracked manifest. The older Firefox/Opera scripts do rewrite it.

Canary numbers use a fast-forward-only Git counter at `refs/heads/pali-canary-builds/5.0.0`, separate from mobile build numbers. Concurrent builders reserve distinct numbers; failed builds consume their number. GitHub access to the canonical repository is required, and an unavailable/malformed counter fails the build instead of choosing a local or timestamp fallback. The suffix is capped at Chrome's 65,535 limit; change the three-part Canary base deliberately before exhaustion. Store builds and receipts identify the exact clean source commit, but still require normal release review and store submission.

The Canary base is read directly from `package.json`, not configured separately. A `5.0.1` upgrade-test branch therefore uses `refs/heads/pali-canary-builds/5.0.1` and produces `5.0.1.N`; it does not update the production store item. Chrome compares all numeric version components, so an installed `5.0.1.N` will not automatically downgrade to `5.0.0.N`. Use an isolated test profile for such upgrade/downgrade tests.

Use `build:canary:store` for Web Store uploads: it omits the local development `key` field, which the store rejects. Regular `build:canary` keeps that key so unpacked builds retain their local extension ID.

After the reviewed PRs merge, run **Canary release candidate** in GitHub Actions from `master`. It checks out the exact selected master commit, reserves the next Canary number, verifies the archive against its receipt, and creates a draft GitHub prerelease with both files. It does not publish to the Web Store. This provides a Canary build without bumping the production package version or triggering a production release.

The [release workflow](../.github/workflows/release.yml) runs on pushes to `master`, `develop`, and `pre-release`. It skips release builds when the package version is unchanged. A version change builds the Chrome production and Canary ZIPs, checks that exactly one of each exists and that the release tag is new, then creates a **draft prerelease** tied to the triggering commit. Review the artifacts and required checks before publishing. Creating a GitHub draft does not submit or publish the extension to the Chrome Web Store.

## Validation before distribution

Review the checks and findings for the exact candidate commit. Complete the browser, native-device, hardware-wallet and funded-network tests that apply to the release. See the [mobile testing requirements](../apps/mobile/qualification/README.md).

Promote the tested artifact and retain its source revision and build receipt. Store submission, approval and rollout are separate from creating a GitHub release. Canary and production use separate store items; do not upload a Canary build to the production item.

The Canary item is `ogkamgifjlkfkjekifikgpmlkkmcabpk`; production is `mgffkfbidihjpoaomajlbgchddlicgpn`. Canary packages have an amber C icon, a Canary label in the wallet, and a separate dapp-wallet identity. Update checks use the matching store item and release feed. Unpacked builds do not receive Store update notices.

## Other browser targets

Chrome is the maintained extension target. The Firefox and Opera scripts remain available for development: `dev:firefox`, `dev:opera`, `build:firefox` and `build:opera`. Test those builds in their browsers before release.
