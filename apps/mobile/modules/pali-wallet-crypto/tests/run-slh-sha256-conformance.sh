#!/bin/sh
set -eu
test_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
source_dir=$(dirname -- "$test_dir")/shared/slh
scratch=$(mktemp -d "${TMPDIR:-/tmp}/pali-slh-sha256.XXXXXXXX")
compiler=${CC:-clang}
: "${PALI_SLH_OPENSSL_ROOT:?Use the verified QuickCrypto OpenSSL 3.6.2 artifact directory}"
if [ "$(uname -s)" != Darwin ]; then
  echo 'This focused runner requires the pinned macOS host archive, not an Android/iOS build.' >&2
  exit 1
fi
library="$PALI_SLH_OPENSSL_ROOT/QuickCryptoOpenSSL.xcframework/macos-arm64_x86_64/libQuickCryptoOpenSSL.a"
python3 - "$PALI_SLH_OPENSSL_ROOT" "$library" "$scratch" <<'PY'
import hashlib, pathlib, re, sys
root, library, scratch = map(pathlib.Path, sys.argv[1:])
expected = '5d50f86e0238df4cb626b75d968a1746eaf72782652babd6b3693e20d9650ac7'
if hashlib.sha256(library.read_bytes()).hexdigest() != expected:
    raise SystemExit('Pinned QuickCrypto host archive changed')
prefix = (root / 'quickcrypto_openssl_prefix.h').read_text()
if '#define SHA256_Transform rnqc_SHA256_Transform' not in prefix:
    raise SystemExit('Actual QuickCrypto SHA256 prefix is required')
version, changed = re.subn(
    r'(?m)^(#[ \t]*define[ \t]+OPENSSL_VERSION_PATCH[ \t]+)2[ \t]*$',
    r'\g<1>3', (root / 'include/openssl/opensslv.h').read_text(), count=1)
if changed != 1:
    raise SystemExit('Pinned OpenSSL version fixture changed')
wrong = scratch / 'wrong-version/openssl/opensslv.h'
wrong.parent.mkdir(parents=True)
wrong.write_text(version)
PY
sources="address.c fors.c hash_sha2.c merkle.c sign.c utils.c utilsx1.c wots.c wotsx1.c thash_sha2_simple.c slhdsa_emscripten_wrapper.c pali_slh_native.c strict_rng.c pali_slh_secure_clear.c"
set --
for name in $sources; do set -- "$@" "$source_dir/$name"; done
for mode in reference openssl; do
  if [ "$mode" = openssl ]; then
    "$compiler" -std=c11 -Wall -Wextra -Werror -pedantic -O1 -g \
      -fsanitize=address,undefined -fno-sanitize-recover=all -pthread \
      -DPALI_SLH_OPENSSL_SHA256=1 -I"$source_dir" \
      -I"$PALI_SLH_OPENSSL_ROOT" -I"$PALI_SLH_OPENSSL_ROOT/include" \
      "$test_dir/slh-sha256-conformance.c" "$@" \
      "$source_dir/pali_slh_sha256_openssl.c" "$library" -o "$scratch/$mode"
  else
    "$compiler" -std=c11 -Wall -Wextra -Werror -pedantic -O1 -g \
      -fsanitize=address,undefined -fno-sanitize-recover=all -pthread \
      -I"$source_dir" "$test_dir/slh-sha256-conformance.c" "$@" -o "$scratch/$mode"
  fi
  "$scratch/$mode" > "$scratch/$mode.txt"
done
cmp "$scratch/reference.txt" "$scratch/openssl.txt"
if "$compiler" -std=c11 -DPALI_SLH_OPENSSL_SHA256=0 -I"$source_dir" \
    -I"$PALI_SLH_OPENSSL_ROOT" -I"$PALI_SLH_OPENSSL_ROOT/include" \
    -fsyntax-only "$source_dir/pali_slh_sha256_openssl.c" > "$scratch/disabled.log" 2>&1; then
  echo 'Disabled native backend was accepted' >&2; exit 1
fi
grep -F 'must be explicitly enabled' "$scratch/disabled.log" > /dev/null
if "$compiler" -std=c11 -DPALI_SLH_OPENSSL_SHA256=1 -I"$source_dir" \
    -I"$PALI_SLH_OPENSSL_ROOT/include" -fsyntax-only \
    "$source_dir/pali_slh_sha256_openssl.c" > "$scratch/missing-prefix.log" 2>&1; then
  echo 'Unprefixed Apple backend was accepted' >&2; exit 1
fi
grep -F 'quickcrypto_openssl_prefix.h' "$scratch/missing-prefix.log" > /dev/null
if "$compiler" -std=c11 -DPALI_SLH_OPENSSL_SHA256=1 \
    -DOPENSSL_NO_DEPRECATED=1 -DOPENSSL_API_COMPAT=0x30000000L \
    -I"$source_dir" -I"$PALI_SLH_OPENSSL_ROOT" -I"$PALI_SLH_OPENSSL_ROOT/include" \
    -fsyntax-only "$source_dir/pali_slh_sha256_openssl.c" > "$scratch/unavailable-api.log" 2>&1; then
  echo 'Unavailable public compression API was accepted' >&2; exit 1
fi
grep -F 'public OpenSSL SHA256 compression API is unavailable' "$scratch/unavailable-api.log" > /dev/null
if "$compiler" -std=c11 -DPALI_SLH_OPENSSL_SHA256=1 -I"$scratch/wrong-version" \
    -I"$source_dir" -I"$PALI_SLH_OPENSSL_ROOT" -I"$PALI_SLH_OPENSSL_ROOT/include" \
    -fsyntax-only "$source_dir/pali_slh_sha256_openssl.c" > "$scratch/wrong-version.log" 2>&1; then
  echo 'Wrong OpenSSL version was accepted' >&2; exit 1
fi
grep -F 'Native SLH requires the pinned OpenSSL 3.6.2 headers' "$scratch/wrong-version.log" > /dev/null
printf 'Matched %s fixed public vectors; ASAN/UBSAN and compile refusals passed.\n' "$(wc -l < "$scratch/reference.txt" | tr -d ' ')"
printf 'Artifacts: %s\nNo full-profile signature, device qualification or performance claim.\n' "$scratch"
