/* SPDX-License-Identifier: MIT */
#ifndef PALI_SLH_STRICT_RNG_H
#define PALI_SLH_STRICT_RNG_H

#include "pali_slh_native.h"

enum pali_slh_rng_contract {
    PALI_SLH_RNG_NONE,
    PALI_SLH_RNG_EXPLICIT_OPTRAND,
    PALI_SLH_RNG_DRAW_OPTRAND
};

typedef int (*pali_slh_call)(void *argument);

#define PALI_SLH_MAX_PARALLEL_CALLS 6

/* Internal C-only trampoline. An exclusive process-wide slot owns the upstream
 * RNG symbols. No C++ frames or resources may be acquired inside callback.
 * EXPLICIT requires one exact 16-byte set and zero randombytes calls.
 * DRAW requires one exact 16-byte set and one exact 16-byte draw.
 */
enum pali_slh_status pali_slh_run_serialized(
    enum pali_slh_rng_contract contract,
    const uint8_t *optrand16,
    pali_slh_call call,
    void *argument,
    int *engine_result);

/* Only audited, disjoint leaf generation and indexed FORS shards may use this
 * bounded lane. It always installs a thread-local RNG_NONE lease; any RNG call
 * fails closed. Every other operation, including RNG_NONE tree writes and
 * verification, must use the exclusive trampoline above. */
enum pali_slh_status pali_slh_run_independent(
    pali_slh_call call, void *argument, int *engine_result);

void pali_slh_erase(void *bytes, size_t size);
#endif
