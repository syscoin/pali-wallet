const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { SourceMapConsumer } = require('source-map');

const MAX_MAP_BYTES = 64 * 1024 * 1024;
const MAX_REPORT_BYTES = 1024 * 1024;
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function readBounded(file, maximum) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size < 1 || stat.size > maximum) throw Error('NATIVE_SOURCE_MAP_INPUT_INVALID');
  return fs.readFileSync(file);
}

function preserveSourceMap(platform, bundleFile, mapFile, output, sourceRevision = null) {
  if (!['ios', 'android'].includes(platform) ||
      (sourceRevision !== null && !/^[a-f0-9]{40}$/.test(sourceRevision)))
    throw Error('NATIVE_SOURCE_MAP_INPUT_INVALID');
  const bundle = readBounded(bundleFile, MAX_MAP_BYTES);
  const map = readBounded(mapFile, MAX_MAP_BYTES);
  if (JSON.parse(map.toString('utf8')).version !== 3) throw Error('NATIVE_SOURCE_MAP_INPUT_INVALID');
  const name = platform === 'ios' ? 'ios-main.jsbundle.map' : 'android-index.android.bundle.map';
  const target = path.join(output, name);
  fs.mkdirSync(output, { recursive: true });
  if (path.resolve(mapFile) !== path.resolve(target)) fs.copyFileSync(mapFile, target);
  const manifest = {
    version: 1, platform, sourceRevision,
    bundleFile: platform === 'ios' ? 'main.jsbundle' : 'index.android.bundle',
    bundleSha256: hash(bundle), sourceMapFile: name, sourceMapSha256: hash(map),
  };
  fs.writeFileSync(path.join(output, `${platform}-source-map.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function resolveLocations(report, sourceMap) {
  const locations = report?.cryptoDiagnostic?.load?.locations;
  if (!['ios', 'android'].includes(report?.platform) || !Array.isArray(locations) || locations.length < 1 || locations.length > 8)
    throw Error('NATIVE_SOURCE_LOCATION_INVALID');
  for (const location of locations) {
    if (!isRecord(location) || Object.keys(location).length !== 4 ||
        !Object.keys(location).every((key) => ['bundle', 'kind', 'line', 'column'].includes(key)) ||
        location.bundle !== report.platform || !['bytecode', 'source'].includes(location.kind) ||
        !Number.isSafeInteger(location.line) || location.line < 1 || location.line > 1000000000 ||
        !Number.isSafeInteger(location.column) || location.column < 0 || location.column > 1000000000)
      throw Error('NATIVE_SOURCE_LOCATION_INVALID');
  }
  const consumer = new SourceMapConsumer(sourceMap);
  const results = [];
  for (const location of locations) {
    // Both Hermes bytecode offsets and ordinary source columns are already zero-based.
    const original = consumer.originalPositionFor({ line: location.line, column: location.column });
    if (typeof original.source !== 'string' || original.source.length < 1 || original.source.length > 2048 ||
        /[\u0000-\u001f\u007f]/.test(original.source) || !Number.isSafeInteger(original.line) || original.line < 1)
      throw Error('NATIVE_SOURCE_LOCATION_UNMAPPED');
    if (!results.some((entry) => entry.source === original.source && entry.line === original.line))
      results.push({ source: original.source, line: original.line });
  }
  return results;
}

if (require.main === module) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'preserve' && args.length === 4) {
      if (process.env.PALI_NATIVE_HTTP_QUALIFICATION === '1') {
        require('./post-evidence.cjs').assertCurrentPostSourceMap(JSON.parse(readBounded(args[2], MAX_MAP_BYTES).toString('utf8')));
      }
      preserveSourceMap(...args, process.env.GITHUB_SHA || null);
    } else if (command === 'resolve' && args.length === 2) {
      const report = JSON.parse(readBounded(args[0], MAX_REPORT_BYTES).toString('utf8'));
      const map = JSON.parse(readBounded(args[1], MAX_MAP_BYTES).toString('utf8'));
      process.stdout.write(`${JSON.stringify(resolveLocations(report, map), null, 2)}\n`);
    } else {
      throw Error('NATIVE_SOURCE_MAP_ARGUMENTS_INVALID');
    }
  } catch {
    // Parser and filesystem errors can embed source contents or user-provided paths.
    process.stderr.write('NATIVE_SOURCE_MAP_EVIDENCE_FAILED\n');
    process.exitCode = 1;
  }
}

module.exports = { preserveSourceMap, resolveLocations };
