/* global __dirname */
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdtempSync, rmSync, truncateSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { test } = require('node:test');
const { Script } = require('node:vm');
const { ETH1_SCALE, readEth1ScaleSnapshot, readEth1ScaleTranscript, referencePaths } = require('../eth1-scale-input.cjs');
const { APP, buildOverlay } = require('../prepare-eth1-release-scale.cjs');
const { PUBLIC_POOL_ANCHOR_READS, PUBLIC_POOL_LEAVES, PUBLIC_POOL_ROOT,
  PUBLIC_POOL_PATH_DIGESTS } = require('../public-pool-contract.ts');

const word = (value) => '0x' + BigInt(value).toString(16).padStart(64, '0');
const exampleTime = Date.parse('2026-11-06T03:10:00Z');

// Synthetic transcript used only to test admission shape. It is not an anchor capture.
function sample() {
  const block = { number: '0x' + ETH1_SCALE.block.toString(16), hash: ETH1_SCALE.blockHash,
    timestamp: '0x' + (exampleTime / 1000).toString(16) };
  const results = ['0x1', block, word(ETH1_SCALE.leaves), ETH1_SCALE.root, word(20),
    word(10n ** 18n), block, word(1)];
  return { version: 1, passes: [0, 8].map((base) => PUBLIC_POOL_ANCHOR_READS.map((read, index) => ({
    jsonrpc: '2.0', id: base + index + 1, read, result: structuredClone(results[index]),
  }))) };
}

test('scale input requires two exact public anchor passes with independent request IDs', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'pali-eth1-scale-input-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'transcript.json');
  const load = (value) => {
    const json = JSON.stringify(value);
    writeFileSync(path, json);
    return readEth1ScaleTranscript(path);
  };
  assert.throws(() => readEth1ScaleTranscript(path), /ETH1_SCALE_TRANSCRIPT_INVALID/);
  const accepted = load(sample());
  assert.equal(accepted.blockTimestampMs, exampleTime);
  assert.equal(accepted.passes.flat().length, 16);
  assert.equal(accepted.sha256, createHash('sha256').update(JSON.stringify(sample())).digest('hex'));

  for (const change of [
    (value) => value.passes.pop(),
    (value) => { value.passes[1][0].id = 1; },
    (value) => { value.passes[0][1].result.timestamp = '0x1'; },
    (value) => { value.passes[0][3].result = word(1); },
    (value) => { value.passes[1][7].result = word(0); },
    (value) => { value.passes[0][0].headers = {}; },
  ]) {
    const value = sample();
    change(value);
    assert.throws(() => load(value), /ETH1_SCALE_TRANSCRIPT_INVALID/);
  }
  writeFileSync(path, ' '.repeat(8193));
  assert.throws(() => readEth1ScaleTranscript(path), /ETH1_SCALE_TRANSCRIPT_INVALID/);
  await assert.rejects(readEth1ScaleSnapshot(path), /ETH1_SCALE_SNAPSHOT_INVALID/);
  truncateSync(path, ETH1_SCALE.bytes);
  await assert.rejects(readEth1ScaleSnapshot(path), /ETH1_SCALE_SNAPSHOT_INVALID/);
});

test('the independent bottom-up reference agrees with the existing small smoke root and endpoint paths', () => {
  const leaves = Array.from({ length: PUBLIC_POOL_LEAVES }, (_, index) => word(index + 1));
  const proof = referencePaths(leaves);
  assert.equal(proof.root, PUBLIC_POOL_ROOT);
  assert.deepEqual(proof.pathDigests, PUBLIC_POOL_PATH_DIGESTS);
});

test('the source-pinned projection keeps the scale budget and clock inside the detached loopback adapter', () => {
  const root = resolve(__dirname, '../../../..');
  const projected = buildOverlay(root, { blockTimestampMs: exampleTime });
  assert.equal(projected.size, 9);
  for (const [name, source] of projected) {
    if (name.endsWith('.cjs')) assert.doesNotThrow(() => new Script(source, { filename: name }));
  }
  const sync = projected.get('src/privacy/nativePrivacyPoolSync.ts');
  assert.match(sync, /MAX_RESPONSE_BYTES = 16 \* 1024 \* 1024/);
  assert.match(sync, /MAX_RUN_BYTES = 13113982 \+ 4 \* 1024 \* 1024/);
  assert.match(sync, /MAX_PULL_BYTES = 64 \* 1024/);
  assert.match(sync, /RUN_TIMEOUT_MS = 45_000/);
  assert.match(sync, /BATCH_LEAVES = 128/);
  assert.match(sync, /new URL\(rpcUrl\)\.hostname !== '127\.0\.0\.1'/);
  assert.ok(sync.includes(`now: () => ${exampleTime + 1000} + Math.floor(performance.now() - replayStart)`));
  const configure = projected.get('scripts/configure-native-qualification.cjs');
  assert.ok(configure.includes(`identifier: '${APP}'`));
  assert.match(configure, /if \(!publicPoolEnabled\) throw Error\('ETH1_SCALE_REQUIRES_ISOLATED_PUBLIC_POOL_BUILD'\)/);
  for (const file of ['qualification/launch-parameters.ts', 'qualification/withHttpFixture.cjs']) {
    const source = projected.get(file);
    assert.ok(source.includes(APP));
    assert.doesNotMatch(source, /com\.paliwallet\.qualification'/);
  }
  const runner = projected.get('qualification/run-public-pool-fixture.cjs');
  assert.match(runner, /transcript\.sha256 !== scale\.transcriptSha256/);
  assert.match(runner, /build\.sourceRevision !== revision/);
  assert.match(runner, /scope: 'offline-eth1-release-scale'/);
  const server = projected.get('qualification/public-pool-server.cjs');
  assert.match(server, /const results = anchorPasses\.flat\(\)/);
  assert.doesNotMatch(server, /Date\.now|Array\.from/);
});
