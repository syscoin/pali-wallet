/* SPDX-License-Identifier: MIT */
#include "pali_slh_secure_clear.h"
#include "strict_rng.h"

#include <stdlib.h>

static _Thread_local struct pali_slh_sensitive_span *sensitive_head;

void pali_slh_clear_span(struct pali_slh_clear_span *span) {
    pali_slh_erase(span->bytes, span->size);
}

void pali_slh_track_sensitive(struct pali_slh_sensitive_span *span) {
    span->previous = sensitive_head;
    sensitive_head = span;
}

void pali_slh_release_sensitive(struct pali_slh_sensitive_span *span) {
    if (sensitive_head != span) abort();
    sensitive_head = span->previous;
    pali_slh_clear_span(&span->storage);
}

struct pali_slh_sensitive_span *pali_slh_sensitive_checkpoint(void) {
    return sensitive_head;
}

void pali_slh_clear_sensitive_to(struct pali_slh_sensitive_span *checkpoint) {
    while (sensitive_head != checkpoint) {
        if (!sensitive_head) abort();
        struct pali_slh_sensitive_span *span = sensitive_head;
        sensitive_head = span->previous;
        pali_slh_clear_span(&span->storage);
    }
}
