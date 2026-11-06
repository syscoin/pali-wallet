# Local Sysweb3 transaction recovery review build

The extension and mobile lockfiles pin `sysweb3-keyring-2.1.5-speedup-9bcced4.tgz` by SHA-512. Its SHA-256 is `d7b89b9184883f2375b7bd30a4f1ecab88900dc634f5ae551d2ae4302c3e8184`.

The included source patch applies to Sysweb3 commit `547d834cbf9be7ae880fde50e70122572164c836`, the Keyring 2.1.5 release merge. It reproduces the production source in `9bcced476d32ad60c594dafaaa1cd74bc44e8c06`. From that exact SDK checkout, run `git apply --unidiff-zero` with the source patch, install its locked dependencies and run the following from `packages/sysweb3-keyring`.

```sh
npm run build
node ../../scripts/package/copy
npm pack ./dist --ignore-scripts
```

The dependency metadata matches the official 2.1.5 package. Comparing installed trees changes only the CJS, ESM, source-map and declaration output for `evm-fees`, `software`, `transactions/ethereum`, `transactions/evm-cancellation`, `transactions/evm-local-signer`, `transactions/evm-submission` and `types`. Both hosts install this archive through their locked dependency installs. Native qualification compares the installed tree with the archive and binds evidence to the archive SHA-256.
