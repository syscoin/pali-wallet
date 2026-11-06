#include "mimc_batch.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void require(bool passed, const char *test) {
    if (passed) return;
    fprintf(stderr, "failed: %s\n", test);
    exit(1);
}

static size_t rejected = 0;

static void reject(const char *test, const uint8_t *program, size_t input_size,
                   size_t output_size) {
    uint8_t output[MIMC_BATCH_MAX_OUTPUT + 1];
    uint8_t expected[sizeof(output)];
    memset(expected, 0xa5, sizeof(expected));
    memcpy(output, expected, sizeof(output));
    require(!mimc_batch_execute(program, input_size, output, output_size), test);
    require(memcmp(output, expected, sizeof(output)) == 0, "rejected output untouched");
    rejected++;
}

static void write_u16_be(uint8_t *bytes, uint16_t value) {
    bytes[0] = (uint8_t)(value >> 8);
    bytes[1] = (uint8_t)value;
}

static size_t read_u16_be(const uint8_t *bytes) {
    return ((size_t)bytes[0] << 8) | bytes[1];
}

enum {
    TWO_OPERATION_INPUT = MIMC_BATCH_HEADER_BYTES + 2 * MIMC_BATCH_OPERATION_BYTES,
    TWO_OPERATION_OUTPUT = 2 * MIMC_BATCH_WORD_BYTES,
};

static void rejection_cases(void) {
    uint8_t program[TWO_OPERATION_INPUT + 1] = { MIMC_BATCH_VERSION, 0, 2 };
    uint8_t *const first = program + MIMC_BATCH_HEADER_BYTES;
    uint8_t *const second = first + MIMC_BATCH_OPERATION_BYTES;
    uint8_t *const second_right = second + MIMC_BATCH_OPERAND_BYTES;
    second[0] = 1;
    second_right[0] = 1;
    uint8_t good[TWO_OPERATION_OUTPUT];
    require(mimc_batch_execute(program, TWO_OPERATION_INPUT, good, sizeof(good)),
            "valid two-op negative-control template");
    require(!mimc_batch_execute(program, TWO_OPERATION_INPUT, NULL, sizeof(good)), "null output");
    rejected++;

    reject("null input", NULL, TWO_OPERATION_INPUT, sizeof(good));
    for (size_t size = 0; size < TWO_OPERATION_INPUT; size++) {
        reject("truncated at each input offset", program, size, sizeof(good));
    }
    reject("trailing input byte", program, TWO_OPERATION_INPUT + 1, sizeof(good));
    reject("oversize input", program, SIZE_MAX, sizeof(good));
    reject("zero output", program, TWO_OPERATION_INPUT, 0);
    reject("short output", program, TWO_OPERATION_INPUT, sizeof(good) - 1);
    reject("long output", program, TWO_OPERATION_INPUT, sizeof(good) + 1);
    reject("oversize output", program, TWO_OPERATION_INPUT, SIZE_MAX);

    program[0] = 0;
    reject("unknown wire version", program, TWO_OPERATION_INPUT, sizeof(good));
    program[0] = MIMC_BATCH_VERSION;
    write_u16_be(program + 1, 0);
    reject("zero operation count", program, TWO_OPERATION_INPUT, sizeof(good));
    write_u16_be(program + 1, MIMC_BATCH_MAX_OPERATIONS + 1);
    reject("excess operation count", program, TWO_OPERATION_INPUT, sizeof(good));
    write_u16_be(program + 1, 1);
    reject("operation count mismatches byte lengths", program, TWO_OPERATION_INPUT, sizeof(good));
    write_u16_be(program + 1, 2);

    first[0] = 1;
    reject("reference from first operation", program, TWO_OPERATION_INPUT, sizeof(good));
    first[2] = 1;
    reject("forward edge in two-operation cycle", program, TWO_OPERATION_INPUT, sizeof(good));
    first[0] = 0;
    first[2] = 0;
    second_right[2] = 1;
    reject("self reference after valid first pair", program, TWO_OPERATION_INPUT, sizeof(good));
    write_u16_be(second_right + 1, UINT16_MAX);
    reject("out-of-range reference", program, TWO_OPERATION_INPUT, sizeof(good));
    write_u16_be(second_right + 1, 0);
    for (size_t padding = 3; padding < MIMC_BATCH_OPERAND_BYTES; padding++) {
        second_right[padding] = 1;
        reject("each nonzero reserved byte", program, TWO_OPERATION_INPUT, sizeof(good));
        second_right[padding] = 0;
    }
    second_right[0] = 255;
    reject("unrecognized operand tag at tail", program, TWO_OPERATION_INPUT, sizeof(good));

    static const uint8_t modulus[MIMC_BATCH_WORD_BYTES] = {
        0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29,
        0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
        0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91,
        0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
    };
    second_right[0] = 0;
    memcpy(second_right + 1, modulus, sizeof(modulus));
    reject("literal equals modulus at tail", program, TWO_OPERATION_INPUT, sizeof(good));
    memset(second_right + 1, 0xff, MIMC_BATCH_WORD_BYTES);
    reject("literal above modulus at tail", program, TWO_OPERATION_INPUT, sizeof(good));
    memset(second_right + 1, 0, MIMC_BATCH_WORD_BYTES);
    second_right[0] = 1;
    require(mimc_batch_execute(program, TWO_OPERATION_INPUT, good, sizeof(good)),
            "negative controls restore original valid template");

    uint8_t joined[TWO_OPERATION_INPUT + TWO_OPERATION_OUTPUT];
    uint8_t before[sizeof(joined)];
    memset(joined, 0x5a, sizeof(joined));
    memcpy(joined + 1, program, TWO_OPERATION_INPUT);
    memcpy(before, joined, sizeof(before));
    const size_t offsets[] = {0, 1, 2, TWO_OPERATION_INPUT};
    for (size_t i = 0; i < sizeof(offsets) / sizeof(offsets[0]); i++) {
        require(!mimc_batch_execute(joined + 1, TWO_OPERATION_INPUT,
                                    joined + offsets[i], sizeof(good)), "overlapping ranges");
        require(memcmp(joined, before, sizeof(joined)) == 0, "alias output untouched");
        rejected++;
    }
    memcpy(joined, program, TWO_OPERATION_INPUT);
    require(mimc_batch_execute(joined, TWO_OPERATION_INPUT, joined + TWO_OPERATION_INPUT,
                               sizeof(good)), "adjacent output after input");
    require(memcmp(joined + TWO_OPERATION_INPUT, good, sizeof(good)) == 0, "adjacent result");
    memcpy(joined + sizeof(good), program, TWO_OPERATION_INPUT);
    require(mimc_batch_execute(joined + sizeof(good), TWO_OPERATION_INPUT, joined,
                               sizeof(good)), "adjacent output before input");
    require(memcmp(joined, good, sizeof(good)) == 0, "adjacent result");
}

