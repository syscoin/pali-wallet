#!/bin/sh
set -eu
test_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
source_dir=$(dirname -- "$test_dir")/shared/slh
scratch=$(mktemp -d "${TMPDIR:-/tmp}/pali-slh-concurrency.XXXXXXXX")
compiler=${CC:-clang}
set --
for name in pali_slh_native.c strict_rng.c pali_slh_secure_clear.c slhdsa_emscripten_wrapper.c address.c fors.c hash_sha2.c merkle.c sha2.c sign.c utils.c utilsx1.c wots.c wotsx1.c thash_sha2_simple.c; do
  set -- "$@" "$source_dir/$name"
done
"$compiler" -std=c11 -Wall -Wextra -Werror -pedantic -O1 -g \
  -fsanitize=address,undefined -fno-sanitize-recover=all -pthread \
  -I"$source_dir" "$@" "$test_dir/slh-native-concurrency.c" -o "$scratch/concurrency"
"$scratch/concurrency"
printf 'Artifacts: %s\n' "$scratch"
