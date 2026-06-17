# SLH-DSA-SHA2-128-24 WASM Signer

This directory is the expected home for the local-only Pali SLH-DSA signer
artifact:

```text
slhdsa-sha2-128-24.wasm
```

The artifact must be built from the upstream `signers/sphincsplus-128-24`
implementation or a byte-compatible port of that NIST SP 800-230
`SLH-DSA-SHA2-128-24` signer. The existing upstream `signer-wasm` target is
for C13 and must not be used with Pali's SHA2-128-24 verifier.

The extension loads the Emscripten glue:

```text
slhdsa-sha2-128-24.js
```

This JavaScript file is not a separate JavaScript implementation of SLH-DSA.
It is the Emscripten loader/glue around `slhdsa-sha2-128-24.wasm`; it fetches
or instantiates the WASM module, exposes `_malloc`, `_free`, `HEAPU8`, and the
exported C functions to the extension offscreen workers.

The WASM is built from `slhdsa_emscripten_wrapper.c` plus the upstream C files
and exports:

```text
_slh_dsa_build_xmss_tree_chunk
_slh_dsa_build_xmss_leaf_chunk
_slh_dsa_sign_prelude
_slh_dsa_sign_fors_tree
_slh_dsa_finish_signature_with_fors_and_xmss_tree
_slh_dsa_sign_action_hash_with_sk_and_xmss_tree
_malloc
_free
HEAPU8
```

Signing uses FIPS 205 external mode with empty context by passing
`0x0000 || actionHash` into the internal signer. The worker validates that the
returned public key matches the active validator metadata before accepting the
signature.

For wallet usage, provisioning calls `_slh_dsa_build_xmss_leaf_chunk` across
setup workers for level-0 WOTS leaves, then `_slh_dsa_build_xmss_tree_chunk` for
upper XMSS levels, derives `pkRoot` from the final cached root, and stores the
resulting 64-byte secret key only in encrypted SLH-DSA local state. Subsequent
signatures must use the cached-XMSS path; slow derive-only and full-tree exports
are intentionally not included in the wallet artifact.

The extension setup path additionally builds a public XMSS tree cache with
`_slh_dsa_build_xmss_tree_chunk` and signs with
`_slh_dsa_sign_action_hash_with_sk_and_xmss_tree`. The cache is public
auth-path material keyed by the SLH-DSA key id; it is large (~128 MiB), so it
belongs in IndexedDB rather than Chrome local storage.

The wallet derivation chain is:

```text
mnemonic -> sysweb3 SLH setup secret -> Pali SLH seed48 -> WASM keypair
```

The setup secret is transient. It is used only during initial PQ setup or local
signer regeneration to produce the prepared SLH key material and XMSS cache.
Durable private SLH state is encrypted with the sysweb3 keyring session key,
matching the existing encrypted `xprv` lifecycle; normal signing decrypts that
session-encrypted envelope and does not rederive the setup secret.

The fastest local path splits the remaining FORS work across extension Web
Workers. The parent worker computes `_slh_dsa_sign_prelude`, child workers call
`_slh_dsa_sign_fors_tree` for one FORS tree each, and the parent assembles the
same signature bytes with `_slh_dsa_finish_signature_with_fors_and_xmss_tree`.

## Performance Notes

The current wallet artifact intentionally uses the scalar Emscripten build:

```sh
emcc ... -O3 -flto \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=SlhDsaModule \
  -s EXPORTED_RUNTIME_METHODS='["HEAPU8"]'
```

Server-side leaf benchmarks showed the plain scalar build faster than the
`-msimd128` build for the current SHA2/WOTS/XMSS workload. `-msimd128` enables
portable WASM SIMD, but it does not automatically expose native SHA-NI/ARM SHA
instructions to browser WASM. Meaningful SHA2 speedups require a dedicated
multi-buffer WASM-SIMD hash path for WOTS/XMSS leaf generation.
