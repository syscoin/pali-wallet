/* ABI/lease controls with explicit vendor doubles, never cryptographic vectors. */
#include "pali_slh_native.h"
#include "strict_rng.h"
#include "randombytes.h"
#include "api.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

extern void set_rng_buffer(const unsigned char *, unsigned long long);

static unsigned checks, calls, verifications;
static int fault;
static uint8_t key[64], action[32], optrand[16];
enum { WRONG_RESULT = 1, BAD_RNG, BAD_SIGNATURE, MISSING_RNG, VERIFY_RNG };

static void require(int value, const char *name) {
    checks++;
    if (!value) { fprintf(stderr, "SLH guard failed: %s\n", name); exit(1); }
}
static int noop(void *unused) { (void)unused; return 0; }
static void leased(void) {
    int result = -1;
    require(pali_slh_run_serialized(PALI_SLH_RNG_NONE, NULL, noop, NULL, &result) == PALI_SLH_BUSY,
            "vendor and verification execute under the same lease");
    calls++;
}
static void unexpected_rng(void) { uint8_t bytes[16]; randombytes(bytes, sizeof(bytes)); }
static size_t offset(uint32_t level) {
    size_t bytes = 0;
    for (uint32_t height = 0; height < level; height++) bytes += ((size_t)1 << (22 - height)) * 16;
    return bytes;
}
int slh_dsa_sign_prelude(const uint8_t *secret, const uint8_t *message, size_t bytes,
                          const uint8_t *random, uint8_t *out) {
    leased(); (void)secret;
    require(bytes == 34 && message[0] == 0 && message[1] == 0 && !memcmp(message + 2, action, 32), "prelude prefixes raw32 once");
    set_rng_buffer(random, 16); memset(out, 0, 46); return 46;
}
int slh_dsa_build_xmss_leaf_chunk(const uint8_t *seed, uint8_t *out, uint32_t start, uint32_t count) {
    leased(); (void)seed; (void)start; memset(out, 0x44, count * 16); return (int)count;
}
int slh_dsa_build_xmss_tree_chunk(const uint8_t *seed, uint8_t *tree, uint32_t level, uint32_t start, uint32_t count) {
    leased(); (void)seed;
    memset(tree + offset(level) + (size_t)start * 16, 0x52, (size_t)count * 16);
    if (fault == BAD_RNG) unexpected_rng();
    return fault == WRONG_RESULT ? -1 : (int)count;
}
int slh_dsa_sign_fors_tree(const uint8_t *context, const uint8_t *prelude, uint32_t index, uint8_t *out) {
    leased(); (void)prelude;
    require(!memcmp(context, key, 16) && !memcmp(context + 16, key + 32, 16), "FORS derives key-owned context");
    require(index < 6, "FORS index admitted");
    memset(out, 0x60 + (int)index, 416);
    if (fault == BAD_RNG) unexpected_rng();
    return fault == WRONG_RESULT ? -1 : 416;
}
int slh_dsa_finish_signature_with_fors_and_xmss_tree(const uint8_t *secret, const uint8_t *prelude,
    const uint8_t *signature, const uint8_t *roots, const uint8_t *tree, uint8_t *out) {
    leased(); (void)secret; (void)prelude; (void)signature; (void)roots; (void)tree;
    memset(out, 0x66, 3856);
    if (fault == BAD_RNG) unexpected_rng();
    return fault == WRONG_RESULT ? -1 : 3856;
}
int slh_dsa_sign_action_hash_with_sk_and_xmss_tree(const uint8_t *secret, const uint8_t *message,
    size_t bytes, const uint8_t *random, const uint8_t *tree, uint8_t *out) {
    leased(); (void)secret; (void)tree;
    require(bytes == 34 && message[0] == 0 && message[1] == 0 && !memcmp(message + 2, action, 32), "cached signing prefixes raw32 once");
    if (fault != MISSING_RNG) set_rng_buffer(random, 16);
    memset(out, 0x77, 3856);
    if (fault == BAD_RNG) unexpected_rng();
    return fault == WRONG_RESULT ? -1 : 3856;
}
int crypto_sign_verify(const uint8_t *signature, size_t signature_bytes,
    const uint8_t *message, size_t bytes, const uint8_t *public_key) {
    leased(); verifications++; (void)signature;
    require(signature_bytes == 3856 && bytes == 34 && message[0] == 0 && message[1] == 0 &&
            !memcmp(message + 2, action, 32), "verification uses original action with one prefix");
    require(!memcmp(public_key, key + 32, 32), "verification binds entire key public identity");
    if (fault == VERIFY_RNG) unexpected_rng();
    return fault == BAD_SIGNATURE ? -1 : 0;
}

