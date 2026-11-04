const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Buffer } = require('node:buffer');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { SourceMapGenerator } = require('source-map');
const { preserveSourceMap, resolveLocations } = require('./source-map-evidence.cjs');

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
    assert.equal(malformed.stderr, 'NATIVE_SOURCE_MAP_EVIDENCE_FAILED\n');
    fs.truncateSync(reportFile, 1024 * 1024 + 1);
    assert.equal(run().stderr, 'NATIVE_SOURCE_MAP_EVIDENCE_FAILED\n');
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
