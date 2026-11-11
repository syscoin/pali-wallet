/* SPDX-License-Identifier: MIT */
/* Fixed public conformance inputs only. No FORS, setup tree or signing benchmark. */
#include <assert.h>
#include <stdio.h>
#include <string.h>

/* Test the real private compression boundary without adding a production ABI. */
#include "../shared/slh/sha2.c"
#include "../shared/slh/hash.h"
#include "../shared/slh/pali_slh_native.h"
#include "../shared/slh/strict_rng.h"

static void pattern(uint8_t *bytes, size_t count, unsigned int salt) {
    for (size_t i = 0; i < count; ++i) bytes[i] = (uint8_t)(i * 37 + salt);
}

static void emit(const char *label, const uint8_t *bytes, size_t count) {
    printf("%s:", label);
    for (size_t i = 0; i < count; ++i) printf("%02x", bytes[i]);
    putchar('\n');
}

static void known(const uint8_t bytes[32], const char *hex) {
    char actual[65];
    for (size_t i = 0; i < 32; ++i)
        assert(snprintf(actual + 2 * i, 3, "%02x", bytes[i]) == 2);
    assert(strcmp(actual, hex) == 0);
}

static int vectors(void *unused) {
    (void)unused;
    uint8_t input[640], digest[64], state[40];
    pattern(input, sizeof(input), 19);
    sha256(digest, input, 0);
    known(digest, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    sha256(digest, (const uint8_t *)"abc", 3);
    known(digest, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

    /* Every short-message padding boundary, plus multiblock/unaligned data. */
    for (size_t offset = 0; offset < 4; ++offset) {
        for (size_t length = 0; length <= 260; ++length) {
            sha256(digest, input + offset, length);
            emit("sha256", digest, 32);
        }
        sha256(digest, input + offset, 513);
        emit("sha256-long", digest, 32);
    }

    const size_t tails[] = {0, 1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 129};
    for (size_t blocks = 0; blocks < 4; ++blocks) {
        for (size_t i = 0; i < sizeof(tails) / sizeof(tails[0]); ++i) {
            sha256_inc_init(state);
            sha256_inc_blocks(state, input, blocks);
            emit("stream-state", state, sizeof(state));
            sha256_inc_finalize(digest, state, input + 64 * blocks, tails[i]);
            uint8_t whole[32];
            sha256(whole, input, 64 * blocks + tails[i]);
            assert(memcmp(digest, whole, sizeof(whole)) == 0);
            emit("stream-digest", digest, sizeof(whole));
            emit("final-state", state, sizeof(state));
        }
    }

    /* Explicit byte-counter carries at 8/16/32 bits and modulo 2^64. */
    const uint8_t carries[][2][8] = {
        {{0, 0, 0, 0, 0, 0, 0, 0xc0}, {0, 0, 0, 0, 0, 0, 1, 0}},
        {{0, 0, 0, 0, 0, 0, 0xff, 0xc0}, {0, 0, 0, 0, 0, 1, 0, 0}},
        {{0, 0, 0, 0, 0xff, 0xff, 0xff, 0xc0}, {0, 0, 0, 1, 0, 0, 0, 0}},
        {{0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xc0}, {0, 0, 0, 0, 0, 0, 0, 0}},
    };
    for (size_t i = 0; i < sizeof(carries) / sizeof(carries[0]); ++i) {
        uint8_t ordinary[40];
        sha256_inc_init(state);
        sha256_inc_init(ordinary);
        memcpy(state + 32, carries[i][0], 8);
        sha256_inc_blocks(state, input, 1);
        sha256_inc_blocks(ordinary, input, 1);
        assert(memcmp(state + 32, carries[i][1], 8) == 0);
        assert(memcmp(state, ordinary, 32) == 0);
        emit("counter-carry", state, sizeof(state));
    }

    /* Every non-block input must leave all chaining state and surrounding
     * bytes untouched, including unaligned state and overlapping input. */
    for (size_t offset = 0; offset < 4; ++offset) {
        for (size_t length = 0; length < 64; ++length) {
            for (size_t overlap = 0; overlap < 2; ++overlap) {
                uint8_t arena[128], before[128];
                pattern(arena, sizeof(arena), (unsigned int)length);
                memcpy(before, arena, sizeof(arena));
                const uint8_t *message = overlap ? arena + offset : input + offset;
                assert(crypto_hashblocks_sha256(arena + offset, message, length) == length);
                assert(memcmp(arena, before, sizeof(arena)) == 0);
            }
        }
    }

    const size_t lengths[] = {0, 1, 63, 64, 65, 127, 128, 129, 191, 192, 193, 511};
    for (size_t offset = 0; offset < 4; ++offset) {
        uint8_t unaligned[44];
        for (size_t i = 0; i < sizeof(lengths) / sizeof(lengths[0]); ++i) {
            uint8_t count[8];
            pattern(unaligned, sizeof(unaligned), (unsigned int)i);
            memcpy(count, unaligned + offset + 32, sizeof(count));
            assert(crypto_hashblocks_sha256(unaligned + offset, input + offset, lengths[i]) == lengths[i] % 64);
            assert(memcmp(count, unaligned + offset + 32, sizeof(count)) == 0);
            emit("arbitrary-state", unaligned, sizeof(unaligned));
        }
    }
    const size_t overlap_lengths[] = {0, 63, 64, 65, 128, 129, 256};
    const int shifts[] = {-8, 0, 1, 17, 32};
    for (size_t alignment = 0; alignment < 4; ++alignment) {
        for (size_t shift = 0; shift < sizeof(shifts) / sizeof(shifts[0]); ++shift) {
            for (size_t i = 0; i < sizeof(overlap_lengths) / sizeof(overlap_lengths[0]); ++i) {
                uint8_t shared[384], count[8];
                pattern(shared, sizeof(shared), (unsigned int)i);
                uint8_t *s = shared + 16 + alignment;
                memcpy(count, s + 32, sizeof(count));
                assert(crypto_hashblocks_sha256(s, s + shifts[shift], overlap_lengths[i]) == overlap_lengths[i] % 64);
                assert(memcmp(count, s + 32, sizeof(count)) == 0);
                emit("overlap", shared, sizeof(shared));
            }
        }
    }

    /* Existing seed absorption, MGF and HMAC call sites, unchanged by backend. */
    spx_ctx context = {0};
    pattern(context.pub_seed, SPX_N, 7);
    pattern(context.sk_seed, SPX_N, 9);
    initialize_hash_function(&context);
    emit("seed-state", context.state_seeded, sizeof(context.state_seeded));
    for (size_t i = 0; i < sizeof(tails) / sizeof(tails[0]); ++i) {
        uint8_t mask[130];
        memset(mask, 0xa5, sizeof(mask));
        mgf1_256(mask, tails[i], input, 77);
        emit("mgf", mask, sizeof(mask));
    }
    uint8_t optrand[SPX_N], message[34] = {0};
    pattern(optrand, sizeof(optrand), 11);
    pattern(message + 2, 32, 13);
    gen_message_random(digest, context.sk_seed, optrand, message, sizeof(message), &context);
    emit("hmac", digest, SPX_N);
    for (size_t i = 0; i < sizeof(tails) / sizeof(tails[0]); ++i) {
        sha512(digest, input + 1, tails[i]);
        emit("unchanged-sha512", digest, sizeof(digest));
    }
    return 0;
}

int main(void) {
    int result = -1;
    assert(pali_slh_run_serialized(PALI_SLH_RNG_NONE, NULL, vectors, NULL, &result) == PALI_SLH_OK);
    assert(result == 0);
    uint8_t secret[64], action[32], optrand[16], prelude[PALI_SLH_PRELUDE_BYTES];
    pattern(secret, sizeof(secret), 3);
    pattern(action, sizeof(action), 5);
    pattern(optrand, sizeof(optrand), 7);
    assert(pali_slh_prelude(secret, sizeof(secret), action, sizeof(action), optrand, sizeof(optrand), prelude, sizeof(prelude)) == PALI_SLH_OK);
    emit("owned-prelude", prelude, sizeof(prelude));
    return 0;
}
