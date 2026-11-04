/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Buffer } = require('node:buffer');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { SourceMapGenerator } = require('source-map');
const { preserveSourceMap, preserveQualifiedSourceMap, resolveLocations } = require('./source-map-evidence.cjs');
const { POST_REQUIRED_MAPPED_SOURCES } = require('./post-evidence.cjs');

function fixtureMap() {
  const map = new SourceMapGenerator({ file: 'main.jsbundle' });
  map.addMapping({ generated: { line: 1, column: 10 }, original: { line: 37, column: 2 }, source: 'src/native-loader.ts', name: 'PRIVATE_FUNCTION_NAME' });
  map.addMapping({ generated: { line: 1, column: 11 }, original: { line: 38, column: 0 }, source: 'src/native-loader.ts' });
  map.addMapping({ generated: { line: 5, column: 0 }, original: { line: 44, column: 0 }, source: 'src/bootstrap.ts' });
  map.setSourceContent('src/native-loader.ts', 'PRIVATE_SOURCE_CONTENT');
  return JSON.parse(map.toString());
}

function report(locations) {
  return { platform: 'ios', cryptoDiagnostic: { load: { locations } } };
}

test('source locations use already-normalized zero-based columns and expose only source file and line', () => {
  const result = resolveLocations(report([
    { bundle: 'ios', kind: 'bytecode', line: 1, column: 10 },
    { bundle: 'ios', kind: 'source', line: 5, column: 0 },
    { bundle: 'ios', kind: 'bytecode', line: 1, column: 10 },
  ]), fixtureMap());
  assert.deepEqual(result, [{ source: 'src/native-loader.ts', line: 37 }, { source: 'src/bootstrap.ts', line: 44 }]);
  assert(!JSON.stringify(result).includes('PRIVATE_'));
});

test('location resolver rejects unsupported, oversized and unmapped input instead of guessing', () => {
  const good = { bundle: 'ios', kind: 'bytecode', line: 1, column: 10 };
  for (const locations of [
    [], Array(9).fill(good), [{ ...good, bundle: 'android' }], [{ ...good, column: -1 }],
    [{ ...good, line: 0 }], [{ ...good, column: 1.5 }], [{ ...good, kind: 'raw-error' }],
    [{ ...good, message: 'private input' }],
  ]) assert.throws(() => resolveLocations(report(locations), fixtureMap()), /NATIVE_SOURCE_LOCATION_INVALID/);
  assert.throws(() => resolveLocations(report([{ ...good, column: 0 }]), fixtureMap()), /NATIVE_SOURCE_LOCATION_UNMAPPED/);
});

