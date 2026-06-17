export const SLH_DSA_PARAMETER_SET = 'SLH-DSA-SHA2-128-24' as const;

export const SLH_DSA_SIGNATURE_LENGTH = 3856;
export const SLH_DSA_SIGNATURE_HEX_LENGTH = 2 + SLH_DSA_SIGNATURE_LENGTH * 2;
export const SLH_DSA_SEED_LENGTH = 16;
export const SLH_DSA_PUBLIC_KEY_LENGTH = 32;
export const SLH_DSA_PUBLIC_KEY_FIELD_LENGTH = 16;
export const SLH_DSA_SECRET_KEY_LENGTH = 64;
export const SLH_DSA_KEYPAIR_EXPORT_LENGTH =
  SLH_DSA_PUBLIC_KEY_LENGTH + SLH_DSA_SECRET_KEY_LENGTH;
export const SLH_DSA_XMSS_TREE_CACHE_LENGTH = 134_217_712;
export const SLH_DSA_SIGNING_PRELUDE_LENGTH = 46;
export const SLH_DSA_FORS_TREE_COUNT = 6;
export const SLH_DSA_FORS_TREE_SIGNATURE_LENGTH = 400;
export const SLH_DSA_FORS_TREE_OUTPUT_LENGTH = 416;
export const SLH_DSA_FORS_SIGNATURE_LENGTH =
  SLH_DSA_FORS_TREE_COUNT * SLH_DSA_FORS_TREE_SIGNATURE_LENGTH;
export const SLH_DSA_FORS_ROOTS_LENGTH =
  SLH_DSA_FORS_TREE_COUNT * SLH_DSA_PUBLIC_KEY_FIELD_LENGTH;
export const SLH_DSA_SIGNATURE_LIMIT = 2 ** 24;

export const SLH_DSA_DERIVATION_VERSION = 1;
export const SLH_DSA_STATE_VERSION = 1;
export const SLH_DSA_PRECOMPUTE_CACHE_VERSION = 1;

export const SLH_DSA_WASM_ASSET_PATH = 'assets/slh-dsa/slhdsa-sha2-128-24.wasm';
export const SLH_DSA_WASM_GLUE_ASSET_PATH =
  'assets/slh-dsa/slhdsa-sha2-128-24.js';

export const getSLHDSAStateStorageKey = (keyId: string) =>
  `pali-slh-dsa-state:v${SLH_DSA_STATE_VERSION}:${keyId}`;

export const getSLHDSAPrecomputeCacheKey = (keyId: string) =>
  `pali-slh-dsa-precompute:v${SLH_DSA_PRECOMPUTE_CACHE_VERSION}:${keyId}`;

export const getSLHDSAKeyId = ({
  pkRoot,
  pkSeed,
}: {
  pkRoot: string;
  pkSeed: string;
}) => `${SLH_DSA_PARAMETER_SET}:${pkSeed}:${pkRoot}`;
