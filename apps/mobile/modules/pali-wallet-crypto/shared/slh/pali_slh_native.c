/* SPDX-License-Identifier: MIT */
#include "pali_slh_native.h"
#include "strict_rng.h"

#include <stdlib.h>
#include <string.h>
#include "api.h"
#include "params.h"

_Static_assert(SPX_N == 16 && SPX_FULL_HEIGHT == 22 && SPX_D == 1 &&
               SPX_FORS_HEIGHT == 24 && SPX_FORS_TREES == 6 &&
               SPX_WOTS_LOGW == 2 && SPX_SHA512 == 0,
               "Only the pinned full SHA2-128-24 parameters are admitted");
_Static_assert(SPX_SK_BYTES == PALI_SLH_SK_BYTES &&
               SPX_PK_BYTES == PALI_SLH_PK_BYTES &&
               SPX_BYTES == PALI_SLH_SIGNATURE_BYTES &&
               SPX_N + SPX_FORS_MSG_BYTES + 8 + 4 == PALI_SLH_PRELUDE_BYTES,
               "Pinned wrapper sizes changed");

extern int slh_dsa_sign_prelude(const uint8_t *, const uint8_t *, size_t,
                                const uint8_t *, uint8_t *);
extern int slh_dsa_build_xmss_leaf_chunk(const uint8_t *, uint8_t *,
                                        uint32_t, uint32_t);

const uint8_t *pali_slh_qualification_seed(void) {
    static const uint8_t seed[PALI_SLH_SEED_BYTES] = {
        0xe7, 0x67, 0x8c, 0xcc, 0x25, 0xf6, 0x15, 0x28, 0xcd, 0x0d, 0x30, 0xd2,
        0xf8, 0x4b, 0x2a, 0x22, 0xde, 0x83, 0x05, 0xa2, 0xfc, 0xb6, 0x97, 0xd7,
        0x34, 0x34, 0xa9, 0x39, 0xc8, 0x79, 0xbe, 0xbf, 0x75, 0x0e, 0x7b, 0x30,
        0xf3, 0x77, 0x00, 0xdd, 0x14, 0xb2, 0x0a, 0x5c, 0x64, 0x7b, 0xb9, 0x36,
    };
    return seed;
}

static int overlaps(const uint8_t *left, size_t left_size,
                    const uint8_t *right, size_t right_size) {
    const uintptr_t a = (uintptr_t)left, b = (uintptr_t)right;
    return a <= b ? b - a < left_size : a - b < right_size;
}

struct prelude_call {
    uint8_t secret[PALI_SLH_SK_BYTES];
    uint8_t message[2 + PALI_SLH_ACTION_BYTES];
    uint8_t optrand[PALI_SLH_OPTRAND_BYTES];
    uint8_t output[PALI_SLH_PRELUDE_BYTES];
};

static int call_prelude(void *argument) {
    struct prelude_call *input = argument;
    return slh_dsa_sign_prelude(input->secret, input->message,
        sizeof(input->message), input->optrand, input->output);
}

enum pali_slh_status pali_slh_prelude(
    const uint8_t *secret, size_t secret_size,
    const uint8_t *action, size_t action_size,
    const uint8_t *optrand, size_t optrand_size,
    uint8_t *output, size_t output_size) {
    if (!secret || !action || !optrand || !output ||
        secret_size != PALI_SLH_SK_BYTES || action_size != PALI_SLH_ACTION_BYTES ||
        optrand_size != PALI_SLH_OPTRAND_BYTES || output_size != PALI_SLH_PRELUDE_BYTES ||
        overlaps(output, output_size, secret, secret_size) ||
        overlaps(output, output_size, action, action_size) ||
        overlaps(output, output_size, optrand, optrand_size))
        return PALI_SLH_INVALID_INPUT;
    struct prelude_call input = {0};
    memcpy(input.secret, secret, secret_size);
    memcpy(input.message + 2, action, action_size);
    memcpy(input.optrand, optrand, optrand_size);
    int engine_result = -1;
    enum pali_slh_status status = pali_slh_run_serialized(
        PALI_SLH_RNG_EXPLICIT_OPTRAND, input.optrand, call_prelude, &input, &engine_result);
    if (status == PALI_SLH_OK && engine_result != PALI_SLH_PRELUDE_BYTES)
        status = PALI_SLH_ENGINE_FAILED;
    if (status == PALI_SLH_OK) memcpy(output, input.output, output_size);
    pali_slh_erase(&input, sizeof(input));
    return status;
}

