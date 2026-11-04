# Mobile dependency advisory gate

The mobile package has its own npm lockfile. Run `npm ci --ignore-scripts` and
`npm audit --audit-level=moderate`. CI rejects moderate and higher advisories.
The 2026-11-03 lockfile reports no moderate, high or critical advisories.

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
The pinned syscoinjs-lib 1.0.276 loads that chain only when a bridge-proof
operation is requested; it remains installed to preserve that functionality.
There is no patched elliptic release in the registry at this audit. The current
native transfer path signs through the shared keyring's bitcoinerlab secp256k1
implementation; no caller to that legacy proof/signing path was found in the
native app. This is a static reachability assessment, not an exploit test or a
claim that future features cannot reach it. Reassess before enabling that path
or changing those dependencies. No advisory is globally ignored.

The SDK versions and archive integrities remain unchanged by these host
dependency resolutions. Native binary and device qualification remain separate
release requirements.
