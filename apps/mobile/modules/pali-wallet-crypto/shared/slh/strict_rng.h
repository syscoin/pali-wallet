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

/* Internal C-only trampoline. A single process-wide slot owns the upstream
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

void pali_slh_erase(void *bytes, size_t size);
#endif
