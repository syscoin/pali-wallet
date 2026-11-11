#!/usr/bin/env python3
"""Pinned public FORS KAT on a macOS host; no full mobile build or XMSS setup."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

tests = Path(__file__).resolve().parent
source = tests.parent / 'shared/slh'
openssl = Path(os.environ['PALI_SLH_OPENSSL_ROOT'])
archive = openssl / 'QuickCryptoOpenSSL.xcframework/macos-arm64_x86_64/libQuickCryptoOpenSSL.a'
assert hashlib.sha256(archive.read_bytes()).hexdigest() == '5d50f86e0238df4cb626b75d968a1746eaf72782652babd6b3693e20d9650ac7'
fixture_file = tests / 'fixtures/slh_dsa_sha2_128_24_sp800_230_ipd_counter0.json'
assert hashlib.sha256(fixture_file.read_bytes()).hexdigest() == '133fe2a7f6a4218286ac501da8c2b875423510d7717606bba948ffc9219a2272'
fixture = json.loads(fixture_file.read_text())
unhex = lambda value: bytes.fromhex(value.removeprefix('0x'))
packed = b''.join(unhex(value) for value in [fixture['inputs']['skSeed'], fixture['inputs']['skPrf'], fixture['inputs']['pkSeed'], fixture['pkRoot'][:34], fixture['inputs']['message'], fixture['inputs']['optRand'], fixture['signature']])
assert len(packed) == 3968 and hashlib.sha256(packed).hexdigest() == '0b950412cc54c46048a9905d77dfc7191c6ac14938378f5dfbc84610c17eca20'
scratch = Path(tempfile.mkdtemp(prefix='pali-slh-fors-concurrency-'))
(scratch / 'fixture.bin').write_bytes(packed)
names = 'pali_slh_native strict_rng pali_slh_secure_clear slhdsa_emscripten_wrapper address fors hash_sha2 merkle sha2 sign utils utilsx1 wots wotsx1 thash_sha2_simple pali_slh_sha256_openssl'.split()
command = [os.environ.get('CC', 'clang'), '-std=c11', '-Wall', '-Wextra', '-Werror', '-pedantic', '-O2', '-pthread', '-DPALI_SLH_OPENSSL_SHA256=1', '-I' + str(source), '-I' + str(openssl), '-I' + str(openssl / 'include'), *[str(source / (name + '.c')) for name in names], str(tests / 'slh-fors-concurrency.c'), str(archive), '-o', str(scratch / 'fors')]
subprocess.run(command, check=True, timeout=60)
result = subprocess.run([str(scratch / 'fors'), str(scratch / 'fixture.bin')], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=300)
(scratch / 'result.log').write_text(result.stdout)
print(result.stdout, end='')
print('Artifacts:', scratch)
raise SystemExit(result.returncode)
