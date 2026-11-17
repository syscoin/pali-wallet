# Mobile dependency advisory gate

The mobile package has its own npm lockfile. Run `npm ci --ignore-scripts` and
`node scripts/check-dependency-advisories.cjs`. The helper runs the full
`npm audit --json --audit-level=moderate`; CI rejects moderate and higher
advisories except the explicitly approved, expiring exception below.
The unfiltered audit still reports that advisory as high severity.

Parent/version-scoped overrides reuse the extension's reviewed choices:
- isomorphic-fetch 2.2.1 uses node-fetch 2.7.0.
- Ledger's ethers 6.14.1 uses ws 8.21.0; React Native/Metro retain ws 7.5.13.
- Ledger and MetaMask UUID callers use CommonJS-capable uuid 11.1.1.

The MetaMask UUID override crosses major versions. Its inspected caller uses
`v4()` in its Node-only filesystem helper; Ledger callers also use `v4()`.
The native software keyring import does not load Ledger modules.

Four low-severity dependency nodes remain for
[GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84),
rooted in elliptic 6.6.1 under the old eth-proof/Merkle-trie dependency chain.
The pinned syscoinjs-lib 2.0.0 includes that dependency chain.
There is no patched elliptic release in the registry at this audit. The current
native transfer path signs through the shared keyring's bitcoinerlab secp256k1
implementation; no direct native-app eth-proof caller was found. This static
inspection does not establish that all transitive paths are unreachable.
Reassess before enabling that path or changing those dependencies.
No advisory is globally ignored.

The SDK versions and archive integrities remain unchanged by these host
dependency resolutions. Native binary and device qualification remain separate
release requirements.

## Temporary picomatch exception

The user explicitly approved this scoped exception on 2026-11-17. It is risk
acceptance, not a dependency fix. The hard expiry is 2026-11-24T00:00:00Z, for
only GHSA-fc5q-39xc-vjpf/source1247710 on the exact reviewed mobile picomatch
2.3.2/4.0.7 identities. Root-lock version 4.0.5 is recorded for provenance;
there is no extension-audit exception. These versions remain unpatched.
Other moderate or higher advisories still fail.

Requalified on 2026-11-17 for source f92421ae1 under the same approval and
expiry: the clean normal production Chrome artifact and normal Android
JavaScript/Hermes export exclude these modules. All 5,643 Android source bodies,
410 SDK artifacts and all packaged extension JavaScript were checked. The
Android export uses the normal source/Metro configuration without QA aliases.
This is JavaScript runtime evidence, not a new APK, native compile or device
qualification. The older Android32 APK remains historical isolated QA evidence;
iOS still has only the common resolver/storage static assessment. Canary30
retains its recorded base-plus-dirty-patch provenance and is not relabeled as a
clean f924 build. The fresh production Chrome build supplies that qualification.
The exception binds their complete production input inventory, exact
locks, parser and consumer bytes, UTC deadline, and reviewed runtime receipt.
Any source/config/dependency/consumer drift closes it until requalification.
This is not build-time safety clearance: Expo/Metro/Jest continue to use the
affected parser. The approval accepts that remaining development/build exposure.
The gate uses that unchanged-input attestation, not a new post-export
absence check. Reuse the existing complete source-map/inventory verifier before
any pin refresh. Device qualification remains separate. Missing evidence or
runtime inclusion is a refusal. No Expo downgrade or severity threshold change
is made.
