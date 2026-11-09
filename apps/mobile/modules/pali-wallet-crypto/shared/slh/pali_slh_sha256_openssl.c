/* SPDX-License-Identifier: MIT */
#include "pali_slh_sha256_openssl.h"

/* The scalar build is an explicit conformance reference, never a native
 * runtime fallback. Both native build definitions require this backend. */
#if defined(PALI_SLH_OPENSSL_SHA256)
#if PALI_SLH_OPENSSL_SHA256 != 1
#error "The native SLH SHA256 backend must be explicitly enabled"
#endif

/* These public low-level declarations are deprecated in OpenSSL 3. Suppress
 * their declaration attributes in this translation unit only. */
#define OPENSSL_SUPPRESS_DEPRECATED
#if defined(__APPLE__)
#include "quickcrypto_openssl_prefix.h"
#ifndef SHA256_Transform
#error "The pinned QuickCrypto OpenSSL symbol prefix is required"
#endif
#endif
#include <openssl/opensslv.h>
#include <openssl/sha.h>

#include "pali_slh_secure_clear.h"

#if OPENSSL_VERSION_MAJOR != 3 || OPENSSL_VERSION_MINOR != 6 || OPENSSL_VERSION_PATCH != 2
#error "Native SLH requires the pinned OpenSSL 3.6.2 headers"
#endif
#if defined(OPENSSL_NO_DEPRECATED_3_0)
#error "The public OpenSSL SHA256 compression API is unavailable"
#endif

_Static_assert(SHA256_CBLOCK == 64 && SHA256_DIGEST_LENGTH == 32 &&
               sizeof(((SHA256_CTX *)0)->h) == 8 * sizeof(uint32_t),
               "The public OpenSSL SHA256 chaining state changed");

size_t pali_slh_sha256_blocks(uint32_t words[8], const uint8_t *input,
                             size_t input_bytes) {
    SHA256_CTX context = {0};
    PALI_SLH_CLEAR_ON_RETURN(context);
    context.md_len = SHA256_DIGEST_LENGTH;
    for (size_t i = 0; i < 8; ++i) context.h[i] = words[i];

    /* Transform has no RNG, allocation, finalization or byte-count update.
     * Keep caller state untouched until every input block has been consumed,
     * including when input overlaps the caller's serialized state. */
    while (input_bytes >= SHA256_CBLOCK) {
        SHA256_Transform(&context, input);
        input += SHA256_CBLOCK;
        input_bytes -= SHA256_CBLOCK;
    }
    for (size_t i = 0; i < 8; ++i) words[i] = context.h[i];
    return input_bytes;
}
#endif
