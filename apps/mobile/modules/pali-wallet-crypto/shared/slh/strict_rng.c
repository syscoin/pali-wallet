/* SPDX-License-Identifier: MIT */
#include "strict_rng.h"
#include "pali_slh_secure_clear.h"

#include <errno.h>
#include <pthread.h>
#include <setjmp.h>
#include <stdlib.h>
#include <string.h>

/* Intentionally replaces upstream/randombytes.c. */
static pthread_mutex_t process_slot = PTHREAD_MUTEX_INITIALIZER;
static unsigned int independent_calls;
static int exclusive_call;

struct rng_lease {
    jmp_buf refusal;
    enum pali_slh_rng_contract contract;
    uint8_t optrand[16];
    unsigned int sets;
    unsigned int draws;
    struct pali_slh_sensitive_span *checkpoint;
};

static _Thread_local struct rng_lease *active_lease;

void pali_slh_erase(void *bytes, size_t size) {
    volatile uint8_t *cursor = (volatile uint8_t *)bytes;
    while (size--) *cursor++ = 0;
}

static _Noreturn void refuse_rng(void) {
    /* An unowned upstream RNG entry is a programming error. It cannot return
     * fabricated entropy. Owned calls unwind to the error-atomic boundary. */
    if (active_lease) {
        pali_slh_clear_sensitive_to(active_lease->checkpoint);
        longjmp(active_lease->refusal, 1);
    }
    abort();
}

void set_rng_buffer(const unsigned char *buffer, unsigned long long length) {
    struct rng_lease *lease = active_lease;
    if (!lease || lease->contract == PALI_SLH_RNG_NONE || !buffer ||
        length != sizeof(lease->optrand) || lease->sets || lease->draws ||
        memcmp(buffer, lease->optrand, sizeof(lease->optrand)) != 0)
        refuse_rng();
    lease->sets = 1;
}

void randombytes(unsigned char *output, unsigned long long length) {
    struct rng_lease *lease = active_lease;
    if (!lease || lease->contract != PALI_SLH_RNG_DRAW_OPTRAND || !output ||
        lease->sets != 1 || lease->draws || length != sizeof(lease->optrand))
        refuse_rng();
    memcpy(output, lease->optrand, sizeof(lease->optrand));
    lease->draws = 1;
}

static enum pali_slh_status run_owned(
    int independent,
    enum pali_slh_rng_contract contract,
    const uint8_t *optrand16,
    pali_slh_call call,
    void *argument,
    int *engine_result) {
    if (!call || !engine_result ||
        (contract != PALI_SLH_RNG_NONE &&
         contract != PALI_SLH_RNG_EXPLICIT_OPTRAND &&
         contract != PALI_SLH_RNG_DRAW_OPTRAND) ||
        (contract != PALI_SLH_RNG_NONE && !optrand16))
        return PALI_SLH_INVALID_INPUT;
    if (active_lease) return PALI_SLH_BUSY;
    if (pthread_mutex_lock(&process_slot) != 0) return PALI_SLH_ENGINE_FAILED;
    const int admitted = !exclusive_call &&
        (independent ? independent_calls < PALI_SLH_MAX_PARALLEL_CALLS : independent_calls == 0);
    if (admitted) {
        if (independent) independent_calls++;
        else exclusive_call = 1;
    }
    if (pthread_mutex_unlock(&process_slot) != 0) return PALI_SLH_ENGINE_FAILED;
    if (!admitted) return PALI_SLH_BUSY;

    struct rng_lease lease;
    memset(&lease, 0, sizeof(lease));
    lease.contract = contract;
    lease.checkpoint = pali_slh_sensitive_checkpoint();
    if (optrand16) memcpy(lease.optrand, optrand16, sizeof(lease.optrand));
    active_lease = &lease;
    enum pali_slh_status status = PALI_SLH_RNG_CONTRACT_FAILED;
    if (setjmp(lease.refusal) == 0) {
        const int result = call(argument);
        const unsigned int expected_sets = contract == PALI_SLH_RNG_NONE ? 0 : 1;
        const unsigned int expected_draws = contract == PALI_SLH_RNG_DRAW_OPTRAND ? 1 : 0;
        if (lease.sets == expected_sets && lease.draws == expected_draws) {
            *engine_result = result;
            status = PALI_SLH_OK;
        }
    }
    active_lease = NULL;
    pali_slh_erase(&lease, sizeof(lease));
    if (pthread_mutex_lock(&process_slot) != 0) return PALI_SLH_ENGINE_FAILED;
    if (independent) independent_calls--;
    else exclusive_call = 0;
    if (pthread_mutex_unlock(&process_slot) != 0) return PALI_SLH_ENGINE_FAILED;
    return status;
}

enum pali_slh_status pali_slh_run_serialized(
    enum pali_slh_rng_contract contract, const uint8_t *optrand16,
    pali_slh_call call, void *argument, int *engine_result) {
    return run_owned(0, contract, optrand16, call, argument, engine_result);
}

enum pali_slh_status pali_slh_run_independent(
    pali_slh_call call, void *argument, int *engine_result) {
    return run_owned(1, PALI_SLH_RNG_NONE, NULL, call, argument, engine_result);
}
