#!/bin/sh
set -eu
test_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
source_dir=$(dirname -- "$test_dir")/shared/slh
scratch=$(mktemp -d "${TMPDIR:-/tmp}/pali-slh-sha256.XXXXXXXX")
compiler=${CC:-clang}
full_equivalence=${PALI_SLH_FULL_EQUIVALENCE:-0}
case "$full_equivalence" in 0|1) ;; *) echo 'Full SLH equivalence must be explicitly 0 or 1' >&2; exit 1 ;; esac
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
if [ "$full_equivalence" = 1 ]; then
  # Separate public host KAT only. The Android custody/restart fixture retains
  # real OS randomness and its existing wallet key, state and cache identities.
  python3 - "$test_dir" "$source_dir" "$scratch" <<'PY'
import hashlib, json, os, pathlib, sys
tests, source, scratch = map(pathlib.Path, sys.argv[1:])
def digest(data):
    return hashlib.sha256(data).hexdigest()
def pinned(file, expected):
    data = file.read_bytes()
    if digest(data) != expected:
        raise SystemExit('Full SLH oracle pin changed: ' + str(file))
    return data
fixture = pinned(tests / 'fixtures/slh_dsa_sha2_128_24_sp800_230_ipd_counter0.json',
    '133fe2a7f6a4218286ac501da8c2b875423510d7717606bba948ffc9219a2272')
assets = tests.parents[4] / 'source/assets/slh-dsa'
pins = {
    assets / 'slhdsa-sha2-128-24.js': '1a820c2db7f7fdafcfebada35803dc6ffe77a987f877b4a148f0900cd483743d',
    assets / 'slhdsa-sha2-128-24.wasm': 'abe90468c37702811ced74ec6e785d4faae38676f7f7c7f95ab6ddb3d04adef5',
    source / 'source-manifest.json': '3922e7b73cc95353aace974a15598e8bb5d22af6004f525f1a21592c5ab52e16',
    source / 'params.h': '35e262c1f61043e65a6376ac5e34635bc98a9a30413335e137b7138f8f9c3f9c',
    source / 'slhdsa_emscripten_wrapper.c': '06f0b89b160a2ded31095f8eec870cc1ca2a130473354d96fee836d58578071c',
}
for file, expected in pins.items():
    pinned(file, expected)
vector = json.loads(fixture)
def unhex(value):
    return bytes.fromhex(value.removeprefix('0x'))
inputs = vector['inputs']
signature = unhex(vector['signature'])
packed = b''.join([unhex(inputs['skSeed']), unhex(inputs['skPrf']),
    unhex(inputs['pkSeed']), unhex(vector['pkRoot'])[:16],
    unhex(vector['message']), unhex(inputs['optRand']), signature])
if len(packed) != 3968 or digest(packed) != '0b950412cc54c46048a9905d77dfc7191c6ac14938378f5dfbc84610c17eca20':
    raise SystemExit('Full SLH packed public input changed')
if digest(signature) != '4120ddc01b07ed53ce966bcca6b7e2c7c95144df39c969b1d3b25ad59caa0d88':
    raise SystemExit('Full SLH expected signature changed')
(scratch / 'full-fixture.bin').write_bytes(packed)
(scratch / 'full-provenance.json').write_text(json.dumps({
    'version': 1, 'sourceRevision': os.environ.get('GITHUB_SHA'),
    'fixtureId': vector['id'], 'fixtureSha256': digest(fixture),
    'packedInputSha256': digest(packed), 'expectedSignatureSha256': digest(signature),
    'oraclePins': {file.name: value for file, value in pins.items()},
    'nativeSourcesSha256': {file.name: digest(file.read_bytes()) for file in sorted(source.iterdir())
        if file.suffix in ('.c', '.h')},
    'testSourceSha256': digest((tests / 'slh-full-equivalence.c').read_bytes()),
    'opensslArchiveSha256': '5d50f86e0238df4cb626b75d968a1746eaf72782652babd6b3693e20d9650ac7',
    'scope': 'macOS host public KAT only; one full XMSS tree, cached and six-FORS signatures; no mobile device or custody claim',
    'timingScope': 'CLOCK_MONOTONIC; tree excludes allocation; sign APIs include internal native verification; no scalar timing comparison',
}, indent=2) + '\n')
PY
  "$compiler" --version > "$scratch/full-compiler.txt"
  # Component sanitizer checks above remain bounded. This opt-in full-profile
  # execution uses the native backend only, with no scalar full-tree rerun.
  "$compiler" -std=c11 -Wall -Wextra -Werror -pedantic -O2 -pthread \
    -DPALI_SLH_OPENSSL_SHA256=1 -I"$source_dir" \
    -I"$PALI_SLH_OPENSSL_ROOT" -I"$PALI_SLH_OPENSSL_ROOT/include" \
    "$test_dir/slh-full-equivalence.c" "$source_dir/sha2.c" "$@" \
    "$source_dir/pali_slh_sha256_openssl.c" "$library" -o "$scratch/full-equivalence"
  if ! "$scratch/full-equivalence" "$scratch/full-fixture.bin" \
      "$scratch/full-generated.bin" "$scratch/full-timings.json" \
      > "$scratch/full-equivalence.log" 2>&1; then
    cat "$scratch/full-equivalence.log"
    exit 1
  fi
  cat "$scratch/full-equivalence.log"
  python3 - "$scratch" <<'PY'
import hashlib, json, math, pathlib, sys
scratch = pathlib.Path(sys.argv[1])
fixture = (scratch / 'full-fixture.bin').read_bytes()
generated = (scratch / 'full-generated.bin').read_bytes()
expected = fixture[32:64] + fixture[112:] + fixture[112:]
if generated != expected:
    raise SystemExit('Full native public key or signature bytes differ from the canonical oracle')
timings = json.loads((scratch / 'full-timings.json').read_text())
if set(timings) != {'xmssTreeMs', 'cachedSignMs', 'shardedSignMs'} or any(
    type(value) not in (int, float) or not math.isfinite(value) or value < 0 for value in timings.values()):
    raise SystemExit('Full SLH monotonic timing evidence invalid')
report = json.loads((scratch / 'full-provenance.json').read_text())
report.update(result='passed', publicKeyBytes=32, signatureBytes=3856,
    xmssLeaves=4194304, forsTreesPerSignature=6, cachedExact=True, shardedExact=True,
    publicKeySha256=hashlib.sha256(generated[:32]).hexdigest(),
    generatedSha256=hashlib.sha256(generated).hexdigest(), timings=timings,
    compiler=(scratch / 'full-compiler.txt').read_text().strip(),
    compileFlags='-std=c11 -Wall -Wextra -Werror -pedantic -O2 -pthread -DPALI_SLH_OPENSSL_SHA256=1')
(scratch / 'full-equivalence.json').write_text(json.dumps(report, indent=2) + '\n')
PY
else
  printf 'Full-profile signature equivalence was not requested.\n'
fi
printf 'Artifacts: %s\nHost evidence does not qualify mobile device performance.\n' "$scratch"
