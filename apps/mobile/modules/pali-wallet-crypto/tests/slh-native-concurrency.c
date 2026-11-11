/* Fixed public inputs and bounded thread coordination; no full tree/signing run. */
#include "pali_slh_native.h"
#include "strict_rng.h"
#include "pali_slh_secure_clear.h"
#include "randombytes.h"
#include <assert.h>
#include <pthread.h>
#include <stdio.h>
#include <string.h>

struct gate { pthread_mutex_t lock; pthread_cond_t changed; unsigned entered; int release; };
struct call { struct gate *gate; int id, fail; enum pali_slh_status status; int result; uint8_t erased[32]; };
static int noop(void *unused) { (void)unused; return 7; }
static int hold(void *argument) {
    struct call *call = argument;
    struct pali_slh_sensitive_span span = {{call->erased, sizeof(call->erased)}, NULL};
    pali_slh_track_sensitive(&span);
    memset(call->erased, call->id, sizeof(call->erased));
    int nested = -1;
    assert(pali_slh_run_independent(noop, NULL, &nested) == PALI_SLH_BUSY);
    assert(pali_slh_run_serialized(PALI_SLH_RNG_NONE, NULL, noop, NULL, &nested) == PALI_SLH_BUSY);
    pthread_mutex_lock(&call->gate->lock);
    call->gate->entered++;
    pthread_cond_broadcast(&call->gate->changed);
    while (!call->gate->release) pthread_cond_wait(&call->gate->changed, &call->gate->lock);
    pthread_mutex_unlock(&call->gate->lock);
    if (call->fail) { uint8_t refused[16]; randombytes(refused, sizeof(refused)); }
    pali_slh_release_sensitive(&span);
    return call->id;
}
static void *start(void *argument) {
    struct call *call = argument;
    call->status = pali_slh_run_independent(hold, call, &call->result);
    return NULL;
}
static void independent_capacity(void) {
    struct gate gate = {PTHREAD_MUTEX_INITIALIZER, PTHREAD_COND_INITIALIZER, 0, 0};
    struct call calls[PALI_SLH_MAX_PARALLEL_CALLS] = {0};
    pthread_t threads[PALI_SLH_MAX_PARALLEL_CALLS];
    for (unsigned i = 0; i < PALI_SLH_MAX_PARALLEL_CALLS; ++i) {
        calls[i].gate = &gate; calls[i].id = (int)i + 1; calls[i].fail = i == 2; calls[i].result = -1;
        assert(pthread_create(&threads[i], NULL, start, &calls[i]) == 0);
    }
    pthread_mutex_lock(&gate.lock);
    while (gate.entered != PALI_SLH_MAX_PARALLEL_CALLS) pthread_cond_wait(&gate.changed, &gate.lock);
    pthread_mutex_unlock(&gate.lock);
    int result = -1;
    assert(pali_slh_run_independent(noop, NULL, &result) == PALI_SLH_BUSY && result == -1);
    assert(pali_slh_run_serialized(PALI_SLH_RNG_NONE, NULL, noop, NULL, &result) == PALI_SLH_BUSY && result == -1);
    pthread_mutex_lock(&gate.lock); gate.release = 1; pthread_cond_broadcast(&gate.changed); pthread_mutex_unlock(&gate.lock);
    for (unsigned i = 0; i < PALI_SLH_MAX_PARALLEL_CALLS; ++i) {
        assert(pthread_join(threads[i], NULL) == 0);
        assert(calls[i].status == (calls[i].fail ? PALI_SLH_RNG_CONTRACT_FAILED : PALI_SLH_OK));
        assert(calls[i].result == (calls[i].fail ? -1 : calls[i].id));
        for (unsigned j = 0; j < sizeof(calls[i].erased); ++j) assert(calls[i].erased[j] == 0);
    }
    assert(pali_slh_run_serialized(PALI_SLH_RNG_NONE, NULL, noop, NULL, &result) == PALI_SLH_OK && result == 7);
    assert(pthread_cond_destroy(&gate.changed) == 0); assert(pthread_mutex_destroy(&gate.lock) == 0);
}
static int forbid_parallel(void *unused) {
    (void)unused; int result = -1;
    assert(pali_slh_run_independent(noop, NULL, &result) == PALI_SLH_BUSY && result == -1);
    return 0;
}
struct leaves { uint8_t seed[48], output[8 * 16]; uint32_t start; enum pali_slh_status status; };
static void *build_leaves(void *argument) {
    struct leaves *call = argument;
    call->status = pali_slh_leaf_chunk(call->seed, sizeof(call->seed), call->start, 8, call->output, sizeof(call->output));
    return NULL;
}
static void real_leaf_equivalence(void) {
    struct leaves calls[PALI_SLH_MAX_PARALLEL_CALLS] = {0};
    uint8_t expected[PALI_SLH_MAX_PARALLEL_CALLS][8 * 16]; pthread_t threads[PALI_SLH_MAX_PARALLEL_CALLS];
    for (unsigned i = 0; i < PALI_SLH_MAX_PARALLEL_CALLS; ++i) {
        for (unsigned j = 0; j < 48; ++j) calls[i].seed[j] = (uint8_t)(j * 37 + i);
        calls[i].start = i * 8;
        assert(pali_slh_leaf_chunk(calls[i].seed, 48, calls[i].start, 8, expected[i], sizeof(expected[i])) == PALI_SLH_OK);
    }
    for (unsigned i = 0; i < PALI_SLH_MAX_PARALLEL_CALLS; ++i) assert(pthread_create(&threads[i], NULL, build_leaves, &calls[i]) == 0);
    for (unsigned i = 0; i < PALI_SLH_MAX_PARALLEL_CALLS; ++i) {
        assert(pthread_join(threads[i], NULL) == 0); assert(calls[i].status == PALI_SLH_OK);
        assert(memcmp(expected[i], calls[i].output, sizeof(expected[i])) == 0);
    }
}
int main(void) {
    independent_capacity(); int result = -1;
    assert(pali_slh_run_serialized(PALI_SLH_RNG_NONE, NULL, forbid_parallel, NULL, &result) == PALI_SLH_OK && result == 0);
    real_leaf_equivalence(); puts("Native SLH bounded admission, TLS RNG/erasure, exclusion and six-lane leaf equivalence passed");
    return 0;
}
