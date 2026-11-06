/* SPDX-License-Identifier: MIT */
#ifndef PALI_SLH_NATIVE_H
#define PALI_SLH_NATIVE_H

#include <stddef.h>
#include <stdint.h>

enum pali_slh_status {
    PALI_SLH_OK = 0,
    PALI_SLH_INVALID_INPUT,
    PALI_SLH_BUSY,
    PALI_SLH_RNG_CONTRACT_FAILED,
    PALI_SLH_ENGINE_FAILED,
    PALI_SLH_INVALID_SIGNATURE,
    PALI_SLH_NO_MEMORY
};

enum {
    PALI_SLH_SK_BYTES = 64,
    PALI_SLH_SEED_BYTES = 48,
    PALI_SLH_PK_BYTES = 32,
    PALI_SLH_ACTION_BYTES = 32,
    PALI_SLH_OPTRAND_BYTES = 16,
    PALI_SLH_PRELUDE_BYTES = 46,
    PALI_SLH_SIGNATURE_BYTES = 3856,
    PALI_SLH_XMSS_LEAVES = 1 << 22,
    PALI_SLH_MAX_LEAF_CHUNK = 8192
};

/* Inputs are copied before the engine runs. Outputs are published on success
 * only and must not overlap input buffers. PK layout is PK.seed || PK.root.
 * The native boundary adds 0x00 || 0x00 to the 32-byte external action hash.
 */
enum pali_slh_status pali_slh_prelude(
    const uint8_t *secret, size_t secret_size,
    const uint8_t *action, size_t action_size,
    const uint8_t *optrand, size_t optrand_size,
    uint8_t *output, size_t output_size);

enum pali_slh_status pali_slh_leaf_chunk(
    const uint8_t *seed, size_t seed_size,
    uint32_t start, uint32_t count,
    uint8_t *output, size_t output_size);

/* Public, deterministic input for the isolated native qualification only. */
const uint8_t *pali_slh_qualification_seed(void);

enum pali_slh_status pali_slh_verify(
    const uint8_t *public_key, size_t public_key_size,
    const uint8_t *action, size_t action_size,
    const uint8_t *signature, size_t signature_size);
#endif
