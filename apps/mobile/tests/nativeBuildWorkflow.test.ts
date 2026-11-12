import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';

type Receipt = { schemaVersion: 1; channel: 'mobile'; buildNumber: number; sourceRevision: string; allocationRevision: string;
  requestId: string; purpose: 'qa' | 'store'; allocatedAt: string; sourceDirty: boolean };
type Ports = { appRoot: string; prepareAssets(): Promise<void>;
  reserve(options: { cwd: string; purpose: 'qa' | 'store'; channel: 'mobile' }): Promise<Receipt>;
  assertSource(options: { cwd: string; receipt: Receipt }): Promise<void>;
  execute(args: string[], env: NodeJS.ProcessEnv): Promise<void> };
type Config = { version: string; slug?: string; ios: { bundleIdentifier: string; buildNumber?: string };
  android: { package: string; versionCode?: number } };
type ModConfig = Config & { modResults: Record<string, unknown> };
const require = createRequire(import.meta.url);
const { runNativeBuild, parseArguments } = require('../scripts/run-native-build.cjs') as {
  runNativeBuild(argv: string[], ports: Ports): Promise<Receipt>;
  parseArguments(argv: string[]): { platform: string; prepareOnly: boolean; purpose: 'qa' | 'store'; forwarded: string[] };
};
const { parseBuildNumber } = require('../../../scripts/build-number.cjs') as { parseBuildNumber(value: unknown, channel: 'mobile'): number };
const source = (file: string) => readFileSync(new NodeURL(file, import.meta.url), 'utf8');
const productionConfig = (): Config => ({ version: '5.0.0', ios: { bundleIdentifier: 'com.paliwallet.mobile' },
  android: { package: 'com.paliwallet.mobile' } });

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'pali-build-workflow-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = productionConfig();
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '5.0.0' }));
  writeFileSync(join(root, 'app.json'), JSON.stringify({ expo: app }));
  const receipt: Receipt = { schemaVersion: 1, channel: 'mobile', buildNumber: 47, sourceRevision: 'a'.repeat(40),
    allocationRevision: 'b'.repeat(40), requestId: '12345678-1234-4234-9234-123456789abc',
    purpose: 'qa', allocatedAt: '2026-11-12T00:00:00.000Z', sourceDirty: false };
  const reservations: { cwd: string; purpose: 'qa' | 'store'; channel: 'mobile' }[] = [];
  const assertions: { cwd: string; receipt: Receipt }[] = [];
  const executions: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
  const events: string[] = [];
  const ports: Ports = { appRoot: root,
    async prepareAssets() {
      assert.equal(existsSync(join(root, '.pali-build', 'inflight', 'owner.json')), true);
      events.push('assets');
    },
    async reserve(options) { reservations.push(options); events.push('reserve'); return { ...receipt, purpose: options.purpose }; },
    async assertSource(options) { assertions.push(options); events.push('assert'); },
    async execute(args, env) { executions.push({ args, env }); events.push(args[0]!); },
  };
  return { root, app, receipt, reservations, assertions, executions, events, ports,
    persisted() { return JSON.parse(readFileSync(join(root, '.pali-build', 'build-47.json'), 'utf8')); } };
}

for (const platform of ['ios', 'android']) test(`${platform} reserves once and carries one number through both native steps`, async t => {
  const f = fixture(t);
  const result = await runNativeBuild([platform, '--device', 'Fixture Device'], f.ports);
  assert.deepEqual(f.reservations, [{ cwd: f.root, purpose: 'qa', channel: 'mobile' }]);
  assert.deepEqual(f.events, ['reserve', 'assert', 'assets', 'assert', 'prebuild', 'assert', `run:${platform}`]);
  assert.deepEqual(f.executions.map(call => call.args), [
    ['prebuild', '--platform', platform, '--no-install', '--no-clean'], [`run:${platform}`, '--device', 'Fixture Device'],
  ]);
  assert.equal(f.executions[0]!.env, f.executions[1]!.env);
  assert.equal(f.executions[0]!.env.PALI_MOBILE_BUILD_NUMBER, '47');
  assert.equal(f.executions[0]!.env.EXPO_NO_TELEMETRY, '1');
  assert(f.executions.every(call => !call.args.includes('--clean')));
  assert(f.executions[0]!.args.includes('--no-clean'));
  assert(f.assertions.every(call => call.cwd === f.root && call.receipt === result));
  assert.deepEqual(f.persisted(), { ...result, marketingVersion: '5.0.0', platform, preparedOnly: false });
  assert.equal(existsSync(join(f.root, '.pali-build', 'inflight')), false);
  assert.deepEqual(JSON.parse(readFileSync(join(f.root, 'app.json'), 'utf8')), { expo: f.app });
  assert.equal(JSON.parse(readFileSync(join(f.root, 'package.json'), 'utf8')).version, '5.0.0');
});

