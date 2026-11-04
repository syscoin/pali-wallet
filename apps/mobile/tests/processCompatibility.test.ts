import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { createContext, runInContext, runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { installNativeProcessCompatibility } from '../src/platform/processCompatibility.ts';

const root = fileURLToPath(new NodeURL('..', import.meta.url));
const nodeRequire = createRequire(import.meta.url);

// Run the installed CommonJS packages with their browser entry mappings and an
// RN-shaped process, so Node's own process cannot hide missing global fields.
function browserRuntime() {
  const process = { env: { NODE_ENV: 'production' } };
  const host = { process, setTimeout, clearTimeout, setImmediate, clearImmediate, Buffer, console };
  const context = createContext(host);
  runInContext('globalThis.global = globalThis', context);
  const cache = new Map<string, { exports: unknown }>();
  function packageFor(file: string): { directory: string; browser?: Record<string, string | false> } | undefined {
    let directory = path.dirname(file);
    while (directory !== path.dirname(directory)) {
      const manifest = path.join(directory, 'package.json');
      if (existsSync(manifest)) return { directory, ...JSON.parse(readFileSync(manifest, 'utf8')) };
      directory = path.dirname(directory);
    }
  }
  function load(specifier: string, parent = path.join(root, 'package.json')): unknown {
    const parentPackage = packageFor(parent);
    const requested = parentPackage?.browser?.[specifier];
    if (requested === false) return {};
    if (typeof requested === 'string') specifier = path.resolve(parentPackage!.directory, requested);
    if (builtinModules.includes(specifier)) return nodeRequire(specifier);
    let file = createRequire(parent).resolve(specifier);
    const ownPackage = packageFor(file);
    const replacement = ownPackage?.browser?.[`./${path.relative(ownPackage.directory, file).replaceAll(path.sep, '/')}`];
    if (replacement === false) return {};
    if (typeof replacement === 'string') file = createRequire(file).resolve(path.resolve(ownPackage!.directory, replacement));
    if (cache.has(file)) return cache.get(file)!.exports;
    const module: { exports: unknown } = { exports: {} };
    cache.set(file, module);
    if (file.endsWith('.json')) module.exports = JSON.parse(readFileSync(file, 'utf8'));
    else {
      const factory = runInContext(`(function(require,module,exports,__filename,__dirname){${readFileSync(file, 'utf8')}\n})`, context, { filename: file });
      factory((name: string) => load(name, file), module, module.exports, file, path.dirname(file));
    }
    return module.exports;
  }
  return { host, load };
}

test('the actual old stream dependency reproduces the native process.version import failure', () => {
  const runtime = browserRuntime();
  assert.throws(() => runtime.load('level-ws'), /slice/);
});

test('installed level-ws and both stream versions read, write and finish with the standard scheduler', { timeout: 2000 }, async () => {
  const runtime = browserRuntime();
  const originalProcess = runtime.host.process;
  const originalEnv = originalProcess.env;
  const shim = runtime.load('process/browser') as { nextTick: Parameters<typeof installNativeProcessCompatibility>[1] };
  installNativeProcessCompatibility(runtime.host, shim.nextTick);
  assert.equal(runtime.host.process, originalProcess);
  assert.equal(runtime.host.process.env, originalEnv);
  assert.equal('version' in runtime.host.process, false);
  assert.equal('crypto' in runtime.host, false);
  const levelFile = nodeRequire.resolve('level-ws');
  const oldStreams = runtime.load('readable-stream', levelFile) as any;
  const WriteStream = runtime.load('level-ws') as any;
  const batches: unknown[] = [];
  const writer = new WriteStream({ batch(operations: unknown[], done: () => void) {
    batches.push(...operations);
    setTimeout(done, 0);
  } });
  const source = new oldStreams.Readable({ objectMode: true, read() {
    this.push({ key: 'public-key', value: 'public-value' });
    this.push(null);
  } });
  await new Promise<void>((resolve, reject) => {
    writer.on('error', reject);
    writer.on('finish', resolve);
    source.pipe(writer);
  });
  assert.equal(JSON.stringify(batches), '[{"type":"put","key":"public-key","value":"public-value"}]');
  // The top-level 3.x stream used by the native `stream` alias also needs nextTick.
  const streams = runtime.load('readable-stream') as any;
  const values: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const readable = new streams.Readable({ read() { this.push('public'); this.push(null); } });
    readable.on('error', reject);
    readable.on('data', (chunk: Buffer) => values.push(chunk.toString()));
    readable.on('end', resolve);
  });
  assert.deepEqual(values, ['public']);
});

test('compatibility is idempotent and preserves existing valid fields and environment', () => {
  const tick = () => {};
  const host = { process: { env: { NODE_ENV: 'production' }, browser: false, nextTick: tick } };
  const before = { ...host.process };
  installNativeProcessCompatibility(host, () => { throw Error('must not replace'); });
  installNativeProcessCompatibility(host, () => { throw Error('must not replace'); });
  assert.deepEqual(host.process, before);
});

test('malformed existing runtime fields and nonextensible processes fail before mutation', () => {
  for (const process of [undefined, null, [], {}, { env: null }, { env: {}, browser: 'yes' },
    { env: {}, nextTick: 1 }, { env: {}, browser: undefined }, Object.freeze({ env: {} })]) {
    const before = process && typeof process === 'object' ? Object.getOwnPropertyDescriptors(process) : undefined;
    assert.throws(() => installNativeProcessCompatibility({ process }, () => {}), /NATIVE_PROCESS_UNAVAILABLE/);
    if (before) assert.deepEqual(Object.getOwnPropertyDescriptors(process), before);
  }
});

test('native bootstrap installs process compatibility before loading dependencies and fails closed', async () => {
  const source = readFileSync(path.join(root, 'src/platform/cryptoBootstrap.native.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  for (const invalid of [false, true]) {
    const events: string[] = [];
    const exports: Record<string, () => Promise<unknown>> = {};
    const process = { env: {}, ...(invalid ? { nextTick: 1 } : {}) };
    runInNewContext(code, { exports, process, require(name: string) {
      if (name === 'expo') return {};
      if (name === './processCompatibility.ts') return { ensureNativeProcessCompatibility() {
        events.push('process'); installNativeProcessCompatibility({ process }, () => {});
      } };
      if (name === '../crypto/quickCryptoLoad.ts') return { loadQuickCrypto(load: () => unknown) { return load(); } };
      if (name === 'react-native-quick-crypto') { events.push('load'); throw Error('stop after load'); }
      return {};
    } });
    await assert.rejects(exports.ensureNativeCryptoReady!(), /NATIVE_CRYPTO_UNAVAILABLE/);
    assert.deepEqual(events, invalid ? ['process'] : ['process', 'load']);
    assert.equal((exports.nativeCryptoStatus as unknown as () => string)(), 'unavailable');
  }
  const fixture = readFileSync(path.join(root, 'qualification/index.tsx'), 'utf8');
  assert(fixture.indexOf('ensureNativeProcessCompatibility();') < fixture.indexOf('await captureQualificationCryptoLoad('));
});
