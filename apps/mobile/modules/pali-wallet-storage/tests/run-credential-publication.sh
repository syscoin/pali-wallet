#!/bin/sh
set -eu
test_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
scratch=$(mktemp -d "${TMPDIR:-/tmp}/pali-credential-publication-test.XXXXXX")
trap 'rm -rf "$scratch"' EXIT HUP INT TERM
"${CC:-cc}" -std=c11 -Wall -Wextra -Werror -O1 -g \
  -fsanitize=address,undefined -fno-sanitize-recover=all \
  "$test_dir/credential-publication.c" \
  "$test_dir/../android/src/main/cpp/PaliCredentialPublication.c" \
  -o "$scratch/credential-publication"
"$scratch/credential-publication"