for (const platform of ['all', 'ios', 'android']) test(`${platform} store preparation reserves once and does not start compilation`, async t => {
  const f = fixture(t);
  const result = await runNativeBuild([platform, '--prepare-only', '--store'], f.ports);
  assert.equal(result.purpose, 'store');
  assert.deepEqual(f.reservations, [{ cwd: f.root, purpose: 'store', channel: 'mobile' }]);
  assert.deepEqual(f.events, ['reserve', 'assert', 'assets', 'assert', 'prebuild', 'assert']);
  assert.deepEqual(f.executions.map(call => call.args), [['prebuild', '--platform', platform, '--no-install', '--no-clean']]);
  assert.equal(f.persisted().marketingVersion, '5.0.0');
  assert.equal(f.persisted().preparedOnly, true);
  assert.equal(existsSync(join(f.root, '.pali-build', 'inflight')), false);
});

test('successive invocations keep separate receipts and use the newly reserved number', async t => {
  const f = fixture(t);
  let reservations = 0;
  f.ports.reserve = async options => ({ ...f.receipt, purpose: options.purpose, buildNumber: 47 + reservations++ });
  await runNativeBuild(['ios'], f.ports);
  await runNativeBuild(['android'], f.ports);
  assert.equal(reservations, 2);
  assert.deepEqual(f.executions.map(call => call.env.PALI_MOBILE_BUILD_NUMBER), ['47', '47', '48', '48']);
  assert.equal(f.persisted().buildNumber, 47);
  assert.equal(JSON.parse(readFileSync(join(f.root, '.pali-build', 'build-48.json'), 'utf8')).buildNumber, 48);
});

test('reservation refusal creates no receipt and never invokes Expo or source assertion', async t => {
  const f = fixture(t), failure = Error('reservation refused');
  f.ports.reserve = async () => { throw failure; };
  await assert.rejects(runNativeBuild(['ios'], f.ports), error => error === failure);
  assert.deepEqual(f.events, []);
  assert.equal(existsSync(join(f.root, '.pali-build', 'inflight')), false);
  assert.equal(existsSync(join(f.root, '.pali-build', 'build-47.json')), false);
});

test('failed proof-asset preparation releases the lock and retains its consumed reservation', async t => {
  const f = fixture(t), failure = Error('proof assets unavailable');
  f.ports.prepareAssets = async () => { throw failure; };
  await assert.rejects(runNativeBuild(['ios'], f.ports), error => error === failure);
  assert.equal(f.reservations.length, 1); assert.equal(f.executions.length, 0);
  assert.equal(f.assertions.length, 1);
  assert.equal(existsSync(join(f.root, '.pali-build', 'inflight')), false);
  assert.equal(f.persisted().buildNumber, 47);
});

test('failed prebuild preserves its reserved receipt but never starts the native run', async t => {
  const f = fixture(t), failure = Error('prebuild refused');
  f.ports.execute = async (args, env) => { f.executions.push({ args, env }); throw failure; };
  await assert.rejects(runNativeBuild(['android'], f.ports), error => error === failure);
  assert.equal(f.reservations.length, 1);
  assert.deepEqual(f.executions.map(call => call.args[0]), ['prebuild']);
  assert.equal(f.assertions.length, 2);
  assert.equal(f.persisted().buildNumber, 47);
  assert.equal(existsSync(join(f.root, '.pali-build', 'inflight')), false);
  f.ports.reserve = async () => ({ ...f.receipt, buildNumber: 48 });
  f.ports.execute = async (args, env) => { f.executions.push({ args, env }); };
  await runNativeBuild(['android'], f.ports);
  assert.equal(f.executions.at(-1)!.env.PALI_MOBILE_BUILD_NUMBER, '48');
  assert.equal(existsSync(join(f.root, '.pali-build', 'inflight')), false);
});

for (const failingCheck of [1, 2, 3]) test(`source refusal at check ${failingCheck} prevents the next child`, async t => {
  const f = fixture(t), failure = Error('source changed');
  let checks = 0;
  f.ports.assertSource = async () => { if (++checks === failingCheck) throw failure; };
  await assert.rejects(runNativeBuild(['ios'], f.ports), error => error === failure);
  assert.equal(f.reservations.length, 1);
  assert.equal(f.executions.length, failingCheck === 3 ? 1 : 0);
  assert.equal(f.events.filter(event => event === 'assets').length, failingCheck === 1 ? 0 : 1);
  assert.equal(f.persisted().buildNumber, 47);
  assert.equal(existsSync(join(f.root, '.pali-build', 'inflight')), false);
});

