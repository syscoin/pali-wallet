# In-place Chrome Web Store wallet upgrade

`offline-legacy-upgrade.journey.spec.ts` exercises a genuine old wallet and a
new extension in the same disposable Chromium profile. It imports the public
synthetic fixture through the old wallet's normal onboarding UI, not by writing
Chrome storage or copying a current-version vault. No human profile, physical
hardware, signature, public-chain transaction or real funds are used.

The baseline is the package distributed by Chrome Web Store for Pali's
`mgffkfbidihjpoaomajlbgchddlicgpn` listing, not an arbitrary older GitHub tag.
The store package observed on 2026-10-16 identifies itself as version `4.0.0`.
Its CRX SHA256 is
`4f051937f8efec9a1f5bc4fa046a3c8f5c1cb1958021838ed967876328fee734`.
The byte-exact ZIP payload SHA256 is
`d2330273ec05a73f655e870c442b3be587e74fd5600d0028ed32df879e925253`.
If the store package changes, update the reviewed artifact pin and observed
version deliberately; a different package is not silently accepted.

## Artifact preparation

The public CRX is available from Google's extension update service. The CI
configuration pins its exact SHA256. The preparation helper verifies the CRX3
envelope's RSA/ECDSA signatures and binds a valid publisher public-key hash to
the expected extension ID before extracting its untouched ZIP payload:

```sh
node e2e/scripts/prepare-store-upgrade-artifact.cjs \
  /absolute/pali-current-store.crx \
  /absolute/pali-current-store-payload.zip \
  4f051937f8efec9a1f5bc4fa046a3c8f5c1cb1958021838ed967876328fee734 \
  mgffkfbidihjpoaomajlbgchddlicgpn
```

The helper emits public artifact identities and proof-check results as JSON.
It does not claim a pinned Google Web Store verifier key, install an extension,
rewrite a manifest, or publish anything. Its unit tests cover RSA/ECDSA success,
changed archive bytes, wrong hashes/IDs, missing publisher binding, duplicate
headers and malformed bounds.

## Running the journey

Pass the store ZIP/version and an exact current production ZIP. The current
manifest version must match this checkout's package version. Use a fresh run
ID: the journey refuses to reuse its unpacked extension directories.

```sh
PALI_E2E_RUN_ID=store-upgrade-unique \
PALI_LEGACY_EXTENSION_VERSION=4.0.0 \
PALI_LEGACY_EXTENSION_ZIP=/absolute/pali-current-store-payload.zip \
PALI_LEGACY_EXTENSION_SHA256=d2330273ec05a73f655e870c442b3be587e74fd5600d0028ed32df879e925253 \
PALI_CURRENT_EXTENSION_ZIP=/absolute/pali-wallet-production-chrome.zip \
PALI_CURRENT_EXTENSION_SHA256=<reviewed-current-zip-sha256> \
yarn e2e:harness offline-legacy-upgrade.journey.spec.ts
```

The launch-time deny proxy never forwards HTTP or CONNECT traffic. Exact
read-only Blockbook and standard JSON-RPC responses are fulfilled locally;
all other HTTP(S) requests are denied. This is a browser egress fence, not an
OS-wide firewall claim.

The old UI creates two UTXO and two EVM accounts, imports a synthetic SPT,
sets a nondefault autolock duration, adds a custom network, displays a history
row and grants a local dapp ordinary account access. The browser closes before
the current ZIP replaces the old package at the same stable extension path.
Each phase verifies the actual executing worker against that artifact's disk
hash. The same profile and extension ID must survive without a seed reimport.

The historical store UI is driven in a genuine browser-action `POPUP` context:
it refuses an ordinary `app.html` tab. The fixture uses Chromium's documented
extension toolbar-action/package-load debugging APIs and a loopback-only CDP
connection to this run's disposable browser. Activating the new package through
`Extensions.loadUnpacked` matters: copying files then restarting can retain old
unpacked service-worker bytecode. No cache, storage, guard or context type is
patched to make the test pass.

The new wallet must start locked, reject a wrong password, unlock the same
accounts/settings/token/network. The old store release scoped site grants to
bare `host:port`; the new wallet correctly does not silently extend those grants
to a complete HTTP/HTTPS origin. The journey requires empty passive account and
permission responses first, then performs explicit normal Connect approval and
checks that the new origin-bound grant survives another restart. Existing users
must reconnect those old sites, not reimport their wallet. Standard dapp
responses are checked for private fields without reporting whole response
bodies. The first upgraded history reads fail deliberately so
the old Activity row must come from retained wallet state, not a fresh backend
response. During those denied reads, the native balance must remain explicitly
unknown or retain its previously known value; a failed read must not become a
loaded zero balance. A second cold browser restart verifies the upgraded persisted state
and separate UTXO/EVM vault storage again.

Before that controlled second restart, the journey uses normal Lock and waits
for the public persisted selected-account ID to reflect the change. This keeps
upgrade-data preservation separate from an account-selection crash-durability
test. Do not infer guaranteed persistence after an immediate uncheckpointed
browser termination from this journey.

`legacy-upgrade.json`, masked screenshots, worker hashes and Playwright
artifacts are written beneath that run's artifact directory. Only narrow public
account/metadata projections and leakage booleans enter the JSON report.

This is an unpacked-package, stable-ID browser upgrade simulation. It does not
claim that Chrome Web Store rollout, extension signing/review, an OS/browser
upgrade or physical hardware-wallet behavior has been tested.
