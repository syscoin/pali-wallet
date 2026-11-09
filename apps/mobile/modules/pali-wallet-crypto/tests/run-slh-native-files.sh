#!/bin/sh
set -eu
test_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
scratch=$(mktemp -d "${TMPDIR:-/tmp}/pali-slh-file-guards.XXXXXXXX")
compiler=${CC:-clang}
: "${JAVA_HOME:?Point JAVA_HOME at the existing JDK for its JNI headers}"
case $(uname -s) in Darwin) jni_platform=darwin ;; Linux) jni_platform=linux ;; *) exit 1 ;; esac
"$compiler" -std=c11 -D_GNU_SOURCE -Wall -Wextra -Werror -Wno-unused-parameter -O1 -g \
  -fsanitize=address,undefined -fno-sanitize-recover=all \
  -I"$JAVA_HOME/include" -I"$JAVA_HOME/include/$jni_platform" \
  "$test_dir/slh-native-files.c" -o "$scratch/files"
"$scratch/files"
