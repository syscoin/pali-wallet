#ifndef PALI_SCRATCH_MIMC_BATCH_H
#define PALI_SCRATCH_MIMC_BATCH_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

enum {
    MIMC_BATCH_VERSION = 1,
    MIMC_BATCH_WORD_BYTES = 32,
    MIMC_BATCH_HEADER_BYTES = 3,
    MIMC_BATCH_OPERAND_BYTES = 1 + MIMC_BATCH_WORD_BYTES,
    MIMC_BATCH_OPERATION_BYTES = 2 * MIMC_BATCH_OPERAND_BYTES,
    MIMC_BATCH_MAX_OPERATIONS = 296,
    MIMC_BATCH_MAX_INPUT = MIMC_BATCH_HEADER_BYTES +
        MIMC_BATCH_MAX_OPERATIONS * MIMC_BATCH_OPERATION_BYTES,
    MIMC_BATCH_MAX_OUTPUT = MIMC_BATCH_MAX_OPERATIONS * MIMC_BATCH_WORD_BYTES,
};

/*
 * Input: version u8, operation count u16 big-endian, exactly that many
 * pairs. A pair contains two 33-byte operands. Tag 0 is a canonical Fr
 * literal in 32-byte big-endian form. Tag 1 is a u16 big-endian index
 * strictly below the current pair index, followed by 30 zero bytes.
 * Output: exactly one canonical 32-byte big-endian word per operation.
 *
 * The caller owns readable input and writable output for this call. Input
 * must remain unchanged, and the ranges must not overlap. On false, the
 * caller's output is unchanged. The batch is public arithmetic only.
 */
bool mimc_batch_execute(const uint8_t *input, size_t input_size,
                        uint8_t *output, size_t output_size);

#endif