static void untouched(enum pali_slh_status actual, enum pali_slh_status expected,
                      const uint8_t *output, size_t bytes, const char *name) {
    require(actual == expected, name);
    for (size_t index = 0; index < bytes; index++) require(output[index] == 0xa5, "refused output unchanged");
}

static int busy_controls(void *argument) {
    uint8_t *tree = argument;
    uint8_t prelude[46] = {0}, fors[2400] = {0}, roots[96] = {0}, output[3856];
    memset(output, 0xa5, sizeof(output));
    untouched(pali_slh_fors_tree(key, 64, prelude, 46, 0, output, 416),
        PALI_SLH_BUSY, output, sizeof(output), "busy FORS cannot disclose");
    untouched(pali_slh_finish(key, 64, action, 32, prelude, 46, fors, 2400, roots, 96,
        tree, PALI_SLH_XMSS_TREE_BYTES, output, sizeof(output)),
        PALI_SLH_BUSY, output, sizeof(output), "busy finish cannot disclose");
    untouched(pali_slh_sign_cached(key, 64, action, 32, optrand, 16,
        tree, PALI_SLH_XMSS_TREE_BYTES, output, sizeof(output)),
        PALI_SLH_BUSY, output, sizeof(output), "busy cached signing cannot disclose");
    memset(tree, 0xa5, 16);
    untouched(pali_slh_tree_level(key, 48, tree, PALI_SLH_XMSS_TREE_BYTES, 0, 0, 1),
        PALI_SLH_BUSY, tree, 16, "busy tree builder cannot touch active tree");
    return 0;
}