test('one checkout refuses a concurrent native build before it reserves or alters the active lock', async t => {
  const f = fixture(t);
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  f.ports.execute = async (args, env) => {
    f.executions.push({ args, env });
    if (args[0] === 'prebuild') { entered(); await held; }
  };
  const first = runNativeBuild(['ios'], f.ports);
  try {
    await started;
    const lock = join(f.root, '.pali-build', 'inflight');
    const owner = readFileSync(join(lock, 'owner.json'), 'utf8');
    await assert.rejects(runNativeBuild(['ios'], f.ports), /Another native build owns/);
    assert.equal(f.reservations.length, 1); assert.equal(f.executions.length, 1);
    assert.equal(f.events.filter(event => event === 'assets').length, 1);
    assert.equal(readFileSync(join(lock, 'owner.json'), 'utf8'), owner);
  } finally { release(); await first; }
  assert.equal(existsSync(join(f.root, '.pali-build', 'inflight')), false);
});

test('invalid platform/prepare arguments are rejected before reservation', async t => {
  for (const argv of [[], ['web'], ['all'], ['ios', '--store'], ['all', '--prepare-only', '--device'], ['ios', '--prepare-only', '--clean']]) {
    const f = fixture(t);
    assert.throws(() => parseArguments(argv), /Usage:/);
    await assert.rejects(runNativeBuild(argv, f.ports), /Usage:/);
    assert.equal(f.reservations.length, 0); assert.equal(f.executions.length, 0);
    assert.deepEqual(f.events, []);
  }
});

test('only supported Expo options are forwarded without permitting alternate artifacts or projects', () => {
  for (const [platform, args] of [
    ['ios', ['--device', 'iPhone', '--configuration', 'Release', '--output', '/tmp/pali-output', '--port', '8082', '--no-install', '--no-bundler', '--no-build-cache']],
    ['ios', ['-d', '-p', '8081', '-o', '/tmp/pali-output', '--configuration', 'Debug']],
    ['android', ['--device', 'emulator-5554', '--variant', 'release', '--all-arch', '--port', '65535']],
    ['android', ['--variant', 'debug']],
  ] as const) assert.deepEqual(parseArguments([platform, ...args]).forwarded, args);
  for (const argv of [
    ['ios', '--binary', '/tmp/old.app'], ['android', '--binary', '/tmp/old.apk'],
    ['ios', '--unstable-rebundle'], ['android', '--app-id', 'other.app'], ['ios', '--scheme', 'Other'],
    ['ios', '../other-project'], ['android', '--unknown'], ['ios', '--clean'],
    ['ios', '--configuration', 'Other'], ['android', '--variant', 'staging'],
    ['ios', '--all-arch'], ['android', '--configuration', 'Release'],
    ['ios', '--port', '0'], ['ios', '--port', '65536'], ['android', '--port', '8e3'],
    ['ios', '--output'], ['android', '--variant'],
  ]) assert.throws(() => parseArguments(argv), /(?:Unsupported|Invalid) native build argument/);
});

test('mismatched marketing versions and non-production identities cannot reserve a normal build', async t => {
  for (const change of [
    (app: Config) => { app.version = '5.0.1'; },
    (app: Config) => { app.ios.bundleIdentifier = 'com.paliwallet.qualification'; },
    (app: Config) => { app.android.package = 'com.paliwallet.qualification'; },
  ]) {
    const f = fixture(t); change(f.app);
    writeFileSync(join(f.root, 'app.json'), JSON.stringify({ expo: f.app }));
    await assert.rejects(runNativeBuild(['ios'], f.ports), /matching Pali app version and production identity/);
    assert.equal(f.reservations.length, 0); assert.equal(f.executions.length, 0);
    assert.equal(existsSync(join(f.root, '.pali-build', 'inflight')), false);
  }
});

function configLoader(value?: string): (options: { config: Config }) => Config {
  const module = { exports: {} };
  runInNewContext(source('../app.config.cjs'), { module, process: { env: value === undefined ? {} : { PALI_MOBILE_BUILD_NUMBER: value } },
    require(id: string) { assert.equal(id, '../../scripts/build-number.cjs'); return { parseBuildNumber }; } });
  return module.exports as (options: { config: Config }) => Config;
}