static void differential(FILE *fixtures) {
    size_t program_count = 0;
    size_t result_count = 0;
    uint8_t sizes[4];
    for (;;) {
        const size_t read = fread(sizes, 1, sizeof(sizes), fixtures);
        if (read == 0 && feof(fixtures)) break;
        require(read == sizeof(sizes), "fixture header");
        const size_t input_size = read_u16_be(sizes);
        const size_t output_size = read_u16_be(sizes + 2);
        uint8_t input[MIMC_BATCH_MAX_INPUT];
        uint8_t original[sizeof(input)];
        uint8_t expected[MIMC_BATCH_MAX_OUTPUT];
        uint8_t actual[sizeof(expected) + 2];
        require(input_size <= sizeof(input) && output_size <= sizeof(expected), "fixture sizes");
        require(fread(input, 1, input_size, fixtures) == input_size, "fixture program");
        require(fread(expected, 1, output_size, fixtures) == output_size, "fixture results");
        memcpy(original, input, input_size);
        memset(actual, 0x5a, sizeof(actual));
        require(mimc_batch_execute(input, input_size, actual + 1, output_size), "valid program");
        require(memcmp(actual + 1, expected, output_size) == 0, "all shared outputs match");
        require(actual[0] == 0x5a && actual[1 + output_size] == 0x5a, "successful exact output range");
        require(memcmp(input, original, input_size) == 0, "input unchanged");
        program_count++;
        result_count += output_size / MIMC_BATCH_WORD_BYTES;
    }
    require(program_count == 7 && result_count == 850, "all differential fixtures exercised");
    printf("shared differential: %zu programs, %zu exact outputs\n", program_count, result_count);
}

int main(int argc, char **argv) {
    require(argc == 2, "provide the differential fixture file");
    FILE *fixtures = fopen(argv[1], "rb");
    require(fixtures != NULL, "open differential fixture");
    differential(fixtures);
    require(fclose(fixtures) == 0, "close differential fixture");
    rejection_cases();
    printf("atomic rejection: %zu checks\n", rejected);
    return 0;
}
