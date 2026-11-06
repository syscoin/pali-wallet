/* SPDX-License-Identifier: MIT */
#ifndef PALI_SLH_SECURE_CLEAR_H
#define PALI_SLH_SECURE_CLEAR_H

#include <stddef.h>

struct pali_slh_clear_span {
    void *bytes;
    size_t size;
};

struct pali_slh_sensitive_span {
    struct pali_slh_clear_span storage;
    struct pali_slh_sensitive_span *previous;
};

void pali_slh_clear_span(struct pali_slh_clear_span *span);
void pali_slh_track_sensitive(struct pali_slh_sensitive_span *span);
void pali_slh_release_sensitive(struct pali_slh_sensitive_span *span);
struct pali_slh_sensitive_span *pali_slh_sensitive_checkpoint(void);
void pali_slh_clear_sensitive_to(struct pali_slh_sensitive_span *checkpoint);

/* Clang is used by both Apple and Android NDK builds. Cleanup covers ordinary
 * returns. Tracked scopes also cover the RNG-contract longjmp before unwind.
 */
#if !defined(__clang__) && !defined(__GNUC__)
#error "SLH erasure scopes require compiler cleanup support"
#endif

#define PALI_SLH_CLEAR_ON_RETURN(value) \
    struct pali_slh_clear_span pali_clear_##value \
        __attribute__((cleanup(pali_slh_clear_span))) = { &(value), sizeof(value) }

#define PALI_SLH_TRACK_SECRET(value) \
    struct pali_slh_sensitive_span pali_sensitive_##value \
        __attribute__((cleanup(pali_slh_release_sensitive))) = { \
            { &(value), sizeof(value) }, NULL }; \
    pali_slh_track_sensitive(&pali_sensitive_##value)

#endif
