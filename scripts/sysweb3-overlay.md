# Temporary Sysweb3 integration

Pali applies the reviewed runtime changes from [SDK PR #119](https://github.com/sidhujag/sysweb3/pull/119), commit `7659c4a33041b30494eaaf11c35b29910d7e2901`, over its existing npm packages. The SDK PR remains open; package versions stay at the published versions below.

| Package | Published base | Changed artifacts |
| --- | --- | --- |
| `@sidhujag/sysweb3-keyring` | `2.1.20` | 43 CJS, ESM, declaration and source-map files |
| `@sidhujag/sysweb3-network` | `2.0.0` | 12 transport, network-discovery, declaration and export files |
| `@sidhujag/sysweb3-utils` | `1.1.282` | 3 token-metadata implementation, declaration and source-map files |

`sysweb3-overlay.json` records the source commit/tree, compiler, original npm archive integrities, and before/after SHA-256 and byte lengths for all 405 runtime artifacts. Its 58 changed outputs are stored in `sysweb3-overlay.deflate`: 341,058 compressed bytes, expanding to exactly 1,800,057 bytes. The overlay covers both Keyring entry formats, the shared Network transport, and Utils' metadata-only APIs. It keeps published documentation and compiled tests unchanged.

Root and mobile postinstall run the same offline installer. It validates all three packages and all artifact hashes before writing, refuses linked targets and shadowing nested SDK dependencies, and accepts only pristine or exact reviewed bytes. SDK dependency edges from every directly declared Sysweb3 consumer must resolve to these packages. The verifier also rejects `node_modules/node_modules` SDK shadows, which Webpack searches even though Node skips that ancestor. Verified partial installs and exact owned temporary files can resume. Common webpack configuration verifies the overlay before any extension bundle; native qualification verifies it and includes its identity in the build record. Installation never downloads or builds SDK code.

The source was built with the SDK's TypeScript 5.9.3 package configurations and package metadata copier. Network and Utils build before Keyring; Keyring also uses `tsconfig-ledger-host.json` for its ESM host graph. The isolated build used `preserveSymlinks` to resolve its linked development dependencies; Pali and SDK production compiler configurations are unchanged. Runtime output, declarations and maps contain no checkout-specific absolute paths.

To reproduce the artifact inputs, check out the exact SDK commit and follow its pinned CI dependency/staging/build steps. Retrieve the three published base archives named in the manifest and verify their SHA-512 integrities. Compare their runtime inventories with the resulting SDK `dist` inventories: the manifest identifies every admitted difference and target hash. Changes to the source ref, compiler or outputs require a newly reviewed manifest/payload and matching `paliSysweb3Overlay` values in both application manifests.

Apply or verify an installation explicitly:

```sh
node scripts/apply-sysweb3-overlay.cjs
node scripts/apply-sysweb3-overlay.cjs apps/mobile
node scripts/apply-sysweb3-overlay.cjs --verify
node scripts/apply-sysweb3-overlay.cjs --verify apps/mobile
```

After the SDK packages are published and adopted, remove the overlay, install/build hooks, provenance fields and qualification identity component together.
