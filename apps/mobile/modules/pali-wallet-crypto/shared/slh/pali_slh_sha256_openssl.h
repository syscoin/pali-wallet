/* SPDX-License-Identifier: MIT */
#ifndef PALI_SLH_SHA256_OPENSSL_H
#define PALI_SLH_SHA256_OPENSSL_H

#include <stddef.h>
#include <stdint.h>

/* Internal compression only. sha2.c owns BE serialization, byte counts,
 * padding and all higher-level hash constructions. Returns unconsumed bytes. */
size_t pali_slh_sha256_blocks(uint32_t words[8], const uint8_t *input,
                             size_t input_bytes);

#endif