int main(void) {
    memset(key, 0x11, sizeof(key)); memset(action, 0x22, sizeof(action)); memset(optrand, 0x33, sizeof(optrand));
    uint8_t *tree = calloc(1, PALI_SLH_XMSS_TREE_BYTES);
    require(tree != NULL, "bounded native tree allocation");
    uint8_t prelude[46] = {0}, fors[2400] = {0}, roots[96] = {0}, output[3856];
    memcpy(tree + PALI_SLH_XMSS_TREE_BYTES - 16, key + 48, 16);
#define FINISH() pali_slh_finish(key, 64, action, 32, prelude, 46, fors, 2400, roots, 96, tree, PALI_SLH_XMSS_TREE_BYTES, output, sizeof(output))
#define CACHED() pali_slh_sign_cached(key, 64, action, 32, optrand, 16, tree, PALI_SLH_XMSS_TREE_BYTES, output, sizeof(output))
    require(pali_slh_prelude(key, 64, action, 32, optrand, 16, prelude, 46) == PALI_SLH_OK, "prelude lease control");
    for (uint32_t index = 0; index < 6; index++) {
        require(pali_slh_fors_tree(key, 64, prelude, 46, index, output, 416) == PALI_SLH_OK, "all six admitted FORS indices");
        require(output[0] == 0x60 + index && output[415] == 0x60 + index, "FORS publishes exact shard");
    }
    require(FINISH() == PALI_SLH_OK && output[0] == 0x66 && output[3855] == 0x66, "finish verified under same lease");
    require(CACHED() == PALI_SLH_OK && output[0] == 0x77 && output[3855] == 0x77, "cached verified under same lease");
    require(verifications == 2, "each signature verified before disclosure");
    for (int failure = WRONG_RESULT; failure <= VERIFY_RNG; failure++) {
        fault = failure; memset(output, 0xa5, sizeof(output));
        const enum pali_slh_status expected = failure == WRONG_RESULT ? PALI_SLH_ENGINE_FAILED :
            failure == BAD_SIGNATURE ? PALI_SLH_INVALID_SIGNATURE : PALI_SLH_RNG_CONTRACT_FAILED;
        untouched(CACHED(), expected, output, sizeof(output), "cached refuses vendor/signature/RNG failure");
        if (failure == MISSING_RNG) continue;
        untouched(FINISH(), expected, output, sizeof(output), "finish refuses vendor/signature/RNG failure");
    }
    for (int failure = WRONG_RESULT; failure <= BAD_RNG; failure++) {
        fault = failure; memset(output, 0xa5, sizeof(output));
        untouched(pali_slh_fors_tree(key, 64, prelude, 46, 0, output, 416),
            failure == WRONG_RESULT ? PALI_SLH_ENGINE_FAILED : PALI_SLH_RNG_CONTRACT_FAILED,
            output, sizeof(output), "FORS error atomicity");
        uint8_t *window = tree + offset(21) + 16;
        memset(window, 0xa5, 16);
        untouched(pali_slh_tree_level(key, 48, tree, PALI_SLH_XMSS_TREE_BYTES, 21, 1, 1),
            failure == WRONG_RESULT ? PALI_SLH_ENGINE_FAILED : PALI_SLH_RNG_CONTRACT_FAILED,
            window, 16, "tree window rollback on engine/RNG refusal");
    }
    fault = 0;
    int busy_result = -1;
    require(pali_slh_run_serialized(PALI_SLH_RNG_NONE, NULL, busy_controls, tree, &busy_result) == PALI_SLH_OK && busy_result == 0,
            "busy controls retain outer lease");
    const unsigned before_guards = calls;
    memset(output, 0xa5, sizeof(output));
    const size_t capacities[] = {0, PALI_SLH_XMSS_TREE_BYTES - 1, PALI_SLH_XMSS_TREE_BYTES + 1, SIZE_MAX};
    for (size_t index = 0; index < sizeof(capacities) / sizeof(capacities[0]); index++) {
        untouched(pali_slh_sign_cached(key, 64, action, 32, optrand, 16, tree, capacities[index], output, sizeof(output)),
            PALI_SLH_INVALID_INPUT, output, sizeof(output), "cached exact tree capacity");
        untouched(pali_slh_finish(key, 64, action, 32, prelude, 46, fors, 2400, roots, 96, tree, capacities[index], output, sizeof(output)),
            PALI_SLH_INVALID_INPUT, output, sizeof(output), "finish exact tree capacity");
        require(pali_slh_tree_level(key, 48, tree, capacities[index], 0, 0, 1) == PALI_SLH_INVALID_INPUT, "build exact tree capacity");
    }
    for (uint32_t index = 6; index < 8; index++)
        untouched(pali_slh_fors_tree(key, 64, prelude, 46, index, output, 416), PALI_SLH_INVALID_INPUT, output, sizeof(output), "invalid FORS index");
    require(pali_slh_fors_tree(key, 64, prelude, 46, UINT32_MAX, output, 416) == PALI_SLH_INVALID_INPUT, "overflow FORS index");
    prelude[34] = 1;
    untouched(FINISH(), PALI_SLH_INVALID_INPUT, output, sizeof(output), "nonzero d=1 tree rejected");
    untouched(pali_slh_fors_tree(key, 64, prelude, 46, 0, output, 416), PALI_SLH_INVALID_INPUT, output, sizeof(output), "FORS canonical tree");
    prelude[34] = 0; prelude[42] = 0x40;
    untouched(FINISH(), PALI_SLH_INVALID_INPUT, output, sizeof(output), "leaf outside cached tree rejected");
    prelude[42] = 0;
    tree[PALI_SLH_XMSS_TREE_BYTES - 1] ^= 1;
    untouched(FINISH(), PALI_SLH_INVALID_INPUT, output, sizeof(output), "finish key/root binding");
    untouched(CACHED(), PALI_SLH_INVALID_INPUT, output, sizeof(output), "cached key/root binding");
    tree[PALI_SLH_XMSS_TREE_BYTES - 1] ^= 1;
    const uint32_t bad_levels[][3] = {{23,0,1},{UINT32_MAX,0,1},{0,0,0},{0,0,8193},{22,1,1},{21,1,2},{0,UINT32_MAX,1}};
    for (size_t index = 0; index < sizeof(bad_levels) / sizeof(bad_levels[0]); index++)
        require(pali_slh_tree_level(key, 48, tree, PALI_SLH_XMSS_TREE_BYTES, bad_levels[index][0], bad_levels[index][1], bad_levels[index][2]) == PALI_SLH_INVALID_INPUT, "level/count/start bound");
    untouched(pali_slh_sign_cached(key, 64, action, 34, optrand, 16, tree, PALI_SLH_XMSS_TREE_BYTES, output, sizeof(output)),
        PALI_SLH_INVALID_INPUT, output, sizeof(output), "already prefixed input refused");
    untouched(pali_slh_finish(key, 64, action, 32, prelude, 46, fors, 2399, roots, 96, tree, PALI_SLH_XMSS_TREE_BYTES, output, sizeof(output)),
        PALI_SLH_INVALID_INPUT, output, sizeof(output), "short FORS signature refused");
    untouched(pali_slh_finish(key, 64, action, 32, prelude, 46, fors, 2400, roots, 95, tree, PALI_SLH_XMSS_TREE_BYTES, output, sizeof(output)),
        PALI_SLH_INVALID_INPUT, output, sizeof(output), "short FORS roots refused");
    for (size_t bytes = 63; bytes <= 65; bytes += 2) {
        untouched(pali_slh_sign_cached(key, bytes, action, 32, optrand, 16, tree, PALI_SLH_XMSS_TREE_BYTES, output, sizeof(output)),
            PALI_SLH_INVALID_INPUT, output, sizeof(output), "cached exact key size");
        untouched(pali_slh_finish(key, bytes, action, 32, prelude, 46, fors, 2400, roots, 96, tree, PALI_SLH_XMSS_TREE_BYTES, output, sizeof(output)),
            PALI_SLH_INVALID_INPUT, output, sizeof(output), "finish exact key size");
        untouched(pali_slh_fors_tree(key, bytes, prelude, 46, 0, output, 416),
            PALI_SLH_INVALID_INPUT, output, sizeof(output), "FORS exact key size");
    }
    for (size_t bytes = 45; bytes <= 47; bytes += 2) {
        untouched(pali_slh_finish(key, 64, action, 32, prelude, bytes, fors, 2400, roots, 96, tree, PALI_SLH_XMSS_TREE_BYTES, output, sizeof(output)),
            PALI_SLH_INVALID_INPUT, output, sizeof(output), "finish exact prelude size");
        untouched(pali_slh_fors_tree(key, 64, prelude, bytes, 0, output, 416),
            PALI_SLH_INVALID_INPUT, output, sizeof(output), "FORS exact prelude size");
    }
    untouched(pali_slh_sign_cached(NULL, 64, action, 32, optrand, 16, tree, PALI_SLH_XMSS_TREE_BYTES, output, sizeof(output)),
        PALI_SLH_INVALID_INPUT, output, sizeof(output), "null signing key");
    untouched(pali_slh_finish(key, 64, NULL, 32, prelude, 46, fors, 2400, roots, 96, tree, PALI_SLH_XMSS_TREE_BYTES, output, sizeof(output)),
        PALI_SLH_INVALID_INPUT, output, sizeof(output), "null original action");
    untouched(pali_slh_fors_tree(key, 64, NULL, 46, 0, output, 416),
        PALI_SLH_INVALID_INPUT, output, sizeof(output), "null prelude");
    untouched(pali_slh_sign_cached(key, 64, action, 32, optrand, 15, tree, PALI_SLH_XMSS_TREE_BYTES, output, sizeof(output)),
        PALI_SLH_INVALID_INPUT, output, sizeof(output), "exact optrand size");
    untouched(pali_slh_sign_cached(key, 64, action, 32, optrand, 16, tree, PALI_SLH_XMSS_TREE_BYTES, output, 3855),
        PALI_SLH_INVALID_INPUT, output, sizeof(output), "exact cached output size");
    untouched(pali_slh_finish(key, 64, action, 32, prelude, 46, fors, 2400, roots, 96, tree, PALI_SLH_XMSS_TREE_BYTES, output, 3857),
        PALI_SLH_INVALID_INPUT, output, sizeof(output), "exact finish output size");
    untouched(pali_slh_fors_tree(key, 64, prelude, 46, 0, output, 415),
        PALI_SLH_INVALID_INPUT, output, sizeof(output), "exact FORS output size");
    require(pali_slh_sign_cached(key, 64, action, 32, optrand, 16, tree, PALI_SLH_XMSS_TREE_BYTES, tree, 3856) == PALI_SLH_INVALID_INPUT, "signature cannot alias tree");
    memcpy(output, key, 64);
    require(pali_slh_finish(output, 64, action, 32, prelude, 46, fors, 2400, roots, 96, tree, PALI_SLH_XMSS_TREE_BYTES, output, 3856) == PALI_SLH_INVALID_INPUT, "signature cannot alias key");
    require(pali_slh_fors_tree(output, 64, prelude, 46, 0, output, 416) == PALI_SLH_INVALID_INPUT, "FORS cannot alias key");
    require(pali_slh_tree_level(tree, 48, tree, PALI_SLH_XMSS_TREE_BYTES, 0, 0, 1) == PALI_SLH_INVALID_INPUT, "tree cannot alias seed");
    require(calls == before_guards, "malformed inputs never reach vendor");
    require(pali_slh_tree_level(key, 48, tree, PALI_SLH_XMSS_TREE_BYTES, 22, 0, 1) == PALI_SLH_OK, "last level accepted without clamping");
    require(tree[PALI_SLH_XMSS_TREE_BYTES - 1] == 0x52, "exact final tree window");
    printf("SLH native ABI controls passed: %u assertions (vendor doubles; no positive signature qualification)\n", checks);
    free(tree);
    return 0;
}
