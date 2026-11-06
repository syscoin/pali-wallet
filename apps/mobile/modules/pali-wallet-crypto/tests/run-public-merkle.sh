#!/bin/sh
set -eu

test_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
module_dir=$(dirname -- "$test_dir")
scratch=$(mktemp -d "${TMPDIR:-/tmp}/pali-public-merkle.XXXXXXXX")
compiler=${CC:-clang}
printf 'Public arithmetic test artifacts: %s\n' "$scratch"

node "$test_dir/public-merkle-vectors.mjs" "$scratch" > "$scratch/vectors.json"
for bits in 32 64; do
    "$compiler" -std=c11 -Wall -Wextra -Werror -pedantic -O1 -g \
        -fsanitize=address,undefined -fno-sanitize-recover=all \
        -DPALI_MIMC_TESTING=1 -DPALI_MIMC_TEST_WORD_SIZE="$bits" \
        -I"$module_dir/shared" "$module_dir/shared/mimc_batch.c" \
        "$test_dir/public-merkle-test.c" -o "$scratch/test-$bits"
    "$scratch/test-$bits" "$scratch/public-merkle-vectors.bin" > "$scratch/result-$bits.log"
    cat "$scratch/result-$bits.log"
done
if "$compiler" -std=c11 -DPALI_MIMC_TEST_WORD_SIZE=32 \
    -I"$module_dir/shared" -c "$module_dir/shared/mimc_batch.c" \
    -o "$scratch/forbidden.o" > "$scratch/forbidden.log" 2>&1; then
    echo "The test-only limb override compiled without its test guard" >&2
    exit 1
fi
grep -F 'The limb override is restricted' "$scratch/forbidden.log" > /dev/null
