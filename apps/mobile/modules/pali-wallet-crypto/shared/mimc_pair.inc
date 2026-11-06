typedef uint8_t Word[32];
typedef fiat_bn254_scalar_montgomery_domain_field_element Field;

static void reverse_word(Word result, const Word source) {
    for (size_t i = 0; i < sizeof(Word); i++) result[i] = source[31 - i];
}

static void decode_le(Field result, const Word bytes) {
    fiat_bn254_scalar_non_montgomery_domain_field_element normal;
    fiat_bn254_scalar_from_bytes(normal, bytes);
    fiat_bn254_scalar_to_montgomery(result, normal);
}

static void encode_be(Word result, const Field value) {
    fiat_bn254_scalar_non_montgomery_domain_field_element normal;
    Word little_endian;
    fiat_bn254_scalar_from_montgomery(normal, value);
    fiat_bn254_scalar_to_bytes(little_endian, normal);
    reverse_word(result, little_endian);
}

static void permute(Field left, Field right, const Field rounds[220]) {
    for (size_t round = 0; round < 220; round++) {
        Field shifted, square, fourth, fifth, next;
        fiat_bn254_scalar_add(shifted, left, rounds[round]);
        fiat_bn254_scalar_square(square, shifted);
        fiat_bn254_scalar_square(fourth, square);
        fiat_bn254_scalar_mul(fifth, fourth, shifted);
        fiat_bn254_scalar_add(next, right, fifth);
        if (round == 219) {
            memcpy(right, next, sizeof(Field));
        } else {
            memcpy(right, left, sizeof(Field));
            memcpy(left, next, sizeof(Field));
        }
    }
}

static bool pair(Word result, const Word first, const Word second, const Field rounds[220]) {
    if (memcmp(first, FIELD_MODULUS_BE, sizeof(Word)) >= 0 ||
        memcmp(second, FIELD_MODULUS_BE, sizeof(Word)) >= 0) return false;

    Word first_le, second_le;
    reverse_word(first_le, first);
    reverse_word(second_le, second);
    Field rate, capacity = {0}, absorbed, next;
    decode_le(rate, first_le);
    decode_le(absorbed, second_le);
    permute(rate, capacity, rounds);
    fiat_bn254_scalar_add(next, rate, absorbed);
    permute(next, capacity, rounds);
    encode_be(result, next);
    return true;
}

