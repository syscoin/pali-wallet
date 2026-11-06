# Local Sysweb3 Speed Up review build

The extension and mobile lockfiles pin `sysweb3-keyring-2.1.5-speedup-e3d70eb.tgz` by SHA-512. Its SHA-256 is `ad8040b02ad40b903cbcd5d1afb59f799df548c06199b48b52e23a478fa44436`.

The included source patch applies to Sysweb3 commit `547d834cbf9be7ae880fde50e70122572164c836`, the Keyring 2.1.5 release merge. It reproduces the production source in `e3d70ebb266584dee1dd28435763d630362966ee`. From that exact SDK checkout, run `git apply --unidiff-zero` with the source patch, install its locked dependencies and run the following from `packages/sysweb3-keyring`.

```sh
npm run build
node ../../scripts/package/copy
npm pack ./dist --ignore-scripts
```

The dependency metadata matches the official 2.1.5 package. Comparing installed trees changes only the CJS, ESM, source-map and declaration output for `evm-fees`, `transactions/ethereum`, `transactions/evm-local-signer`, `transactions/evm-submission` and `types`. Both hosts install this archive through their locked dependency installs. Native qualification compares the installed tree with the archive and binds evidence to the archive SHA-256.
