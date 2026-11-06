# Local Sysweb3 Speed Up review build

The extension and mobile lockfiles pin `sysweb3-keyring-2.1.5-speedup-ff3fa1a.tgz` by SHA-512. Its SHA-256 is `1d68be614e6cfa482e9c3d203b8925a4f542a037df01d982206f9bac616a12ce`.

The included source patch applies to Sysweb3 commit `547d834cbf9be7ae880fde50e70122572164c836`, the Keyring 2.1.5 release merge. It reproduces the production source in `ff3fa1ac8b546eab89fe9fc4a8b4e482b95f063f`. From that exact SDK checkout, run `git apply --unidiff-zero` with the source patch, install its locked dependencies and run the following from `packages/sysweb3-keyring`.

```sh
npm run build
node ../../scripts/package/copy
npm pack ./dist --ignore-scripts
```

The dependency metadata matches the official 2.1.5 package. Comparing installed trees changes only the CJS, ESM, source-map and declaration output for `evm-fees`, `transactions/ethereum`, `transactions/evm-local-signer` and `transactions/evm-submission`. Both hosts install this archive through their locked dependency installs. Native qualification compares the installed tree with the archive and binds evidence to the archive SHA-256.
