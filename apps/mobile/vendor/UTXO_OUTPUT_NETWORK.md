# Reviewed UTXO output network build

The extension and mobile use the same archives for SyscoinJS and its transaction builder. SyscoinJS passes the selected network to the builder for native transfers, SPT sends, burns and mints, SYS-to-allocation and PoDA. The builder uses that network to check the spending scripts for recipients and change before calculating output sizes and dust limits.

| Package | Source baseline | Reviewed source | Archive SHA-256 |
| --- | --- | --- | --- |
| SyscoinJS 1.0.280 | `98514661ad8a513e60e8c35779c6e1dfc4352078` | `ff7d6e69bf29f75e330d7dcd20c4d8ebc425ee06` | `cb6a834d36f4a7817aa513b56a16bffd9d7a49fcca00d36eb5db9846342cf6c5` |
| syscointx-js 1.0.128 | `0a6795db7062118589da9f253c14aa492d58acef` | `ae4edfe1be48807adfae90899cd1ad72f7396268` | `ef31200274b34bdb829fe8a2b6e09668cb7a45e3bf975b90d41d9f43eec97ac5` |

Apply the matching `*-output-network.patch` to its source baseline with `git apply --unidiff-zero`, then run `npm pack --ignore-scripts --offline` at the package root. The package manifests match their registry versions. Yarn resolutions and npm overrides bind transitive callers to the same local archives as the direct dependencies.
