/* global __dirname */
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { ETH1_SCALE, readEth1ScaleSnapshot, readEth1ScaleTranscript, referencePaths } = require('./eth1-scale-input.cjs');

const BASE = '297418fc80cef5327ef2a85059d0186fc7863e79';
const APP = 'com.paliwallet.qualification.eth1scale';
const STAMP = 'qualification/eth1-release-scale-input.json';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function replaceOnce(text, before, after) {
  if (text.indexOf(before) < 0 || text.indexOf(before) !== text.lastIndexOf(before))
    throw Error('ETH1_SCALE_SOURCE_MISMATCH');
  return text.replace(before, () => after);
}

function buildOverlay(root, transcript) {
  const changed = new Map();
  const patch = (name, digest, substitutions) => {
    const file = readFileSync(join(root, 'apps/mobile', name));
    if (sha256(file) !== digest) throw Error('ETH1_SCALE_SOURCE_MISMATCH');
    changed.set(name, substitutions.reduce((text, [from, to]) =>
      replaceOnce(text, from, to), file.toString('utf8')));
  };
  patch('src/privacy/nativePrivacyPoolSync.ts', 'ef7e80e31a63af8e43d7593838ddaf7e9539518d7347f926780a486fb765ff5e', [
    ['const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;', 'const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;'],
    ['const MAX_RUN_BYTES = 4 * 1024 * 1024;', `const MAX_RUN_BYTES = ${ETH1_SCALE.bytes} + 4 * 1024 * 1024;`],
    ["  if (!rpcUrl.startsWith('https:')) throw unavailable();",
      "  if (poolId !== 'eth-1' || !/^http:\\/\\/127\\.0\\.0\\.1:[0-9]{1,5}$/.test(serviceOrigin) ||\n" +
      "      new URL(rpcUrl).protocol !== 'https:' || new URL(rpcUrl).hostname !== '127.0.0.1') throw unavailable();\n" +
      '  const replayStart = performance.now();'],
    ['      now: Date.now,',
      `      now: () => ${transcript.blockTimestampMs + 1000} + Math.floor(performance.now() - replayStart),`],
  ]);
  patch('modules/pali-wallet-storage/ios/PaliPublicSnapshotDownload.swift', 'c3e4b9add18e53c0d20b543d3f8c938d80dc5c0e9a77c821bc1554248e91cc38', [
    ['    return try reserve(endpoint, timeout: 25, snapshotLimit: 2 * 1024 * 1024, completion: completion)',
      '    guard pool == "eth-1", endpoint.scheme == "http", endpoint.host == "127.0.0.1" else { throw PaliPublicSnapshotDownloadError.invalid }\n' +
      '    return try reserve(endpoint, timeout: 25, snapshotLimit: 16 * 1024 * 1024, completion: completion)'],
    ['    let body = try anchor.body(for: read, id: id)',
      '    guard anchor.endpoint.scheme == "https", anchor.endpoint.host == "127.0.0.1" else { throw PaliPublicSnapshotDownloadError.invalid }\n' +
      '    let body = try anchor.body(for: read, id: id)'],
  ]);
  patch('modules/pali-wallet-storage/android/src/main/java/org/syscoin/pali/storage/PaliPublicSnapshotDownload.kt', '0ed9e326dafdaeb1c70a04788fbb54e790397ef7b25e4a5642cc81a2b62b56f9', [
    ['  private const val SNAPSHOT_BYTES = 2 * 1024 * 1024', '  private const val SNAPSHOT_BYTES = 16 * 1024 * 1024'],
    ['    if (pool !in setOf("eth-0.1", "eth-1", "eth-10", "eth-100")) return null', '    if (pool != "eth-1") return null'],
    ['    val origin = serviceOrigin.toHttpUrlOrNull() ?: return null',
      '    val origin = serviceOrigin.toHttpUrlOrNull() ?: return null\n    if (origin.scheme != "http" || origin.host != "127.0.0.1") return null'],
    ['    anchor.endpoint, TimeUnit.SECONDS.toNanos(TIMEOUT_SECONDS),',
      '    anchor.endpoint.takeIf { it.isHttps && it.host == "127.0.0.1" } ?: fail(PaliPublicSnapshotError.INVALID),\n' +
      '    TimeUnit.SECONDS.toNanos(TIMEOUT_SECONDS),'],
  ]);
  patch('qualification/public-pool-contract.ts', '1a057167ceb1891bff2cc9adf7d03f393844da383d56e2a2b9a18710b2c4186e', [
    ['PUBLIC_POOL_BLOCK = 20_000_000;', `PUBLIC_POOL_BLOCK = ${ETH1_SCALE.block};`],
    ["PUBLIC_POOL_BLOCK_HASH = '0x' + '37'.repeat(32);", `PUBLIC_POOL_BLOCK_HASH = '${ETH1_SCALE.blockHash}';`],
    ['PUBLIC_POOL_LEAVES = 1025;', `PUBLIC_POOL_LEAVES = ${ETH1_SCALE.leaves};`],
    ['PUBLIC_POOL_BATCHES = 9;', `PUBLIC_POOL_BATCHES = ${ETH1_SCALE.batches};`],
    ['// Fixed synthetic depth-20 tree for leaves 1..1025, with the Classic empty\n' +
      '// leaf. Generated offline by a separate bottom-up MiMC sponge reference,\n' +
      '// checked against the existing independently generated 17-leaf vector.',
      '// Fixed historical ETH1 tree. Path digests come from the offline bottom-up reference.'],
    ['0x12144900eac27f8d1e0ec41898fe435ec18afb4e435a476fd53b3bf2bc7293ac', ETH1_SCALE.root],
    ['0x0d11b7a72636fdb715eda36e664882dab8ce4942fa14e116cc22199a94c1057e', ETH1_SCALE.pathDigests[0]],
    ['0x7273698ce2e9f495d1b302ea540727c86fa9747e616a19282c02ce65b5bc6a65', ETH1_SCALE.pathDigests[1]],
  ]);
  patch('qualification/public-pool-server.cjs', '9b49c105cad0705939d629f3132bfe451a17ac67d261a7540aef7193731a99c4', [
    ['PUBLIC_POOL_BATCHES, PUBLIC_POOL_BLOCK, PUBLIC_POOL_BLOCK_HASH,', 'PUBLIC_POOL_BATCHES, PUBLIC_POOL_BLOCK,'],
    ["const word = (value) => '0x' + BigInt(value).toString(16).padStart(64, '0');\n", ''],
    ['async function createPublicPoolFixture({ key, cert }) {',
      'async function createPublicPoolFixture({ key, cert, snapshotBody, anchorPasses }) {'],
    ["  const block = { number: tag, hash: PUBLIC_POOL_BLOCK_HASH, timestamp: '0x' + Math.floor(Date.now() / 1000).toString(16) };\n" +
      '  const results = [\'0x1\', block, word(PUBLIC_POOL_LEAVES), PUBLIC_POOL_ROOT, word(20), word(10n ** 18n), block, word(1)];\n' +
      '  const snapshotBody = JSON.stringify({ version: 1, chainId: 1, poolAddress: PUBLIC_POOL_ADDRESS, asOfBlockNumber: PUBLIC_POOL_BLOCK,\n' +
      '    asOfBlockHash: PUBLIC_POOL_BLOCK_HASH, leafCount: PUBLIC_POOL_LEAVES, root: PUBLIC_POOL_ROOT,\n' +
      '    leaves: Array.from({ length: PUBLIC_POOL_LEAVES }, (_, index) => word(index + 1)), withdrawnNullifiers: [] });',
      '  const results = anchorPasses.flat();'],
    ['results[offset % results.length]', 'results[offset]'],
  ]);
  patch('scripts/configure-native-qualification.cjs', '23d4cef2fffb78994909f8d10af431c769cfc6933f7512a1466c7d682c6a6ec1', [
    ["const publicPoolEnabled = process.env.PALI_NATIVE_PUBLIC_POOL_QUALIFICATION === '1';",
      "const publicPoolEnabled = process.env.PALI_NATIVE_PUBLIC_POOL_QUALIFICATION === '1';\n" +
      "if (!publicPoolEnabled) throw Error('ETH1_SCALE_REQUIRES_ISOLATED_PUBLIC_POOL_BUILD');"],
    ["  identifier: 'com.paliwallet.qualification',", `  identifier: '${APP}',`],
    ["console.log('Configured isolated com.paliwallet.qualification entrypoint');", `console.log('Configured isolated ${APP} entrypoint');`],
  ]);
  patch('qualification/withHttpFixture.cjs', '36f64eadc0c27d34e3352b925804c93f7846d22980bda3197b02b93be113e170', [
    ["config.ios?.bundleIdentifier !== 'com.paliwallet.qualification'", `config.ios?.bundleIdentifier !== '${APP}'`],
    ["config.android?.package !== 'com.paliwallet.qualification' || (!!pool === !!http)",
      `config.android?.package !== '${APP}' || !pool || !!http`],
  ]);
  patch('qualification/launch-parameters.ts', 'f6960dadb2e0baa2b06b4919dbc598dde260e5ea869f1bbdbfb1bec3a8a79b8b', [
    ["iosIdentifier !== 'com.paliwallet.qualification' || androidIdentifier !== 'com.paliwallet.qualification'",
      `iosIdentifier !== '${APP}' || androidIdentifier !== '${APP}'`],
  ]);
  patch('qualification/run-public-pool-fixture.cjs', '09ee58c61034ccacde8932ea3f345de62ecc65e47e87d92720042e33a7e3dc8f', [
    ["const { X509Certificate } = require('node:crypto');",
      "/* global __dirname */\nconst { X509Certificate } = require('node:crypto');"],
    ["const { publicPoolBuild } = require('./public-pool-contract.ts');",
      "const { publicPoolBuild } = require('./public-pool-contract.ts');\n" +
      "const { execFileSync } = require('node:child_process');\n" +
      "const { readEth1ScaleSnapshot, readEth1ScaleTranscript } = require('./eth1-scale-input.cjs');\n" +
      "const scale = require('./eth1-release-scale-input.json');"],
    ["receipt.identifier !== 'com.paliwallet.qualification'", `receipt.identifier !== '${APP}'`],
    ['async function run([platform, receiptFile, caFile, certFile, keyFile, reportFile]) {',
      'async function run([platform, receiptFile, caFile, certFile, keyFile, reportFile, snapshotFile, transcriptFile]) {'],
    ['  const { build, caSha256 } = readFixtureBuild(receiptFile);',
      '  const { build, caSha256 } = readFixtureBuild(receiptFile);\n' +
      "  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: __dirname, encoding: 'utf8' }).trim();\n" +
      "  if (build.sourceRevision !== revision) throw Error('ETH1_SCALE_SOURCE_MISMATCH');\n" +
      '  const transcript = readEth1ScaleTranscript(transcriptFile);\n' +
      "  if (transcript.sha256 !== scale.transcriptSha256) throw Error('ETH1_SCALE_TRANSCRIPT_INVALID');\n" +
      '  const { bytes } = await readEth1ScaleSnapshot(snapshotFile);'],
    ['    const fixture = await createPublicPoolFixture({ key, cert });',
      '    const fixture = await createPublicPoolFixture({ key, cert, snapshotBody: bytes, anchorPasses: transcript.passes });'],
    ['          console.log(JSON.stringify({ passed: true, ...build, platform, caSha256, result: report.result }));',
      "          console.log(JSON.stringify({ passed: true, scope: 'offline-eth1-release-scale', ...build, platform, caSha256,\n" +
      '            snapshotSha256: scale.snapshotSha256, transcriptSha256: scale.transcriptSha256, result: report.result }));'],
  ]);
  return changed;
}

