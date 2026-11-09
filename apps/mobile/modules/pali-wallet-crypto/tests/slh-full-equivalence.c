/* SPDX-License-Identifier: MIT */
/* Adapted from the prior full.c public KAT. Hosted full_slh qualification only;
 * this fixed public key/optrand never enters wallet custody or its cache. */
#define _POSIX_C_SOURCE 200809L
#include "pali_slh_native.h"
#include "params.h"

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#if !defined(PALI_SLH_OPENSSL_SHA256) || PALI_SLH_OPENSSL_SHA256 != 1
#error "Full equivalence must exercise the native OpenSSL compression backend"
#endif
_Static_assert(SPX_N == 16 && SPX_FULL_HEIGHT == 22 && SPX_D == 1 &&
               SPX_FORS_HEIGHT == 24 && SPX_FORS_TREES == 6 && SPX_WOTS_W == 4,
               "Full equivalence requires the pinned SHA2-128-24 profile");

#define REQUIRE(expression) do { if (!(expression)) { \
    fprintf(stderr, "full equivalence failed at line %d\n", __LINE__); \
    return 1; } } while (0)

static double now_ms(void) {
    struct timespec value;
    if (clock_gettime(CLOCK_MONOTONIC, &value) != 0) {
        perror("full equivalence monotonic clock");
        exit(1);
    }
    return (double)value.tv_sec * 1000.0 + (double)value.tv_nsec / 1000000.0;
}

int main(int argc, char **argv) {
    REQUIRE(argc == 4);
    /* Runner hash-checks the canonical JSON and this exact packed input before
     * execution: public SK64 || raw action32 || optrand16 || expected sig3856. */
    uint8_t fixture[64 + 32 + 16 + PALI_SLH_SIGNATURE_BYTES];
    FILE *source = fopen(argv[1], "rb");
    REQUIRE(source != NULL);
    REQUIRE(fread(fixture, 1, sizeof(fixture), source) == sizeof(fixture));
    REQUIRE(fgetc(source) == EOF && fclose(source) == 0);
    REQUIRE(memcmp(fixture, pali_slh_qualification_seed(), 48) == 0);

    const uint8_t *const action = fixture + 64;
    const uint8_t *const optrand = fixture + 96;
    const uint8_t *const expected = fixture + 112;
    uint8_t *tree = calloc(1, PALI_SLH_XMSS_TREE_BYTES);
    REQUIRE(tree != NULL);
    const double setup_started = now_ms();
    for (uint32_t level = 0; level <= PALI_SLH_XMSS_HEIGHT; ++level) {
        const uint32_t nodes = PALI_SLH_XMSS_LEAVES >> level;
        for (uint32_t start = 0; start < nodes; start += PALI_SLH_MAX_LEAF_CHUNK) {
            const uint32_t remaining = nodes - start;
            const uint32_t count = remaining < PALI_SLH_MAX_LEAF_CHUNK
                ? remaining : PALI_SLH_MAX_LEAF_CHUNK;
            REQUIRE(pali_slh_tree_level(fixture, 48, tree,
                PALI_SLH_XMSS_TREE_BYTES, level, start, count) == PALI_SLH_OK);
        }
        printf("Generated full public XMSS level %u/22\n", level);
        fflush(stdout);
    }
    const double setup_ms = now_ms() - setup_started;
    uint8_t public_key[PALI_SLH_PK_BYTES];
    memcpy(public_key, fixture + 32, SPX_N);
    memcpy(public_key + SPX_N, tree + PALI_SLH_XMSS_TREE_BYTES - SPX_N, SPX_N);
    REQUIRE(memcmp(public_key, fixture + 32, sizeof(public_key)) == 0);

    uint8_t cached[PALI_SLH_SIGNATURE_BYTES], sharded[PALI_SLH_SIGNATURE_BYTES];
    const double cached_started = now_ms();
    REQUIRE(pali_slh_sign_cached(fixture, 64, action, 32, optrand, 16,
        tree, PALI_SLH_XMSS_TREE_BYTES, cached, sizeof(cached)) == PALI_SLH_OK);
    const double cached_ms = now_ms() - cached_started;
    REQUIRE(memcmp(cached, expected, sizeof(cached)) == 0);

    uint8_t prelude[PALI_SLH_PRELUDE_BYTES];
    uint8_t fors[PALI_SLH_FORS_SIGNATURE_BYTES], roots[PALI_SLH_FORS_ROOTS_BYTES];
    const double sharded_started = now_ms();
    REQUIRE(pali_slh_prelude(fixture, 64, action, 32, optrand, 16,
        prelude, sizeof(prelude)) == PALI_SLH_OK);
    for (uint32_t index = 0; index < PALI_SLH_FORS_TREES; ++index) {
        uint8_t shard[PALI_SLH_FORS_OUTPUT_BYTES];
        REQUIRE(pali_slh_fors_tree(fixture, 64, prelude, sizeof(prelude),
            index, shard, sizeof(shard)) == PALI_SLH_OK);
        const size_t signature_bytes = PALI_SLH_FORS_SIGNATURE_BYTES / PALI_SLH_FORS_TREES;
        memcpy(fors + index * signature_bytes, shard, signature_bytes);
        memcpy(roots + index * SPX_N, shard + signature_bytes, SPX_N);
    }
    REQUIRE(pali_slh_finish(fixture, 64, action, 32, prelude, sizeof(prelude),
        fors, sizeof(fors), roots, sizeof(roots), tree, PALI_SLH_XMSS_TREE_BYTES,
        sharded, sizeof(sharded)) == PALI_SLH_OK);
    const double sharded_ms = now_ms() - sharded_started;
    REQUIRE(memcmp(sharded, expected, sizeof(sharded)) == 0);

    FILE *target = fopen(argv[2], "wb");
    REQUIRE(target != NULL);
    REQUIRE(fwrite(public_key, 1, sizeof(public_key), target) == sizeof(public_key));
    REQUIRE(fwrite(cached, 1, sizeof(cached), target) == sizeof(cached));
    REQUIRE(fwrite(sharded, 1, sizeof(sharded), target) == sizeof(sharded));
    REQUIRE(fclose(target) == 0);
    FILE *timings = fopen(argv[3], "w");
    REQUIRE(timings != NULL);
    REQUIRE(fprintf(timings,
        "{\"xmssTreeMs\":%.6f,\"cachedSignMs\":%.6f,\"shardedSignMs\":%.6f}\n",
        setup_ms, cached_ms, sharded_ms) > 0);
    REQUIRE(fclose(timings) == 0);
    free(tree);
    puts("Full native public key and both signatures match canonical bytes");
    return 0;
}
