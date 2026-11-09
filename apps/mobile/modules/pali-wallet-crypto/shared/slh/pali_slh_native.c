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
               SPX_N + SPX_FORS_MSG_BYTES + 8 + 4 == PALI_SLH_PRELUDE_BYTES &&
               SPX_FULL_HEIGHT == PALI_SLH_XMSS_HEIGHT &&
               SPX_FORS_TREES == PALI_SLH_FORS_TREES &&
               (SPX_FORS_HEIGHT + 2) * SPX_N == PALI_SLH_FORS_OUTPUT_BYTES &&
               SPX_FORS_BYTES == PALI_SLH_FORS_SIGNATURE_BYTES &&
               SPX_FORS_TREES * SPX_N == PALI_SLH_FORS_ROOTS_BYTES &&
               (((size_t)1 << (SPX_FULL_HEIGHT + 1)) - 1) * SPX_N == PALI_SLH_XMSS_TREE_BYTES,
               "Pinned wrapper sizes changed");

extern int slh_dsa_sign_prelude(const uint8_t *, const uint8_t *, size_t,
                                const uint8_t *, uint8_t *);
extern int slh_dsa_build_xmss_leaf_chunk(const uint8_t *, uint8_t *,
                                        uint32_t, uint32_t);
extern int slh_dsa_build_xmss_tree_chunk(const uint8_t *, uint8_t *,
                                        uint32_t, uint32_t, uint32_t);
extern int slh_dsa_sign_fors_tree(const uint8_t *, const uint8_t *, uint32_t, uint8_t *);
extern int slh_dsa_finish_signature_with_fors_and_xmss_tree(
    const uint8_t *, const uint8_t *, const uint8_t *, const uint8_t *, const uint8_t *, uint8_t *);
extern int slh_dsa_sign_action_hash_with_sk_and_xmss_tree(
    const uint8_t *, const uint8_t *, size_t, const uint8_t *, const uint8_t *, uint8_t *);

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

static size_t tree_level_offset(uint32_t level) {
    size_t offset = 0;
    for (uint32_t height = 0; height < level; height++)
        offset += ((size_t)1 << (PALI_SLH_XMSS_HEIGHT - height)) * SPX_N;
    return offset;
}

struct tree_call {
    uint8_t seed[PALI_SLH_SEED_BYTES];
    uint8_t *tree;
    uint32_t level, start, count;
    uint8_t *window, *previous;
    size_t bytes;
    int entered;
};

static int call_tree(void *argument) {
    struct tree_call *input = argument;
    memcpy(input->previous, input->window, input->bytes);
    input->entered = 1;
    return slh_dsa_build_xmss_tree_chunk(input->seed, input->tree,
                                        input->level, input->start, input->count);
}

enum pali_slh_status pali_slh_tree_level(
    const uint8_t *seed, size_t seed_size,
    uint8_t *tree, size_t tree_size,
    uint32_t level, uint32_t start, uint32_t count) {
    if (!seed || !tree || seed_size != PALI_SLH_SEED_BYTES ||
        tree_size != PALI_SLH_XMSS_TREE_BYTES || level > PALI_SLH_XMSS_HEIGHT ||
        !count || count > PALI_SLH_MAX_LEAF_CHUNK ||
        start > (PALI_SLH_XMSS_LEAVES >> level) ||
        count > (PALI_SLH_XMSS_LEAVES >> level) - start ||
        overlaps(tree, tree_size, seed, seed_size))
        return PALI_SLH_INVALID_INPUT;
    struct tree_call input = {0};
    memcpy(input.seed, seed, seed_size);
    input.tree = tree; input.level = level; input.start = start; input.count = count;
    const size_t bytes = (size_t)count * SPX_N;
    uint8_t *const window = tree + tree_level_offset(level) + (size_t)start * SPX_N;
    uint8_t *const previous = malloc(bytes);
    if (!previous) {
        pali_slh_erase(&input, sizeof(input));
        return PALI_SLH_NO_MEMORY;
    }
    input.window = window; input.previous = previous; input.bytes = bytes;
    int engine_result = -1;
    enum pali_slh_status status = pali_slh_run_serialized(
        PALI_SLH_RNG_NONE, NULL, call_tree, &input, &engine_result);
    if (status == PALI_SLH_OK && engine_result != (int)count)
        status = PALI_SLH_ENGINE_FAILED;
    if (status != PALI_SLH_OK && input.entered) memcpy(window, previous, bytes);
    pali_slh_erase(previous, bytes); free(previous);
    pali_slh_erase(&input, sizeof(input));
    return status;
}

