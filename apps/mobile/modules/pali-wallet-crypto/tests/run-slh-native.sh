#!/bin/sh
set -eu
test_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
source_dir=$(dirname -- "$test_dir")/shared/slh
scratch=$(mktemp -d "${TMPDIR:-/tmp}/pali-slh-guards.XXXXXXXX")
compiler=${CC:-clang}
printf 'Bounded SLH guard artifacts: %s\n' "$scratch"
"$compiler" -std=c11 -Wall -Wextra -Werror -pedantic -O1 -g \
  -fsanitize=address,undefined -fno-sanitize-recover=all -pthread \
  -I"$source_dir" "$source_dir/pali_slh_native.c" \
  "$source_dir/strict_rng.c" "$source_dir/pali_slh_secure_clear.c" \
  "$test_dir/slh-native-guards.c" -o "$scratch/guards"
"$scratch/guards"
"$compiler" -std=c11 -Wall -Wextra -Werror -pedantic -O1 -g \
  -fsanitize=address,undefined -fno-sanitize-recover=all -pthread \
  -I"$source_dir" "$source_dir/pali_slh_native.c" \
  "$source_dir/strict_rng.c" "$source_dir/pali_slh_secure_clear.c" \
  "$source_dir/slhdsa_emscripten_wrapper.c" \
  "$source_dir/address.c" "$source_dir/fors.c" "$source_dir/hash_sha2.c" \
  "$source_dir/merkle.c" "$source_dir/sha2.c" "$source_dir/sign.c" \
  "$source_dir/utils.c" "$source_dir/utilsx1.c" "$source_dir/wots.c" \
  "$source_dir/wotsx1.c" "$source_dir/thash_sha2_simple.c" \
  "$test_dir/slh-native-control.c" -o "$scratch/control"
"$scratch/control"
for override in SPX_FULL_HEIGHT=21 SPX_FORS_HEIGHT=23; do
  if "$compiler" -std=c11 -D"$override" -I"$source_dir" \
      -c "$source_dir/pali_slh_native.c" -o "$scratch/forbidden.o" \
      > "$scratch/forbidden.log" 2>&1; then
    echo "Changed SLH parameters crossed the pinned native ABI" >&2
    exit 1
  fi
  grep -F 'Only the pinned full SHA2-128-24 parameters are admitted' "$scratch/forbidden.log" > /dev/null
done
printf 'Changed-profile compile refusals passed\n'
