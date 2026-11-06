/*
 * SLH-DSA-SHA2-128-24 parameters (NIST SP 800-230 Table 1).
 *
 * Derived from sphincs/sphincsplus `ref/params/params-sphincs-sha2-128s.h`
 * with the d/h/a/k/w constants swapped for the 24-signature variant and
 * w=4 support added to the WOTS_LEN2 precompute table below.
 *
 * Parameters:
 *   n=16  h=22  d=1  h'=22  a=24  k=6  lgw=2 (w=4)  m=21
 */
#ifndef SPX_PARAMS_H
#define SPX_PARAMS_H

#define SPX_NAMESPACE(s) SPX_##s

#define SPX_N 16
/* SPX_FULL_HEIGHT / SPX_FORS_HEIGHT are -D-overridable (#ifndef) so CI can build
 * a reduced-parameter binary for a fast Python<->C crosscheck. The DEFAULT build
 * is the full NIST SP 800-230 set; do NOT override these for any binary intended
 * to verify on-chain. */
#ifndef SPX_FULL_HEIGHT
#define SPX_FULL_HEIGHT 22
#endif
#define SPX_D 1
#ifndef SPX_FORS_HEIGHT
#define SPX_FORS_HEIGHT 24
#endif
#define SPX_FORS_TREES 6

/* Winternitz parameter — 4 for the 24-signature variant (security level 1). */
#define SPX_WOTS_W 4

/* Use SHA-256 for every hash (category-1 SHA-2 instantiation per FIPS 205 §11.2.1). */
#define SPX_SHA512 0

/* For clarity (32-byte internal ADRS struct; the compressed ADRSc is 22 bytes). */
#define SPX_ADDR_BYTES 32

/* WOTS parameters — extended precompute table to include w=4. */
#if SPX_WOTS_W == 256
    #define SPX_WOTS_LOGW 8
#elif SPX_WOTS_W == 16
    #define SPX_WOTS_LOGW 4
#elif SPX_WOTS_W == 4
    #define SPX_WOTS_LOGW 2
#else
    #error SPX_WOTS_W assumed 4, 16 or 256
#endif

#define SPX_WOTS_LEN1 (8 * SPX_N / SPX_WOTS_LOGW)

/* SPX_WOTS_LEN2 = floor(log_w(len_1 * (w-1))) + 1 */
#if SPX_WOTS_W == 256
    #if SPX_N <= 1
        #define SPX_WOTS_LEN2 1
    #elif SPX_N <= 256
        #define SPX_WOTS_LEN2 2
    #else
        #error Did not precompute SPX_WOTS_LEN2 for n outside {2, .., 256}
    #endif
#elif SPX_WOTS_W == 16
    #if SPX_N <= 8
        #define SPX_WOTS_LEN2 2
    #elif SPX_N <= 136
        #define SPX_WOTS_LEN2 3
    #elif SPX_N <= 256
        #define SPX_WOTS_LEN2 4
    #else
        #error Did not precompute SPX_WOTS_LEN2 for n outside {2, .., 256}
    #endif
#elif SPX_WOTS_W == 4
    /* l1(w-1) bit-length  ⇒  l2 = ceil(bit-len / lgw) */
    #if SPX_N <= 4
        /* l1=16, l1*(w-1)=48, bit-len=6, l2=ceil(6/2)=3 */
        #define SPX_WOTS_LEN2 3
    #elif SPX_N <= 32
        /* n=16: l1=64, l1*(w-1)=192, bit-len=8, l2=ceil(8/2)=4 */
        /* n=32: l1=128, l1*(w-1)=384, bit-len=9, l2=ceil(9/2)=5 */
        /* Choose 4 here for our n=16 target; larger n not used. */
        #define SPX_WOTS_LEN2 4
    #else
        #error Did not precompute SPX_WOTS_LEN2 for n > 32 at w=4
    #endif
#endif

#define SPX_WOTS_LEN (SPX_WOTS_LEN1 + SPX_WOTS_LEN2)
#define SPX_WOTS_BYTES (SPX_WOTS_LEN * SPX_N)
#define SPX_WOTS_PK_BYTES SPX_WOTS_BYTES

/* Subtree size. */
#define SPX_TREE_HEIGHT (SPX_FULL_HEIGHT / SPX_D)

#if SPX_TREE_HEIGHT * SPX_D != SPX_FULL_HEIGHT
    #error SPX_D should always divide SPX_FULL_HEIGHT
#endif

/* FORS parameters. */
#define SPX_FORS_MSG_BYTES ((SPX_FORS_HEIGHT * SPX_FORS_TREES + 7) / 8)
#define SPX_FORS_BYTES ((SPX_FORS_HEIGHT + 1) * SPX_FORS_TREES * SPX_N)
#define SPX_FORS_PK_BYTES SPX_N

/* Resulting SPX sizes. */
#define SPX_BYTES (SPX_N + SPX_FORS_BYTES + SPX_D * SPX_WOTS_BYTES + \
                   SPX_FULL_HEIGHT * SPX_N)
#define SPX_PK_BYTES (2 * SPX_N)
#define SPX_SK_BYTES (2 * SPX_N + SPX_PK_BYTES)

#include "sha2_offsets.h"

#endif
