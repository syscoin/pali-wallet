/* Canonical public fixture only: no tree construction and no wallet seed. */
#include "pali_slh_native.h"
#include <assert.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

struct shard {
    const uint8_t *key, *prelude;
    unsigned index;
    uint8_t output[PALI_SLH_FORS_OUTPUT_BYTES];
    enum pali_slh_status status;
};
static void *compute(void *argument) {
    struct shard *shard = argument;
    shard->status = pali_slh_fors_tree(shard->key, PALI_SLH_SK_BYTES,
        shard->prelude, PALI_SLH_PRELUDE_BYTES, shard->index,
        shard->output, sizeof(shard->output));
    return NULL;
}
static double now(void) {
    struct timespec time;
    assert(clock_gettime(CLOCK_MONOTONIC, &time) == 0);
    return (double)time.tv_sec + (double)time.tv_nsec / 1000000000.0;
}
int main(int argc, char **argv) {
    assert(argc == 2);
    uint8_t fixture[3968];
    FILE *file = fopen(argv[1], "rb");
    assert(file && fread(fixture, 1, sizeof(fixture), file) == sizeof(fixture));
    assert(fgetc(file) == EOF && fclose(file) == 0);
    const uint8_t *key = fixture, *action = fixture + 64, *optrand = fixture + 96, *expected = fixture + 112;
    uint8_t prelude[PALI_SLH_PRELUDE_BYTES], joined[PALI_SLH_SIGNATURE_BYTES];
    assert(pali_slh_prelude(key, 64, action, 32, optrand, 16, prelude, sizeof(prelude)) == PALI_SLH_OK);
    assert(memcmp(prelude, expected, 16) == 0);
    struct shard parallel[PALI_SLH_FORS_TREES] = {0}, serial[PALI_SLH_FORS_TREES] = {0};
    pthread_t threads[PALI_SLH_FORS_TREES];
    double start = now();
    for (unsigned i = 0; i < PALI_SLH_FORS_TREES; ++i) {
        parallel[i].key = key; parallel[i].prelude = prelude; parallel[i].index = i;
        assert(pthread_create(&threads[i], NULL, compute, &parallel[i]) == 0);
    }
    for (unsigned i = 0; i < PALI_SLH_FORS_TREES; ++i) assert(pthread_join(threads[i], NULL) == 0);
    double parallel_seconds = now() - start;
    start = now();
    for (unsigned i = 0; i < PALI_SLH_FORS_TREES; ++i) {
        serial[i].key = key; serial[i].prelude = prelude; serial[i].index = i;
        compute(&serial[i]);
    }
    double serial_seconds = now() - start;
    memcpy(joined, expected, sizeof(joined));
    for (unsigned i = 0; i < PALI_SLH_FORS_TREES; ++i) {
        assert(parallel[i].status == PALI_SLH_OK && serial[i].status == PALI_SLH_OK);
        assert(memcmp(parallel[i].output, serial[i].output, PALI_SLH_FORS_OUTPUT_BYTES) == 0);
        assert(memcmp(parallel[i].output, expected + 16 + i * 400, 400) == 0);
        memcpy(joined + 16 + i * 400, parallel[i].output, 400);
    }
    assert(memcmp(joined, expected, sizeof(joined)) == 0);
    assert(pali_slh_verify(key + 32, 32, action, 32, joined, sizeof(joined)) == PALI_SLH_OK);
    printf("{\"parallelForsSeconds\":%.6f,\"serialForsSeconds\":%.6f,\"exactShards\":6,\"shardBytesIncludingRoot\":416,\"canonicalJoinedSignatureVerified\":true}\n", parallel_seconds, serial_seconds);
    return 0;
}