static int canonical_prelude(const uint8_t *prelude) {
    const size_t tree_offset = SPX_N + SPX_FORS_MSG_BYTES;
    for (size_t index = tree_offset; index < tree_offset + 8; index++)
        if (prelude[index] != 0) return 0;
    uint32_t leaf = 0;
    for (size_t index = tree_offset + 8; index < PALI_SLH_PRELUDE_BYTES; index++)
        leaf = (leaf << 8) | prelude[index];
    return leaf < PALI_SLH_XMSS_LEAVES;
}

struct fors_call {
    uint8_t context[2 * SPX_N];
    uint8_t prelude[PALI_SLH_PRELUDE_BYTES];
    uint32_t index;
    uint8_t output[PALI_SLH_FORS_OUTPUT_BYTES];
};

static int call_fors(void *argument) {
    struct fors_call *input = argument;
    if (!canonical_prelude(input->prelude)) return -1;
    return slh_dsa_sign_fors_tree(input->context, input->prelude, input->index, input->output);
}

enum pali_slh_status pali_slh_fors_tree(
    const uint8_t *secret, size_t secret_size,
    const uint8_t *prelude, size_t prelude_size,
    uint32_t tree_index,
    uint8_t *output, size_t output_size) {
    if (!secret || !prelude || !output || secret_size != PALI_SLH_SK_BYTES ||
        prelude_size != PALI_SLH_PRELUDE_BYTES || tree_index >= PALI_SLH_FORS_TREES ||
        output_size != PALI_SLH_FORS_OUTPUT_BYTES || !canonical_prelude(prelude) ||
        overlaps(output, output_size, secret, secret_size) ||
        overlaps(output, output_size, prelude, prelude_size))
        return PALI_SLH_INVALID_INPUT;
    struct fors_call input = {0};
    memcpy(input.context, secret, SPX_N);
    memcpy(input.context + SPX_N, secret + 2 * SPX_N, SPX_N);
    memcpy(input.prelude, prelude, prelude_size);
    input.index = tree_index;
    int engine_result = -1;
    enum pali_slh_status status = pali_slh_run_serialized(
        PALI_SLH_RNG_NONE, NULL, call_fors, &input, &engine_result);
    if (status == PALI_SLH_OK && engine_result != PALI_SLH_FORS_OUTPUT_BYTES)
        status = PALI_SLH_ENGINE_FAILED;
    if (status == PALI_SLH_OK) memcpy(output, input.output, output_size);
    pali_slh_erase(&input, sizeof(input));
    return status;
}

static int tree_matches_key(const uint8_t *tree, const uint8_t *secret) {
    return memcmp(tree + PALI_SLH_XMSS_TREE_BYTES - SPX_N, secret + 3 * SPX_N, SPX_N) == 0;
}

struct signature_call {
    uint8_t secret[PALI_SLH_SK_BYTES];
    uint8_t message[2 + PALI_SLH_ACTION_BYTES];
    uint8_t optrand[PALI_SLH_OPTRAND_BYTES];
    uint8_t prelude[PALI_SLH_PRELUDE_BYTES];
    uint8_t fors_signature[PALI_SLH_FORS_SIGNATURE_BYTES];
    uint8_t fors_roots[PALI_SLH_FORS_ROOTS_BYTES];
    const uint8_t *tree;
    uint8_t output[PALI_SLH_SIGNATURE_BYTES];
    int verified;
};

static int verify_signature(struct signature_call *input, int result) {
    if (result == PALI_SLH_SIGNATURE_BYTES)
        input->verified = crypto_sign_verify(input->output, sizeof(input->output),
            input->message, sizeof(input->message), input->secret + 2 * SPX_N);
    return result;
}

static int call_finish(void *argument) {
    struct signature_call *input = argument;
    if (!tree_matches_key(input->tree, input->secret) || !canonical_prelude(input->prelude)) return -1;
    const int result = slh_dsa_finish_signature_with_fors_and_xmss_tree(
        input->secret, input->prelude, input->fors_signature, input->fors_roots,
        input->tree, input->output);
    return verify_signature(input, result);
}

static int call_cached(void *argument) {
    struct signature_call *input = argument;
    if (!tree_matches_key(input->tree, input->secret)) return -1;
    const int result = slh_dsa_sign_action_hash_with_sk_and_xmss_tree(
        input->secret, input->message, sizeof(input->message), input->optrand,
        input->tree, input->output);
    return verify_signature(input, result);
}