struct leaf_call {
    uint8_t seed[PALI_SLH_SEED_BYTES];
    uint32_t start, count;
    uint8_t *output;
};

static int call_leaves(void *argument) {
    struct leaf_call *input = argument;
    return slh_dsa_build_xmss_leaf_chunk(input->seed, input->output,
                                        input->start, input->count);
}

enum pali_slh_status pali_slh_leaf_chunk(
    const uint8_t *seed, size_t seed_size,
    uint32_t start, uint32_t count,
    uint8_t *output, size_t output_size) {
    if (!seed || !output || seed_size != PALI_SLH_SEED_BYTES ||
        !count || count > PALI_SLH_MAX_LEAF_CHUNK ||
        start > PALI_SLH_XMSS_LEAVES || count > PALI_SLH_XMSS_LEAVES - start ||
        output_size != (size_t)count * SPX_N ||
        overlaps(output, output_size, seed, seed_size))
        return PALI_SLH_INVALID_INPUT;
    struct leaf_call input = {0};
    memcpy(input.seed, seed, seed_size);
    input.start = start;
    input.count = count;
    input.output = calloc(1, output_size);
    if (!input.output) {
        pali_slh_erase(&input, sizeof(input));
        return PALI_SLH_NO_MEMORY;
    }
    int engine_result = -1;
    enum pali_slh_status status = pali_slh_run_serialized(
        PALI_SLH_RNG_NONE, NULL, call_leaves, &input, &engine_result);
    if (status == PALI_SLH_OK && engine_result != (int)count)
        status = PALI_SLH_ENGINE_FAILED;
    if (status == PALI_SLH_OK) memcpy(output, input.output, output_size);
    pali_slh_erase(input.output, output_size);
    free(input.output);
    pali_slh_erase(&input, sizeof(input));
    return status;
}

struct verify_call {
    uint8_t public_key[PALI_SLH_PK_BYTES];
    uint8_t message[2 + PALI_SLH_ACTION_BYTES];
    uint8_t signature[PALI_SLH_SIGNATURE_BYTES];
};

static int call_verify(void *argument) {
    struct verify_call *input = argument;
    return crypto_sign_verify(input->signature, sizeof(input->signature),
        input->message, sizeof(input->message), input->public_key);
}

enum pali_slh_status pali_slh_verify(
    const uint8_t *public_key, size_t public_key_size,
    const uint8_t *action, size_t action_size,
    const uint8_t *signature, size_t signature_size) {
    if (!public_key || !action || !signature ||
        public_key_size != PALI_SLH_PK_BYTES || action_size != PALI_SLH_ACTION_BYTES ||
        signature_size != PALI_SLH_SIGNATURE_BYTES)
        return PALI_SLH_INVALID_INPUT;
    struct verify_call input = {0};
    memcpy(input.public_key, public_key, public_key_size);
    memcpy(input.message + 2, action, action_size);
    memcpy(input.signature, signature, signature_size);
    int engine_result = -1;
    enum pali_slh_status status = pali_slh_run_serialized(
        PALI_SLH_RNG_NONE, NULL, call_verify, &input, &engine_result);
    if (status == PALI_SLH_OK && engine_result != 0)
        status = PALI_SLH_INVALID_SIGNATURE;
    pali_slh_erase(&input, sizeof(input));
    return status;
}