/** Generate an unconnected detached checkout. The ordinary source is read-only. */
async function prepare([snapshotFile, transcriptFile]) {
  const transcript = readEth1ScaleTranscript(transcriptFile);
  const { snapshot } = await readEth1ScaleSnapshot(snapshotFile);
  const reference = referencePaths(snapshot.leaves);
  if (reference.root !== ETH1_SCALE.root || !isDeepStrictEqual(reference.pathDigests, ETH1_SCALE.pathDigests))
    throw Error('ETH1_SCALE_REFERENCE_MISMATCH');
  const source = resolve(__dirname, '../../..');
  const root = mkdtempSync(join(tmpdir(), 'pali-eth1-release-scale-'));
  const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(source, ['clone', '--shared', '--no-checkout', '--', source, root]);
  git(root, ['remote', 'remove', 'origin']);
  git(root, ['switch', '--detach', BASE]);
  const changed = buildOverlay(root, transcript);
  const helper = readFileSync(join(__dirname, 'eth1-scale-input.cjs'));
  changed.set('qualification/eth1-scale-input.cjs', helper);
  const files = Object.fromEntries(Array.from(changed, ([name, value]) => [name, sha256(value)]));
  const stamp = { version: 1, base: BASE, snapshotSha256: ETH1_SCALE.sha256, transcriptSha256: transcript.sha256,
    blockTimestampMs: transcript.blockTimestampMs, pathDigests: ETH1_SCALE.pathDigests, files };
  changed.set(STAMP, JSON.stringify(stamp, null, 2) + '\n');
  for (const [name, value] of changed) writeFileSync(join(root, 'apps/mobile', name), value);
  git(root, ['add', '--', ...Array.from(changed.keys(), (name) => 'apps/mobile/' + name)]);
  git(root, ['-c', 'user.name=Pali Qualification', '-c', 'user.email=qualification@invalid', '-c', 'core.hooksPath=/dev/null',
    'commit', '-m', 'Compose isolated offline ETH1 Release scale qualification']);
  const revision = git(root, ['rev-parse', 'HEAD']);
  return { scope: 'offline-projection-only', root, revision, ...stamp };
}

if (require.main === module)
  prepare(process.argv.slice(2)).then((result) => console.log(JSON.stringify(result, null, 2)), (error) => {
    console.error(/^ETH1_SCALE_[A-Z_]+$/.test(error?.message) ? error.message : 'ETH1_SCALE_PREPARATION_FAILED');
    process.exitCode = 1;
  });

module.exports = { BASE, APP, buildOverlay };