test('source-map artifacts retain the exact map and hashes of the built bytecode and map', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-native-map-'));
  try {
    const bundleFile = path.join(directory, 'main.jsbundle');
    const mapFile = path.join(directory, 'build.map');
    const bundle = Buffer.from('public synthetic bytecode');
    const map = Buffer.from(JSON.stringify(fixtureMap()));
    fs.writeFileSync(bundleFile, bundle);
    fs.writeFileSync(mapFile, map);
    const output = path.join(directory, 'artifacts');
    const manifest = preserveSourceMap('ios', bundleFile, mapFile, output, 'a'.repeat(40));
    const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
    assert.equal(manifest.bundleSha256, digest(bundle));
    assert.equal(manifest.sourceMapSha256, digest(map));
    assert.equal(manifest.sourceRevision, 'a'.repeat(40));
    assert.deepEqual(fs.readFileSync(path.join(output, manifest.sourceMapFile)), map);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output, 'ios-source-map.json'), 'utf8')), manifest);
    assert(!JSON.stringify(manifest).includes('PRIVATE_'));
    // iOS writes the composed map directly to the artifact path before preservation.
    assert.deepEqual(preserveSourceMap('ios', bundleFile, path.join(output, manifest.sourceMapFile), output, 'a'.repeat(40)), manifest);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('offline CLI reads explicit report/map files and never prints parsing payloads', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-map-resolver-'));
  try {
    const mapFile = path.join(directory, 'native.map');
    const reportFile = path.join(directory, 'report.json');
    fs.writeFileSync(mapFile, JSON.stringify(fixtureMap()));
    fs.writeFileSync(reportFile, JSON.stringify(report([{ bundle: 'ios', kind: 'bytecode', line: 1, column: 10 }])));
    const run = () => spawnSync(process.execPath, [require.resolve('./source-map-evidence.cjs'), 'resolve', reportFile, mapFile], { encoding: 'utf8' });
    const success = run();
    assert.equal(success.status, 0);
    assert.deepEqual(JSON.parse(success.stdout), [{ source: 'src/native-loader.ts', line: 37 }]);
    fs.writeFileSync(reportFile, 'PRIVATE_MALFORMED_PAYLOAD');
    const malformed = run();
    assert.equal(malformed.status, 1);
    assert.equal(malformed.stdout, '');
    assert.equal(malformed.stderr, 'NATIVE_SOURCE_MAP_EVIDENCE_FAILED\nNATIVE_SOURCE_MAP_REASON=source-map-invalid\n');
    fs.truncateSync(reportFile, 1024 * 1024 + 1);
    assert.equal(run().stderr, 'NATIVE_SOURCE_MAP_EVIDENCE_FAILED\nNATIVE_SOURCE_MAP_REASON=input-invalid\n');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

function currentMap() {
  return { version: 3, sources: POST_REQUIRED_MAPPED_SOURCES.map(source => `/${source.replace(/^apps\/mobile\//, '')}`),
    sourcesContent: POST_REQUIRED_MAPPED_SOURCES.map(source => fs.readFileSync(path.resolve(__dirname, '../../..', source), 'utf8')) };
}

test('current project source bytes pass admission and are retained exactly', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-map-current-'));
  try {
    const mapFile = path.join(directory, 'compiled.map'), bundleFile = path.join(directory, 'compiled.bundle');
    const map = Buffer.from(JSON.stringify(currentMap()));
    fs.writeFileSync(mapFile, map); fs.writeFileSync(bundleFile, 'public compiled fixture');
    const result = preserveQualifiedSourceMap('android', bundleFile, mapFile, directory, 'a'.repeat(40), true);
    assert.deepEqual(fs.readFileSync(path.join(directory, result.sourceMapFile)), map);
    assert(!fs.existsSync(path.join(directory, 'android-source-map-failure.json')));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('failed required-source admission retains the bounded original map without a success manifest', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-map-missing-'));
  try {
    const mapFile = path.join(directory, 'compiled.map'), bundleFile = path.join(directory, 'compiled.bundle');
    const map = currentMap(); map.sources.shift(); map.sourcesContent.shift();
    const bytes = Buffer.from(JSON.stringify(map));
    fs.writeFileSync(mapFile, bytes); fs.writeFileSync(bundleFile, 'public compiled fixture');
    assert.throws(() => preserveQualifiedSourceMap('android', bundleFile, mapFile, directory, 'a'.repeat(40), true), /POST_SOURCE_MAP_MISSING/);
    const failure = JSON.parse(fs.readFileSync(path.join(directory, 'android-source-map-failure.json'), 'utf8'));
    assert.deepEqual(failure, { version: 1, status: 'failed', platform: 'android', sourceRevision: 'a'.repeat(40),
      reason: 'required-source-missing', sourceMapFile: 'android-failed-source-map.map',
      sourceMapSha256: crypto.createHash('sha256').update(bytes).digest('hex') });
    assert.deepEqual(fs.readFileSync(path.join(directory, failure.sourceMapFile)), bytes);
    assert(!fs.existsSync(path.join(directory, 'android-source-map.json')));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('failure reasons do not expose source payloads and retention errors never turn failure into success', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-map-private-'));
  try {
    const mapFile = path.join(directory, 'compiled.map'), bundleFile = path.join(directory, 'compiled.bundle');
    const map = currentMap(); map.sourcesContent[0] += 'PRIVATE_SOURCE_PAYLOAD';
    fs.writeFileSync(mapFile, JSON.stringify(map)); fs.writeFileSync(bundleFile, 'public compiled fixture');
    const output = path.join(directory, 'artifacts');
    const args = [require.resolve('./source-map-evidence.cjs'), 'preserve', 'ios', bundleFile, mapFile, output];
    const run = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env,
      PALI_NATIVE_HTTP_QUALIFICATION: '1', GITHUB_SHA: 'a'.repeat(40) } });
    assert.equal(run.status, 1); assert.equal(run.stdout, '');
    assert.equal(run.stderr, 'NATIVE_SOURCE_MAP_EVIDENCE_FAILED\nNATIVE_SOURCE_MAP_REASON=source-content-mismatch\n');
    const diagnostic = fs.readFileSync(path.join(output, 'ios-source-map-failure.json'), 'utf8');
    assert(!diagnostic.includes('PRIVATE_SOURCE_PAYLOAD')); assert(!diagnostic.includes(directory));
    assert(!fs.existsSync(path.join(output, 'ios-source-map.json')));
    const blockedOutput = path.join(directory, 'not-a-directory'); fs.writeFileSync(blockedOutput, 'existing');
    assert.throws(() => preserveQualifiedSourceMap('ios', bundleFile, mapFile, blockedOutput, null, true), /POST_SOURCE_MAP_MISMATCH/);
    assert.equal(fs.readFileSync(blockedOutput, 'utf8'), 'existing');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('missing or oversized input retains only bounded failure metadata', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-map-input-'));
  try {
    const absent = path.join(directory, 'absent'), output = path.join(directory, 'artifacts');
    assert.throws(() => preserveQualifiedSourceMap('android', absent, absent, output));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output, 'android-source-map-failure.json'), 'utf8')),
      { version: 1, status: 'failed', platform: 'android', sourceRevision: null, reason: 'input-unavailable' });
    assert(!fs.existsSync(path.join(output, 'android-failed-source-map.map')));
    const oversized = path.join(directory, 'oversized'); fs.writeFileSync(oversized, ''); fs.truncateSync(oversized, 64 * 1024 * 1024 + 1);
    const largeOutput = path.join(directory, 'large-artifacts');
    assert.throws(() => preserveQualifiedSourceMap('android', absent, oversized, largeOutput));
    assert.equal(JSON.parse(fs.readFileSync(path.join(largeOutput, 'android-source-map-failure.json'), 'utf8')).reason, 'input-invalid');
    assert(!fs.existsSync(path.join(largeOutput, 'android-failed-source-map.map')));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('native workflow preserves maps from the same actual iOS and Android build outputs', () => {
  const workflow = require('js-yaml').load(fs.readFileSync(require.resolve('../../../.github/workflows/mobile-native-qualification.yml'), 'utf8'));
  const ios = workflow.jobs.ios.steps.find((step) => step.name === 'Build real iOS simulator binary');
  const android = workflow.jobs.android.steps.find((step) => step.name === 'Build real Android binary');
  assert.equal(ios.env.SOURCEMAP_FILE, '${{ runner.temp }}/pali-native-ios/ios-main.jsbundle.map');
  assert(ios.run.includes('PaliQualification.app/main.jsbundle'));
  assert(ios.run.includes('qualification/source-map-evidence.cjs preserve ios'));
  assert(android.run.includes('android/app/build/generated/assets/react/release/index.android.bundle'));
  assert(android.run.includes('android/app/build/generated/sourcemaps/react/release/index.android.bundle.map'));
  for (const step of [ios, android]) assert.equal(spawnSync('bash', ['-n'], { input: step.run, encoding: 'utf8' }).status, 0);
});