test('repeated Expo configuration reads apply the reserved number without changing marketing version', () => {
  const config = productionConfig(), configure = configLoader('47');
  for (let read = 0; read < 3; read++) {
    const result = configure({ config });
    assert.equal(result.version, '5.0.0'); assert.equal(result.ios.buildNumber, '47');
    assert.equal(result.android.versionCode, 47);
    assert.equal(result.ios.bundleIdentifier, config.ios.bundleIdentifier);
    assert.equal(result.android.package, config.android.package);
  }
  assert.equal(config.ios.buildNumber, undefined); assert.equal(config.android.versionCode, undefined);
  assert.equal(configLoader()({ config }), config);
});

test('Expo configuration rejects noncanonical or out-of-range build numbers', () => {
  for (const value of ['', '0', '01', '-1', '+1', ' 1', '1.2', '1e2', '2100000001'])
    assert.throws(() => configLoader(value)({ config: productionConfig() }), { code: 'INVALID_BUILD_NUMBER' });
});

function pluginLoader(value?: string) {
  let ios!: (config: ModConfig) => ModConfig;
  let android!: (config: ModConfig) => Promise<ModConfig>;
  const module = { exports: {} };
  runInNewContext(source('../plugins/withNativeBuildNumber.cjs'), { module,
    process: { env: value === undefined ? {} : { PALI_MOBILE_BUILD_NUMBER: value } },
    require(id: string) {
      if (id === '../../../scripts/build-number.cjs') return { parseBuildNumber };
      assert.equal(id, 'expo/config-plugins');
      return { withInfoPlist(config: Config, mod: typeof ios) { ios = mod; return config; },
        withDangerousMod(config: Config, [platform, mod]: [string, typeof android]) {
          assert.equal(platform, 'android'); android = mod; return config;
        } };
    },
  });
  const plugin = module.exports as (config: Config) => Config;
  const config = productionConfig();
  if (value !== undefined && /^\d+$/.test(value)) { config.ios.buildNumber = value; config.android.versionCode = Number(value); }
  assert.equal(plugin(config), config);
  return { config, ios: () => ios({ ...config, modResults: {} }), android: () => android({ ...config, modResults: {} }) };
}

test('normal native prebuild fails on both platforms without a reservation', async () => {
  const plugin = pluginLoader();
  assert.throws(plugin.ios, /reserve a Pali build number/);
  await assert.rejects(plugin.android(), /reserve a Pali build number/);
});

test('native plugin writes the reserved iOS build number and accepts matching Android versionCode', async () => {
  const plugin = pluginLoader('47');
  assert.equal(plugin.ios().modResults.CFBundleVersion, '47');
  assert.equal((await plugin.android()).android.versionCode, 47);
  assert.equal(plugin.config.version, '5.0.0');
});

test('native plugin rejects mismatched and malformed configured numbers on both platforms', async () => {
  for (const value of ['0', '01', '2100000001']) {
    const plugin = pluginLoader(value);
    assert.throws(plugin.ios, { code: 'INVALID_BUILD_NUMBER' });
    await assert.rejects(plugin.android(), { code: 'INVALID_BUILD_NUMBER' });
  }
  const mismatch = pluginLoader('47'); mismatch.config.android.versionCode = 48;
  assert.throws(mismatch.ios, /must match the reserved number/);
  await assert.rejects(mismatch.android(), /must match the reserved number/);
});

test('only exact qualification identities with the qualification slug bypass normal build numbering', async () => {
  for (const identity of ['com.paliwallet.qualification', 'com.paliwallet.qualification.physical.import',
    'com.paliwallet.qualification.physical.generate', 'com.paliwallet.qualification.physical.slh']) {
    const plugin = pluginLoader();
    plugin.config.slug = 'pali-native-qualification';
    plugin.config.ios.bundleIdentifier = identity; plugin.config.android.package = identity;
    assert.equal(plugin.ios().modResults.CFBundleVersion, undefined);
    assert.equal((await plugin.android()).android.versionCode, undefined);
  }
  for (const [identity, slug] of [['com.paliwallet.qualification', 'pali-wallet'],
    ['com.paliwallet.qualification.other', 'pali-native-qualification'], ['com.example.app', 'pali-native-qualification']]) {
    const plugin = pluginLoader();
    plugin.config.slug = slug;
    plugin.config.ios.bundleIdentifier = identity!; plugin.config.android.package = identity!;
    assert.throws(plugin.ios, /Unrecognized Pali native build identity/);
    await assert.rejects(plugin.android(), /Unrecognized Pali native build identity/);
  }
});
