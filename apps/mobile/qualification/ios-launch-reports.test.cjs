const assert = require('node:assert/strict');
const test = require('node:test');
const { Buffer } = require('node:buffer');
const fs = require('node:fs');
const { readFileSync, constants } = fs;
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { runInNewContext } = require('node:vm');
const { captureIosLaunchReports } = require('./ios-launch-reports.cjs');
const { launchIos } = require('./native-readiness.cjs');
const { createCommandRunner } = require('./command-runner.cjs');
const { importedEvidence } = require('./imported-report-fixture.cjs');
const { expectedQuickCryptoIdentity } = require('./report-validation.cjs');
const { CHECKS } = require('./simulator-contract.cjs');

const DEVICE = '11111111-2222-3333-4444-555555555555';
const RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-26-5';
const SECRET = 'synthetic_private_value_do_not_persist';
const report = (changes = {}) => ({ version: 1, status: 'failed', phase: 'create', scenario: 'import', platform: 'ios',
  checks: [], failedStage: 'parameters', cryptoDiagnostic: { bootstrap: 'unchecked' }, storageDiagnostic: {}, ...changes });

function filesFixture(files, { statSize, chunkSize = Infinity, regular = true } = {}) {
  const descriptors = new Map(), reads = [], closed = [], opened = [];
  let next = 0;
  const fs = {
    openSync(file, mode) {
      opened.push(file); assert.equal(mode, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
      const name = file.split('/').at(-1);
      if (!Object.hasOwn(files, name)) throw Object.assign(Error(SECRET), { code: 'ENOENT' });
      const descriptor = next++;
      descriptors.set(descriptor, { bytes: Buffer.from(files[name]), offset: 0 }); return descriptor;
    },
    fstatSync(descriptor) { return { isFile: () => regular, size: statSize ?? descriptors.get(descriptor).bytes.length }; },
    readSync(descriptor, target, offset, length, position) {
      assert.equal(position, null); reads.push(length);
      const entry = descriptors.get(descriptor);
      const count = Math.min(length, chunkSize, entry.bytes.length - entry.offset);
      entry.bytes.copy(target, offset, entry.offset, entry.offset + count); entry.offset += count; return count;
    },
    closeSync(descriptor) { closed.push(descriptor); },
  };
  return { fs, reads, closed, opened };
}

const filename = (phase) => `pali-native-qualification-${phase}.json`;

test('special report paths cannot block collection or follow a link outside the container', { skip: process.platform === 'win32' }, () => {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-launch-reports-'));
  try {
    const documents = path.join(container, 'Documents'); fs.mkdirSync(documents);
    const fifo = path.join(documents, filename('startup'));
    const made = spawnSync('mkfifo', [fifo], { timeout: 2000 });
    assert.equal(made.status, 0, 'FIFO fixture must be available on native qualification hosts');
    const external = path.join(container, 'outside-report.json');
    fs.writeFileSync(external, JSON.stringify(report()));
    fs.symlinkSync(external, path.join(documents, filename('create')));
    const child = spawnSync(process.execPath, ['--import', require.resolve('../scripts/register-shared-test-dependencies.mjs'), '-e', `
      const assert = require('node:assert/strict');
      const { captureIosLaunchReports } = require(${JSON.stringify(require.resolve('./ios-launch-reports.cjs'))});
      let count = 0;
      captureIosLaunchReports(require('node:fs'), process.argv[1], 'import', (value) => {
        count++;
        assert.deepEqual(value.reports.map(({ availability }) => availability), ['unavailable', 'unavailable']);
      });
      assert.equal(count, 1);
    `, container], { timeout: 2000, encoding: 'utf8' });
    assert.equal(child.error, undefined, 'diagnostics must not wait for a FIFO writer');
    assert.equal(child.status, 0, child.stderr);
  } finally { fs.rmSync(container, { recursive: true, force: true }); }
});

function collect(files, options) {
  const fixture = filesFixture(files, options); let evidence;
  captureIosLaunchReports(fixture.fs, '/owned-container', 'import', (value) => { evidence = value; });
  return { ...fixture, evidence, text: `${JSON.stringify(evidence, null, 2)}\n` };
}

test('failed launch reports retain only validated checkpoints and no private values', () => {
  const startup = report({ phase: 'unknown', scenario: 'unknown', osVersion: SECRET, sessionId: SECRET });
  const created = report({ failedStage: SECRET, checks: [{ name: SECRET, durationMs: 1 }],
    cryptoEvidence: { private: SECRET }, address: SECRET, fingerprint: SECRET,
    cryptoDiagnostic: { bootstrap: 'provider-context' }, storageDiagnostic: {} });
  const result = collect({ [filename('startup')]: JSON.stringify(startup), [filename('create')]: JSON.stringify(created) }, { chunkSize: 23 });
  assert.deepEqual(result.evidence, { version: 1, kind: 'ios-launch-failure-reports', diagnosticOnly: true, reports: [
    { filePhase: 'startup', availability: 'available', reportedStatus: 'failed', reportedPhase: 'unknown', reportedScenario: 'unknown',
      completedCheckCount: 0, failedStage: 'parameters', cryptoDiagnostic: { bootstrap: 'unchecked' }, storageDiagnostic: {} },
    { filePhase: 'create', availability: 'available', reportedStatus: 'failed', reportedPhase: 'create', reportedScenario: 'import',
      completedCheckCount: 1, failedStage: 'unrecognized', cryptoDiagnostic: { bootstrap: 'provider-context' }, storageDiagnostic: {} },
  ] });
  assert(!result.text.includes(SECRET)); assert(Buffer.byteLength(result.text) <= 8192);
  assert.equal(result.closed.length, 2); assert(result.reads.every((length) => length <= 100001));
});

test('missing, nonregular, malformed, mismatched and oversized reports remain diagnostic-only', () => {
  const invalid = [null, [], {}, report({ platform: 'android' }), report({ phase: 'restart' }), report({ scenario: 'generate' }),
    report({ checks: [{ name: 'check', durationMs: -1 }] }), report({ checks: Array(65).fill({ name: 'check', durationMs: 1 }) }),
    report({ checks: [{ name: 'check', durationMs: 1, private: SECRET }] }),
    report({ cryptoDiagnostic: { bootstrap: SECRET } }), report({ storageDiagnostic: { message: SECRET } }),
    report({ private: SECRET })];
  for (const value of ['malformed JSON', ...invalid.map((value) => JSON.stringify(value))]) {
    const result = collect({ [filename('create')]: value });
    assert.deepEqual(result.evidence.reports.map(({ availability }) => availability), ['unavailable', 'invalid']);
    assert(!result.text.includes(SECRET));
  }
  const oversized = collect({ [filename('create')]: ' '.repeat(100001) });
  assert.equal(oversized.evidence.reports[1].availability, 'oversized'); assert.equal(oversized.reads.length, 0);
  const growing = collect({ [filename('create')]: ' '.repeat(200000) }, { statSize: 0 });
  assert.equal(growing.evidence.reports[1].availability, 'oversized'); assert.deepEqual(growing.reads, [100001]);
  assert.equal(growing.closed.length, 1);
  const directory = collect({ [filename('create')]: '{}' }, { regular: false });
  assert.equal(directory.evidence.reports[1].availability, 'unavailable'); assert.equal(directory.reads.length, 0);
});

test('failed WalletConnect stage and bounded assertion survive iOS diagnostic projection', () => {
  const diagnostic = { substage: 'close', errorName: 'Error', errorCode: 'WALLETCONNECT_NATIVE_DISPOSAL_SIGNAL' };
  const created = report({ failedStage: 'native WalletConnect lifecycle', walletConnectDiagnostic: diagnostic });
  const result = collect({ [filename('create')]: JSON.stringify(created) });
  assert.deepEqual(result.evidence.reports[1], {
    filePhase: 'create', availability: 'available', reportedStatus: 'failed',
    reportedPhase: 'create', reportedScenario: 'import', completedCheckCount: 0,
    failedStage: 'native WalletConnect lifecycle', walletConnectDiagnostic: diagnostic,
    cryptoDiagnostic: { bootstrap: 'unchecked' }, storageDiagnostic: {},
  });
  for (const invalid of [
    { ...diagnostic, errorCode: SECRET },
    { ...diagnostic, message: SECRET },
    { ...diagnostic, topic: SECRET },
  ]) {
    const rejected = collect({ [filename('create')]: JSON.stringify({ ...created, walletConnectDiagnostic: invalid }) });
    assert.equal(rejected.evidence.reports[1].availability, 'invalid');
    assert(!rejected.text.includes(SECRET));
  }
});

test('exact input byte limit is accepted but UTF-8 bytes over it are refused before reading', () => {
  const json = JSON.stringify(report());
  const exact = collect({ [filename('create')]: json + ' '.repeat(100000 - Buffer.byteLength(json)) });
  assert.equal(exact.evidence.reports[1].availability, 'available');
  const wide = collect({ [filename('create')]: json + 'é'.repeat(50000) });
  assert.equal(wide.evidence.reports[1].availability, 'oversized'); assert.equal(wide.reads.length, 0);
});

function passedReport() {
  return report({ status: 'passed', failedStage: undefined, checks: CHECKS.map(name => ({ name, durationMs: 1 })), quickCryptoIdentity: expectedQuickCryptoIdentity, networkCalls: 0,
    nativeHdAccountsVerified: true, nativeHdKeyRevealVerified: true, selectedAccountId: 'hd:60:1', selectedAccountIndex: 1,
    journalContainerVersion: 1, firstTransferHash: '0x' + 'c'.repeat(64), transferHash: '0x' + 'b'.repeat(64),
    address: '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0', storageDiagnostic: { stage: 'ready' },
    nativeErc20Verified: true, erc20AccountId: 'hd:60:2', erc20AccountIndex: 2, erc20Address: '0xb6716976A3ebe8D39aCEB04372f22Ff8e6802D7A',
    erc20TransferHash: '0x' + 'd'.repeat(64), erc20IntentHash: '0x' + 'e'.repeat(64), erc20Signatures: 1, erc20Authorizations: 0,
    erc20InjectedBroadcasts: 1, erc20RestoredFromJournal: false,
    nativeNevmVerified: true, nevmAccountId: 'hd:60:3', nevmAccountIndex: 3, nevmAddress: '0xF3f50213C1d2e255e4B2bAD430F8A38EEF8D718E',
    nevmTransferHash: '0x' + '7'.repeat(64), nevmEthereumTransferHash: '0x' + '8'.repeat(64), nevmChainId: '5700',
    nevmJournalContainerVersion: 1, nevmRestoredFromJournal: false,
    nativeZksysVerified: true, zksysAccountId: 'hd:60:4', zksysAccountIndex: 4, zksysAddress: '0x51cA8ff9f1C0a99f88E86B8112eA3237F55374cA',
    zksysTransferHash: '0x' + '9'.repeat(64), zksysChainId: '57057', zksysJournalContainerVersion: 1, zksysSignatures: 1,
    zksysAuthorizations: 0, zksysInjectedBroadcasts: 1, zksysFeeEstimates: 2, zksysRestoredFromJournal: false,
    ...importedEvidence() });
}

async function actualRunner({ created = report(), writeFailure = false, readFailure = false, http = false, reportFailure = false } = {}) {
  const events = [], writes = [];
  let launchError, validationError, reportedError;
  const files = filesFixture({ [filename('create')]: JSON.stringify(created) });
  const process = { env: { CI: 'true', PALI_NATIVE_QUALIFICATION: '1', QUALIFICATION_ARTIFACTS: '/output',
    ...(http ? { PALI_NATIVE_HTTP_QUALIFICATION: '1' } : {}),
    ...((http || reportFailure) ? { GITHUB_SHA: 'e0919d07b33ae36be8b5100555703e5cb1c786cf' } : {}) },
    argv: ['node', 'runner', 'ios', '/app', ...(reportFailure ? ['--ios-simulator-contract'] : [])], exitCode: 0 };
  await runInNewContext(readFileSync(require.resolve('./run-native.cjs'), 'utf8'), {
    require(name) {
      if (name === 'fs') return { ...files.fs, existsSync: (file) => !file.endsWith('/ios-qualification.json'), mkdirSync() {},
        openSync(file, mode) { events.push(['read', file]); if (readFailure) throw Error(SECRET); return files.fs.openSync(file, mode); },
        readFileSync(file) {
          if (reportFailure && file.endsWith('/' + filename('create'))) return JSON.stringify(created);
          throw Error('fixture load errors absent');
        },
        writeFileSync(file, data) {
          events.push(['write', file]);
          if (writeFailure && /-(launch-reports|failure-reports)\.json$/.test(file)) throw Error(SECRET);
          writes.push({ file, data });
        } };
      if (name === 'child_process') return { spawnSync(command, args) {
        events.push(args); let stdout = '';
        if (command === 'plutil') stdout = args.includes('CFBundleIdentifier') ? 'com.paliwallet.qualification' :
          args.includes('DTPlatformName') ? 'iphonesimulator' : 'PaliQualification';
        else if (args.includes('runtimes')) stdout = JSON.stringify({ runtimes: [{ identifier: RUNTIME, version: '26.5', isAvailable: true }] });
        else if (args.includes('devicetypes')) stdout = JSON.stringify({ devicetypes: [{ identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17' }] });
        else if (args[1] === 'create') stdout = DEVICE;
        else if (args[1] === 'get_app_container') stdout = '/owned-container';
        else if (args.includes('devices')) stdout = JSON.stringify({ devices: { [RUNTIME]: [{ udid: DEVICE, isAvailable: true, state: 'Booted' }] } });
        else if (args.includes('launchctl')) stdout = '12\t0\tcom.apple.SpringBoard\n';
        else if (args[1] === 'launch' && !reportFailure) return { status: null, signal: 'SIGTERM', error: Object.assign(Error('launch timeout'), { code: 'ETIMEDOUT' }) };
        return { status: 0, stdout };
      } };
      if (name === '../scripts/qualification-sdk.cjs') return {
        readWalletConnectSdkIdentity(root) {
          assert.equal(root, path.dirname(path.dirname(require.resolve('./run-native.cjs'))));
          return 'fixture-walletconnect-identity';
        },
      };
      if (name === './http-companion.cjs') return { async startHttpCompanion({ platform, sourceRevision, walletConnectIdentity }) {
        assert.equal(http, true, 'the fixture must never start a real HTTP companion');
        assert.equal(walletConnectIdentity, 'fixture-walletconnect-identity');
        events.push(['http-start', platform, sourceRevision]);
        return {
          async begin(phase, scenario) {
            events.push(['http-begin', phase, scenario]);
            await Promise.resolve();
            events.push(['http-ready']);
            return '&httpPort=48123&httpToken=0123456789abcdef0123456789abcdef';
          },
          async verify() { events.push(['http-verify']); assert.fail('a failed launch cannot verify HTTP qualification'); },
          assertComplete() { events.push(['http-complete']); assert.fail('a failed launch cannot complete HTTP qualification'); },
          async diagnostics() { events.push(['http-diagnostic']); return undefined; },
          async close() { events.push(['http-close']); },
        };
      } };
      if (name === './report-validation.cjs') {
        const original = require(name);
        return { ...original, decodeNativeReport(...args) {
          try { return original.decodeNativeReport(...args); }
          catch (error) { validationError = error; throw error; }
        } };
      }
      if (name === './command-runner.cjs') {
        const original = require(name);
        return { ...original, createCommandRunner(...args) {
          const command = original.createCommandRunner(...args);
          const run = (...inputs) => {
            try { return command(...inputs); }
            catch (error) { if (inputs[1][1] === 'launch') launchError = error; throw error; }
          };
          run.binary = command.binary; return run;
        }, describeQualificationFailure(error, ...args) {
          reportedError = error; return original.describeQualificationFailure(error, ...args);
        } };
      }
      return require(name);
    }, process, console: { log() {}, error() {} }, setTimeout,
    __dirname: path.dirname(require.resolve('./run-native.cjs')),
  });
  return { events, writes, process, launchError, validationError, reportedError, reportReads: files.reads, closedReports: files.closed };
}

test('actual runner records an existing passed report without promoting its timed-out launch', async () => {
  const result = await actualRunner({ created: passedReport() });
  const diagnostic = JSON.parse(result.writes.find(({ file }) => file.endsWith('-launch-reports.json')).data);
  assert.equal(diagnostic.reports[1].availability, 'available');
  assert.equal(diagnostic.reports[1].reportedStatus, 'passed');
  assert.equal(diagnostic.diagnosticOnly, true);
  assert.equal(result.process.exitCode, 1);
  assert.equal(result.reportedError, result.launchError);
  assert.equal(result.events.filter((args) => args[1] === 'launch').length, 1);
  const collected = result.events.findIndex((args) => args[0] === 'write' && args[1].endsWith('-launch-reports.json'));
  assert(collected >= 0 && result.events.findIndex((args) => args[1] === 'delete') > collected);
  assert.deepEqual(result.events.filter((args) => ['shutdown', 'delete'].includes(args[1])).map((args) => [args[1], args[2]]), [['shutdown', DEVICE], ['delete', DEVICE]]);
  const failure = JSON.parse(result.writes.find(({ file }) => file.endsWith('ios-failure.json')).data);
  assert.equal(failure.failure.errorCode, 'ETIMEDOUT'); assert.equal(failure.failure.args[1], 'launch');
  assert(!result.writes.some(({ file }) => /ios-(qualification|simulator-limited)\.json$/.test(file)));
});

test('actual runner keeps launch failure and owned cleanup after read or diagnostic-write failures', async () => {
  for (const options of [{ readFailure: true }, { writeFailure: true }]) {
    const result = await actualRunner(options);
    assert.equal(result.process.exitCode, 1);
    assert.equal(result.reportedError, result.launchError);
    const failure = JSON.parse(result.writes.find(({ file }) => file.endsWith('ios-failure.json')).data);
    assert.equal(failure.failure.errorCode, 'ETIMEDOUT');
    assert.equal(result.events.filter((args) => args[1] === 'launch').length, 1);
    assert(result.events.some((args) => args[1] === 'delete' && args[2] === DEVICE));
    assert(!JSON.stringify(result.writes).includes(SECRET));
  }
});

test('actual runner keeps a rejected HTTP-stage report diagnostic-only after a successful launch', async () => {
  const created = report({ failedStage: 'native HTTP transport', checks: [{ name: SECRET, durationMs: 1 }] });
  for (const options of [{}, { readFailure: true }, { writeFailure: true }]) {
    const result = await actualRunner({ created, reportFailure: true, ...options });
    assert.equal(result.process.exitCode, 1);
    assert(result.validationError);
    assert.equal(result.reportedError, result.validationError);
    const failure = JSON.parse(result.writes.find(({ file }) => file.endsWith('/ios-failure.json')).data);
    assert.equal(failure.failure.message, 'Unexpected iOS Simulator refusal evidence');
    const suffix = '-create-failure-reports.json';
    const evidence = result.writes.find(({ file }) => file.endsWith(suffix));
    if (options.writeFailure) assert.equal(evidence, undefined);
    else {
      const diagnostic = JSON.parse(evidence.data);
      assert.equal(diagnostic.diagnosticOnly, true);
      assert.equal(diagnostic.kind, 'ios-create-failure-reports');
      assert.deepEqual(diagnostic.reports[1], options.readFailure
        ? { filePhase: 'create', availability: 'unavailable' }
        : { filePhase: 'create', availability: 'available', reportedStatus: 'failed', reportedPhase: 'create',
          reportedScenario: 'import', completedCheckCount: 1, failedStage: 'native HTTP transport',
          cryptoDiagnostic: { bootstrap: 'unchecked' }, storageDiagnostic: {} });
    }
    const launch = result.events.findIndex((args) => args[1] === 'launch');
    const capture = result.events.findIndex((args) => args[0] === 'write' && args[1].endsWith(suffix));
    const cleanup = result.events.findIndex((args) => args[1] === 'delete');
    assert(launch >= 0 && capture > launch && cleanup > capture);
    assert(!JSON.stringify(result.writes).includes(SECRET));
    assert(!result.writes.some(({ file }) => /ios-(?:qualification|simulator-limited|import-create)\.json$/.test(file)));
  }
});

test('actual runner preserves WalletConnect diagnostics without accepting them as simulator refusal', async () => {
  const diagnostic = { substage: 'pair', errorName: 'Error', errorCode: 'WALLETCONNECT_NATIVE_ABORT_ACCEPTED' };
  const created = report({ failedStage: 'native WalletConnect lifecycle', walletConnectDiagnostic: diagnostic });
  const result = await actualRunner({ created, reportFailure: true });
  assert.equal(result.process.exitCode, 1);
  assert.equal(result.reportedError, result.validationError);
  const evidence = JSON.parse(result.writes.find(({ file }) => file.endsWith('-create-failure-reports.json')).data);
  assert.equal(evidence.diagnosticOnly, true);
  assert.equal(evidence.reports[1].failedStage, 'native WalletConnect lifecycle');
  assert.deepEqual(evidence.reports[1].walletConnectDiagnostic, diagnostic);
  assert(result.events.some((args) => args[1] === 'delete' && args[2] === DEVICE));
});

test('actual HTTP runner awaits its public launch token and captures bounded reports before failed-launch cleanup', async () => {
  const result = await actualRunner({ created: passedReport(), http: true });
  assert.deepEqual(result.events.filter((event) => event[0] === 'http-start'),
    [['http-start', 'ios', result.process.env.GITHUB_SHA]]);
  assert.deepEqual(result.events.filter((event) => event[0] === 'http-begin'), [['http-begin', 'create', 'import']]);
  const launches = result.events.filter((args) => args[1] === 'launch');
  assert.deepEqual(launches, [['simctl', 'launch', DEVICE, 'com.paliwallet.qualification', '-PaliQualificationURL',
    'pali-wallet-qualification://run?phase=create&scenario=import&httpPort=48123&httpToken=0123456789abcdef0123456789abcdef']]);
  const launched = result.events.indexOf(launches[0]);
  const ready = result.events.findIndex((event) => event[0] === 'http-ready');
  assert(ready >= 0 && ready < launched);
  const diagnosticWrite = result.writes.find(({ file }) => file.endsWith('-launch-reports.json'));
  assert(diagnosticWrite);
  assert(Buffer.byteLength(diagnosticWrite.data) <= 8192);
  const diagnostic = JSON.parse(diagnosticWrite.data);
  assert.equal(diagnostic.diagnosticOnly, true);
  assert.deepEqual(diagnostic.reports.map(({ availability }) => availability), ['unavailable', 'available']);
  assert.equal(diagnostic.reports[1].reportedStatus, 'passed');
  assert(result.reportReads.length > 0 && result.reportReads.every((length) => length <= 100001));
  assert.equal(result.closedReports.length, 1);
  const collected = result.events.findIndex((event) => event[0] === 'write' && event[1] === diagnosticWrite.file);
  const shutdown = result.events.findIndex((args) => args[1] === 'shutdown');
  const deleted = result.events.findIndex((args) => args[1] === 'delete');
  const closed = result.events.findIndex((event) => event[0] === 'http-close');
  assert(launched < collected && collected < shutdown && shutdown < deleted && deleted < closed);
  assert.deepEqual(result.events.filter((args) => ['shutdown', 'delete'].includes(args[1])).map((args) => [args[1], args[2]]),
    [['shutdown', DEVICE], ['delete', DEVICE]]);
  assert.equal(result.events.filter((event) => event[0] === 'http-close').length, 1);
  assert.equal(result.events.filter((event) => ['http-verify', 'http-complete'].includes(event[0])).length, 0);
  assert.equal(result.process.exitCode, 1);
  assert(result.launchError);
  assert.equal(result.reportedError, result.launchError);
  const failure = JSON.parse(result.writes.find(({ file }) => file.endsWith('ios-failure.json')).data);
  assert.equal(failure.sourceRevision, result.process.env.GITHUB_SHA);
  assert.equal(failure.failure.errorCode, 'ETIMEDOUT');
  assert.equal(failure.failure.args.at(-1), launches[0].at(-1));
  assert(!result.writes.some(({ file }) => /ios-(qualification|simulator-limited)\.json$/.test(file)));
});

test('typed log-query failures retain bounded classification and the exact original launch error', () => {
  for (const queryResult of [{ status: 64, stderr: SECRET, stdout: SECRET },
    { status: null, signal: 'SIGTERM', error: Object.assign(Error(SECRET), { code: 'ETIMEDOUT' }) },
    { status: null, signal: SECRET, error: Object.assign(Error(SECRET), { code: SECRET }) }]) {
    const calls = [], records = [], times = [0, 180000, 180010, 180020, 190020];
    const primary = Error('original launch error');
    const commands = createCommandRunner((command, args, options) => {
      calls.push({ command, args, options });
      return args.includes('launchctl') ? { status: 0, stdout: '' } : queryResult;
    });
    const run = (command, args, ...rest) => { if (args[1] === 'launch') throw primary; return commands(command, args, ...rest); };
    assert.throws(() => launchIos(run, DEVICE, 'public-link', (value) => records.push(value), () => times.shift()), (error) => error === primary);
    const diagnostic = records[0].logQueryFailure;
    assert.equal(diagnostic.kind, 'command'); assert.equal(diagnostic.elapsedMs, 10000); assert.equal(diagnostic.timeoutMs, 10000);
    assert.equal(diagnostic.status, queryResult.status); assert.equal(diagnostic.timedOut, queryResult.error?.code === 'ETIMEDOUT');
    assert.equal(diagnostic.errorCode, queryResult.error?.code === SECRET ? 'other' : queryResult.error?.code ?? null);
    assert.equal(diagnostic.signal, queryResult.signal === SECRET ? 'other' : queryResult.signal ?? null);
    assert.equal(records[0].logsAvailable, false); assert.equal(records[0].logCountConfidence, 'unavailable');
    assert(calls.every(({ args }) => args[2] === DEVICE)); assert.equal(calls.length, 2);
    assert(!JSON.stringify(records).includes(SECRET)); assert(JSON.stringify(records).length < 2048);
  }
});

test('unclassified log-query errors retain no message and diagnostic write cannot replace launch failure', () => {
  const primary = Error('original'); const values = [];
  const run = (_command, args) => { if (args[1] === 'launch') throw primary; if (args.includes('log')) throw Error(SECRET); return ''; };
  assert.throws(() => launchIos(run, DEVICE, 'public-link', (value) => { values.push(value); throw Error('write failure'); }), (error) => error === primary);
  assert.equal(values[0].logQueryFailure.kind, 'unclassified');
  assert.equal(values[0].logQueryFailure.status, null); assert.equal(values[0].logQueryFailure.timedOut, null);
  assert(!JSON.stringify(values).includes(SECRET));
});

test('log-query elapsed time is bounded without pretending an invalid clock is a valid duration', () => {
  for (const [duration, expected, truncated] of [[700000, 600000, true], [-1, null, false]]) {
    const records = [], times = [0, 180000, 180010, 180020, 180020 + duration];
    const run = (_command, args) => { if (args[1] === 'launch' || args.includes('log')) throw Error('fixture'); return ''; };
    assert.throws(() => launchIos(run, DEVICE, 'public-link', (value) => records.push(value), () => times.shift()));
    assert.equal(records[0].logQueryFailure.elapsedMs, expected);
    assert.equal(records[0].logQueryFailure.elapsedTruncated, truncated);
  }
});

test('large discarded fields cannot grow the diagnostic output and public fixture credentials are rejected', () => {
  const large = collect({ [filename('create')]: JSON.stringify(report({ sessionId: SECRET.repeat(1500) })) });
  assert.equal(large.evidence.reports[1].availability, 'available');
  assert(Buffer.byteLength(large.text) < 1024); assert(!large.text.includes(SECRET));
  const credentials = collect({ [filename('create')]: JSON.stringify(report({ sessionId: 'PUBLIC native qualification password 2026!' })) });
  assert.equal(credentials.evidence.reports[1].availability, 'invalid');
  assert(!credentials.text.includes('PUBLIC native qualification password'));
});
