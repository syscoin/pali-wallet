#include "mimc_batch.h"

#include <string.h>

#if defined(PALI_MIMC_TEST_WORD_SIZE) && !defined(PALI_MIMC_TESTING)
#error The limb override is restricted to the standalone arithmetic test
#endif
#if defined(PALI_MIMC_TEST_WORD_SIZE)
#define PALI_MIMC_WORD_SIZE PALI_MIMC_TEST_WORD_SIZE
#elif UINTPTR_MAX == UINT64_MAX
#define PALI_MIMC_WORD_SIZE 64
#elif UINTPTR_MAX == UINT32_MAX
#define PALI_MIMC_WORD_SIZE 32
#else
#error Unsupported target pointer width
#endif

#if PALI_MIMC_WORD_SIZE == 64 && defined(__SIZEOF_INT128__)
#include "fiat_bn254_scalar_64.inc"
#elif PALI_MIMC_WORD_SIZE == 32
#include "fiat_bn254_scalar_32.inc"
#else
#error Unsupported target for the generated public MiMC field arithmetic
#endif
#include "mimc_round_constants.inc"
#include "mimc_pair.inc"

enum { OPERAND_LITERAL = 0, OPERAND_REFERENCE = 1 };

static size_t read_u16_be(const uint8_t *input) {
    return ((size_t)input[0] << 8) | input[1];
}

static bool overlaps(const uint8_t *input, size_t input_size,
                     const uint8_t *output, size_t output_size) {
    const uintptr_t left = (uintptr_t)input;
    const uintptr_t right = (uintptr_t)output;
    return left <= right ? right - left < input_size : left - right < output_size;
}

static bool valid_operand(const uint8_t *operand, size_t position) {
    const uint8_t *word = operand + 1;
    if (operand[0] == OPERAND_LITERAL) {
        return memcmp(word, FIELD_MODULUS_BE, MIMC_BATCH_WORD_BYTES) < 0;
    }
    if (operand[0] != OPERAND_REFERENCE || read_u16_be(word) >= position) {
        return false;
    }
    static const uint8_t zero_padding[MIMC_BATCH_WORD_BYTES - 2] = {0};
    return memcmp(word + 2, zero_padding, sizeof(zero_padding)) == 0;
}

static const uint8_t *resolve_operand(const uint8_t *operand, const Word *results) {
    return operand[0] == OPERAND_LITERAL ? operand + 1 : results[read_u16_be(operand + 1)];
}

bool mimc_batch_execute(const uint8_t *input, size_t input_size,
                        uint8_t *output, size_t output_size) {
    if (!input || !output ||
        input_size < MIMC_BATCH_HEADER_BYTES || input_size > MIMC_BATCH_MAX_INPUT ||
        !output_size || output_size > MIMC_BATCH_MAX_OUTPUT ||
        input[0] != MIMC_BATCH_VERSION) return false;

    const size_t count = read_u16_be(input + 1);
    if (!count || count > MIMC_BATCH_MAX_OPERATIONS ||
        input_size != MIMC_BATCH_HEADER_BYTES + count * MIMC_BATCH_OPERATION_BYTES ||
        output_size != count * MIMC_BATCH_WORD_BYTES ||
        overlaps(input, input_size, output, output_size)) return false;

    // Validate the whole program before hashing anything. Backwards-only
    // references make cycles and reads of uninitialized results impossible.
    const uint8_t *operations = input + MIMC_BATCH_HEADER_BYTES;
    for (size_t position = 0; position < count; position++) {
        const uint8_t *operation = operations + position * MIMC_BATCH_OPERATION_BYTES;
        if (!valid_operand(operation, position) ||
            !valid_operand(operation + MIMC_BATCH_OPERAND_BYTES, position)) return false;
    }

    Field rounds[220];
    for (size_t round = 0; round < 220; round++) {
        decode_le(rounds[round], ROUND_CONSTANTS_LE[round]);
    }

    // Keep results private until every operation has succeeded. The fixed
    // allocation is bounded independently of any caller-supplied count.
    Word results[MIMC_BATCH_MAX_OPERATIONS];
    for (size_t position = 0; position < count; position++) {
        const uint8_t *operation = operations + position * MIMC_BATCH_OPERATION_BYTES;
        if (!pair(results[position],
                  resolve_operand(operation, results),
                  resolve_operand(operation + MIMC_BATCH_OPERAND_BYTES, results),
                  rounds)) return false;
    }
    memcpy(output, results, output_size);
    return true;
}
