# Public MiMC arithmetic

Fiat-Crypto v0.1.6, upstream commit `9d0682462646bf645cba7409fa45794dee0418aa`, generates the fixed BN254 scalar-field arithmetic. The macOS arm64 release executable has SHA-256 `a7fc34984f6a82c05227abb2efe622f8c49d6ea95c1d94b7d1daf23034efa6d7`, verified against the official release asset. The upstream tag commit is unsigned. License, copyright and authors are preserved alongside the generated code. This copy selects the upstream MIT license. [Official generator release](https://github.com/mit-plv/fiat-crypto/releases/tag/v0.1.6)

For each word size 32 and 64, run the verified executable from its containing directory, preserving its name:

```sh
./Fiat-Cryptography_v0.1.6_macOS_arm64 word-by-word-montgomery --lang C --static bn254_scalar WORD_SIZE \
  21888242871839275222246405745257275088548364400416034343698204186575808495617 \
  mul square add to_montgomery from_montgomery to_bytes from_bytes
```

The unchanged output is stored as `fiat_bn254_scalar_WORD_SIZE.inc`. SHA-256 is `332ec5acff946e17e8870eeb3861e4f045d0d3a272f97c9d2e5bb522c5f9dd84` for 32 bits and `f961754d5357bfa27c3853a082a65d968322fcec012adf80dc2c4d24ea55f433` for 64 bits. Target pointer width selects the matching generated arithmetic at compile time.

The 220-round, exponent-5, two-input MiMC sponge follows `source/utils/privacy/merkle.ts`. Round constants use the same Keccak seed schedule with first and final constants zero. Concatenated canonical little-endian constants have SHA-256 `3315c814eb7b54dc3cd285c49247fb86742a0ece1671c0ac6933cd66a9a83c2b`.

`mimc_batch.h` specifies the bounded public-input wire format and error-atomic output contract. The native wrappers own input copies and one process-wide operation slot. This module has no Merkle topology, provider, wallet keys, proof witness or signing authority. Its result remains subject to shared caller lifetime, root and chain-anchor verification.