static enum pali_slh_status publish_signature(
    enum pali_slh_status status, int engine_result,
    struct signature_call *input, uint8_t *output) {
    if (status == PALI_SLH_OK && engine_result != PALI_SLH_SIGNATURE_BYTES)
        status = PALI_SLH_ENGINE_FAILED;
    if (status == PALI_SLH_OK && input->verified != 0)
        status = PALI_SLH_INVALID_SIGNATURE;
    if (status == PALI_SLH_OK) memcpy(output, input->output, sizeof(input->output));
    pali_slh_erase(input, sizeof(*input));
    return status;
}

enum pali_slh_status pali_slh_finish(
    const uint8_t *secret, size_t secret_size,
    const uint8_t *action, size_t action_size,
    const uint8_t *prelude, size_t prelude_size,
    const uint8_t *fors_signature, size_t fors_signature_size,
    const uint8_t *fors_roots, size_t fors_roots_size,
    const uint8_t *tree, size_t tree_size,
    uint8_t *output, size_t output_size) {
    if (!secret || !action || !prelude || !fors_signature || !fors_roots || !tree || !output ||
        secret_size != PALI_SLH_SK_BYTES || action_size != PALI_SLH_ACTION_BYTES ||
        prelude_size != PALI_SLH_PRELUDE_BYTES || fors_signature_size != PALI_SLH_FORS_SIGNATURE_BYTES ||
        fors_roots_size != PALI_SLH_FORS_ROOTS_BYTES || tree_size != PALI_SLH_XMSS_TREE_BYTES ||
        output_size != PALI_SLH_SIGNATURE_BYTES || !canonical_prelude(prelude) ||
        !tree_matches_key(tree, secret) ||
        overlaps(output, output_size, secret, secret_size) ||
        overlaps(output, output_size, action, action_size) ||
        overlaps(output, output_size, prelude, prelude_size) ||
        overlaps(output, output_size, fors_signature, fors_signature_size) ||
        overlaps(output, output_size, fors_roots, fors_roots_size) ||
        overlaps(output, output_size, tree, tree_size))
        return PALI_SLH_INVALID_INPUT;
    struct signature_call input = {0};
    memcpy(input.secret, secret, secret_size);
    memcpy(input.message + 2, action, action_size);
    memcpy(input.prelude, prelude, prelude_size);
    memcpy(input.fors_signature, fors_signature, fors_signature_size);
    memcpy(input.fors_roots, fors_roots, fors_roots_size);
    input.tree = tree; input.verified = -1;
    int engine_result = -1;
    const enum pali_slh_status status = pali_slh_run_serialized(
        PALI_SLH_RNG_NONE, NULL, call_finish, &input, &engine_result);
    return publish_signature(status, engine_result, &input, output);
}

enum pali_slh_status pali_slh_sign_cached(
    const uint8_t *secret, size_t secret_size,
    const uint8_t *action, size_t action_size,
    const uint8_t *optrand, size_t optrand_size,
    const uint8_t *tree, size_t tree_size,
    uint8_t *output, size_t output_size) {
    if (!secret || !action || !optrand || !tree || !output ||
        secret_size != PALI_SLH_SK_BYTES || action_size != PALI_SLH_ACTION_BYTES ||
        optrand_size != PALI_SLH_OPTRAND_BYTES || tree_size != PALI_SLH_XMSS_TREE_BYTES ||
        output_size != PALI_SLH_SIGNATURE_BYTES || !tree_matches_key(tree, secret) ||
        overlaps(output, output_size, secret, secret_size) ||
        overlaps(output, output_size, action, action_size) ||
        overlaps(output, output_size, optrand, optrand_size) ||
        overlaps(output, output_size, tree, tree_size))
        return PALI_SLH_INVALID_INPUT;
    struct signature_call input = {0};
    memcpy(input.secret, secret, secret_size);
    memcpy(input.message + 2, action, action_size);
    memcpy(input.optrand, optrand, optrand_size);
    input.tree = tree; input.verified = -1;
    int engine_result = -1;
    const enum pali_slh_status status = pali_slh_run_serialized(
        PALI_SLH_RNG_EXPLICIT_OPTRAND, input.optrand, call_cached, &input, &engine_result);
    return publish_signature(status, engine_result, &input, output);
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
