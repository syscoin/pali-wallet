const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const { createCommandRunner, describeQualificationFailure } = require('./command-runner.cjs');
const { prepareAndroidRoot, launchIos, summarizeIosLaunch } = require('./native-readiness.cjs');
const PACKAGE = 'com.paliwallet.qualification';
const closed = { status: 1, stdout: '', stderr: 'adb: unable to connect for root: closed\n' };
const ok = (stdout = '') => ({ status: 0, stdout });
function rootFixture(rootResult, uid = '0') {
  const calls = [], evidence = [];
  const run = createCommandRunner((command, args, options) => {
    calls.push({ command, args, timeout: options.timeout });
    return args[0] === 'root' ? rootResult : args[0] === 'shell' ? ok(uid) : ok();
  });
  return { calls, evidence, invoke: () => prepareAndroidRoot(run, (value) => evidence.push(value)) };
}

test('Android ACK still requires uid0 and bounded setup commands', () => {
  const f = rootFixture(ok('restarting adbd as root')); f.invoke();
  assert.deepEqual(f.calls.map((call) => call.args), [['wait-for-device'], ['root'], ['wait-for-device'], ['shell', 'id', '-u']]);
  assert.deepEqual(f.calls.map((call) => call.timeout), [30000, 30000, 30000, 10000]);
  assert.deepEqual(f.evidence, [{ version: 1, status: 'ready', stage: 'uid', rootTransportRecovered: false }]);
});

test('Android exact closed transport recovers with uid0 without a second root request', () => {
  const f = rootFixture(closed); f.invoke();
  assert.equal(f.calls.filter((call) => call.args[0] === 'root').length, 1);
  assert.equal(f.evidence[0].status, 'ready');
  assert.equal(f.evidence[0].rootTransportRecovered, true);
  assert.deepEqual(f.evidence[0].rootFailure.args, ['root']);
  assert.equal(f.evidence[0].rootFailure.stderrTail, closed.stderr);
});

for (const rootResult of [ok('already running as root'), closed]) {
  for (const uid of ['2000', '', '0\n2000', 'uid=0(root)']) test(`Android ${rootResult.status ? 'closed' : 'ACK'} rejects uid ${JSON.stringify(uid)}`, () => {
    const f = rootFixture(rootResult, uid);
    assert.throws(f.invoke, /requires confirmed root uid/);
    assert.equal(f.evidence[0].status, 'failed');
    assert.equal(f.evidence[0].rootTransportRecovered, false);
  });
}

for (const failure of [
  { status: 1, stderr: 'adbd cannot run as root in production builds' },
  { status: 1, stderr: 'error: device unauthorized' },
  { status: 1, stderr: 'adb: unable to connect for root: closed\nextra unexpected text' },
  { status: null, error: Object.assign(Error('deadline'), { code: 'ETIMEDOUT' }) },
  { status: null, error: Object.assign(Error('missing'), { code: 'ENOENT' }) },
]) test(`Android does not recover other root failures: ${failure.stderr || failure.error.code}`, () => {
  const f = rootFixture(failure);
  assert.throws(f.invoke, (error) => describeQualificationFailure(error).status === failure.status);
  assert.deepEqual(f.calls.map((call) => call.args), [['wait-for-device'], ['root']]);
  assert.equal(f.evidence[0].status, 'failed');
});

test('Android failed reconnect or uid probe never reports ready and retains the initial failure', () => {
  for (const failedStage of ['reconnection', 'uid']) {
    let waits = 0; const evidence = [];
    const run = createCommandRunner((_command, args) => {
      if (args[0] === 'root') return closed;
      if (args[0] === 'wait-for-device' && ++waits === 2 && failedStage === 'reconnection')
        return { status: null, error: Object.assign(Error('deadline'), { code: 'ETIMEDOUT' }) };
      if (args[0] === 'shell') return { status: 1, stderr: 'device offline' };
      return ok();
    });
    assert.throws(() => prepareAndroidRoot(run, (value) => evidence.push(value)));
    assert.equal(evidence[0].status, 'failed');
    assert.equal(evidence[0].stage, failedStage);
    assert.equal(evidence[0].rootFailure.stderrTail, closed.stderr);
  }
});

test('Android evidence write failure blocks readiness and preserves an earlier setup failure', () => {
  const run = createCommandRunner((_command, args) => args[0] === 'shell' ? ok('0') : ok());
  assert.throws(() => prepareAndroidRoot(run, () => { throw Error('artifact write failed'); }), /artifact write failed/);
  const bad = createCommandRunner((_command, args) => args[0] === 'root' ? { status: 9, stderr: 'root failure' } : ok());
  assert.throws(() => prepareAndroidRoot(bad, () => { throw Error('artifact write failed'); }), (error) => describeQualificationFailure(error).status === 9);
});

test('iOS failure collects bounded owned-device summaries without relaunching or retaining messages', () => {
  const calls = [], evidence = [], secret = 'synthetic_secret_that_must_not_be_written';
  const processImagePath = '/private/fixture/PaliQualification.app/PaliQualification';
  const wall = [Date.UTC(2026, 10, 6, 15, 3), Date.UTC(2026, 10, 6, 15, 6)];
  const run = createCommandRunner((_command, args, options) => {
    calls.push({ args, timeout: options.timeout });
    if (args[1] === 'launch') return { status: null, signal: 'SIGTERM', error: Object.assign(Error('launch deadline'), { code: 'ETIMEDOUT' }) };
    if (args.includes('launchctl')) return ok(`PID\tStatus\tLabel\n12\t0\tcom.apple.SpringBoard\n34\t0\tUIKitApplication:${PACKAGE}[public]\n${secret}`);
    if (args.at(-1) === 'process == "PaliQualification"')
      return ok(JSON.stringify({ processImagePath, processID: 42, timestamp: '2026-11-06 15:04:30.100000+0000', eventMessage: secret }));
    return ok(JSON.stringify({ eventMessage: `${PACKAGE} launch failed timeout ${secret}` }) + '\n' + JSON.stringify({ eventMessage: `another.app ${secret}` }));
  });
  const times = [0, 180000, 180005];
  assert.throws(() => launchIos(run, 'owned-simulator', 'public-link', (value) => evidence.push(value), () => times.shift(), () => wall.shift()),
    (error) => describeQualificationFailure(error).errorCode === 'ETIMEDOUT');
  assert.equal(calls.filter((call) => call.args[1] === 'launch').length, 1);
  assert(calls.every((call) => call.args[2] === 'owned-simulator'));
  assert.deepEqual(calls.map((call) => call.timeout), [180000, 10000, 10000, 10000]);
  assert.equal(calls[2].args[calls[2].args.indexOf('--last') + 1], '5m');
  assert.deepEqual(evidence, [{ version: 3, stage: 'launch', elapsedMs: 180000, lookbackMinutes: 5, servicesAvailable: true, servicesTruncated: false,
    appServiceListed: true, appPidPresent: true, springboardPidPresent: true, logsAvailable: true,
    logsTruncated: false, logParseErrors: 0, fullAttemptRequested: true,
    logCounts: { matched: 1, failure: 1, timeout: 1, termination: 0 },
    logCountConfidence: 'complete-for-query', logCountScope: 'selected-system-processes-with-package-marker', appPriorProcess: 'observed' }]);
  assert(!JSON.stringify(evidence).includes(secret));
  assert(!JSON.stringify(evidence).includes(processImagePath));
});

test('iOS success needs no diagnostics and broken diagnostics cannot replace the launch failure', () => {
  let calls = 0;
  const run = createCommandRunner(() => { calls++; return ok('public PID'); });
  assert.equal(launchIos(run, 'owned-simulator', 'public-link', () => assert.fail('unexpected diagnostics')), 'public PID');
  assert.equal(calls, 1);
  const primary = Error('original launch failed');
  const broken = (_command, args) => { if (args[1] === 'launch') throw primary; throw Error('collector failed'); };
  assert.throws(() => launchIos(broken, 'owned-simulator', 'public-link', () => { throw Error('write failed'); }), (error) => error === primary);
});

test('iOS summary discards malformed messages and bounds input before parsing', () => {
  const summary = summarizeIosLaunch(null, 'not JSON\n' + ' '.repeat(262144) + JSON.stringify({ eventMessage: `${PACKAGE} crash` }), true);
  assert.deepEqual(summary.logCounts, { matched: 0, failure: 0, timeout: 0, termination: 0 });
  assert.equal(summary.servicesAvailable, false);
  assert.equal(summary.logsTruncated, true);
  assert.equal(summary.logParseErrors, 1);
  assert.equal(summary.logCountConfidence, 'lower-bound');
});

async function runActualAndroid(rootResult, uid) {
  const source = readFileSync(require.resolve('./run-native.cjs'), 'utf8');
  const calls = [], writes = [];
  const spawn = (_command, args) => {
    calls.push(args);
    if (args[0] === 'dump') return ok(`package: name='${PACKAGE}'`);
    if (args[0] === 'list') return ok(['arm64-v8a', 'x86_64'].flatMap((abi) => ['libQuickCrypto.so', 'libNitroModules.so', 'libexpo-sqlite.so'].map((file) => `lib/${abi}/${file}`)).join('\n'));
    if (args[0] === 'root') return rootResult;
    if (args[0] === 'shell' && args[1] === 'id') return ok(uid);
    if (args[0] === 'install') return { status: 7, stderr: 'intentional stop after setup proof' };
    return ok();
  };
  const fakeProcess = { env: { CI: 'true', PALI_NATIVE_QUALIFICATION: '1', ANDROID_HOME: '/public-sdk', QUALIFICATION_ARTIFACTS: '/public-output' }, argv: ['node', 'runner', 'android', '/public-app'], exitCode: 0 };
  await runInNewContext(source, {
    require(name) {
      if (name === 'fs') return { existsSync: () => true, mkdirSync() {}, readdirSync: () => ['37.0.0'], writeFileSync(file, data) { writes.push({ file, data }); } };
      if (name === 'child_process') return { spawnSync: spawn };
      return require(name);
    }, process: fakeProcess, console: { error() {}, log() {} }, setTimeout,
  });
  return { calls, writes, fakeProcess };
}

test('real Android runner installs only after closed recovery plus uid0 and preserves recovery evidence', async () => {
  const f = await runActualAndroid(closed, '0');
  assert(f.calls.some((args) => args[0] === 'install'));
  assert.equal(f.calls.filter((args) => args[0] === 'root').length, 1);
  const ready = JSON.parse(f.writes.find((entry) => entry.file.endsWith('android-root-readiness.json')).data);
  assert.equal(ready.rootTransportRecovered, true);
  assert.equal(JSON.parse(f.writes.find((entry) => entry.file.endsWith('android-failure.json')).data).failure.status, 7);
  assert.equal(f.fakeProcess.exitCode, 1);
});

test('real Android runner never touches app after nonroot proof', async () => {
  const f = await runActualAndroid(closed, '2000');
  assert(!f.calls.some((args) => ['install', 'uninstall'].includes(args[0])));
  assert.equal(f.fakeProcess.exitCode, 1);
  assert.equal(JSON.parse(f.writes.find((entry) => entry.file.endsWith('android-root-readiness.json')).data).status, 'failed');
});

test('real iOS runner preserves launch evidence before its diagnostic stock control and remains failed', async () => {
  const source = readFileSync(require.resolve('./run-native.cjs'), 'utf8');
  const events = [], writes = [];
  const fakeProcess = { env: { CI: 'true', PALI_NATIVE_QUALIFICATION: '1', QUALIFICATION_ARTIFACTS: '/public-output',
    GITHUB_SHA: 'a'.repeat(40) }, argv: ['node', 'runner', 'ios', '/public-app', '--ios-simulator-contract'], exitCode: 0 };
  let settingsRunning = false;
  const spawn = (command, args) => {
    events.push(args);
    if (command === 'plutil') return ok(args.includes('CFBundleIdentifier') ? PACKAGE :
      args.includes('DTPlatformName') ? 'iphonesimulator' : 'PaliQualification');
    if (args.includes('runtimes')) return ok(JSON.stringify({ runtimes: [{ isAvailable: true, identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5', version: '26.5' }] }));
    if (args.includes('devicetypes')) return ok(JSON.stringify({ devicetypes: [{ identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17' }] }));
    if (args.includes('create')) return ok('11111111-2222-3333-4444-555555555555');
    if (args.includes('devices')) return ok(JSON.stringify({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [
      { udid: '11111111-2222-3333-4444-555555555555', isAvailable: true, state: 'Booted' },
    ] } }));
    if (args.includes('launchctl')) return ok('12\t0\tcom.apple.SpringBoard\n' +
      (settingsRunning ? '73\t0\tUIKitApplication:com.apple.Preferences[fixture]\n' : ''));
    if (args.includes('get_app_container')) return ok('/public-container');
    if (args[3] === 'com.apple.Preferences') {
      settingsRunning = args[1] === 'launch';
      return ok(settingsRunning ? 'com.apple.Preferences: 73' : '');
    }
    if (args[1] === 'launch') return { status: null, signal: 'SIGTERM', error: Object.assign(Error('launch deadline'), { code: 'ETIMEDOUT' }) };
    return ok('');
  };
  await runInNewContext(source, {
    require(name) {
      if (name === 'fs') return { existsSync: (file) => !file.endsWith('/ios-qualification.json'),
        mkdirSync() {}, writeFileSync(file, data) { writes.push({ file, data }); events.push(['write', file]); } };
      if (name === 'child_process') return { spawnSync: spawn };
      return require(name);
    }, process: fakeProcess, console: { error() {}, log() {} }, setTimeout,
  });
  assert.equal(fakeProcess.exitCode, 1);
  assert.equal(events.filter((args) => args[1] === 'launch' && args[3] === PACKAGE).length, 1);
  const collected = events.findIndex((args) => args[0] === 'write' && args[1].endsWith('ios-import-create-launch.json'));
  const screenshot = events.findIndex((args) => args.includes('screenshot'));
  const control = events.findIndex((args) => args[1] === 'launch' && args[3] === 'com.apple.Preferences');
  const deleted = events.findIndex((args) => args[1] === 'delete');
  assert(collected > 0 && screenshot > collected && control > screenshot && deleted > control);
  assert.equal(JSON.parse(writes.find((entry) => entry.file.endsWith('ios-import-frontboard.json')).data).status, 'passed');
  const failure = JSON.parse(writes.find((entry) => entry.file.endsWith('ios-failure.json')).data);
  assert.equal(failure.failure.errorCode, 'ETIMEDOUT');
  assert.equal(failure.failure.args[1], 'launch');
  const stages = JSON.parse(writes.filter((entry) => entry.file.endsWith('ios-import-stages.json')).at(-1).data);
  assert.equal(stages.stages.at(-1).stage, 'launch-create');
  assert.equal(stages.stages.at(-1).status, 'failed');
  const ready = JSON.parse(writes.find((entry) => entry.file.endsWith('ios-import-create-readiness.json')).data);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.runtime, 'com.apple.CoreSimulator.SimRuntime.iOS-26-5');
  assert(!writes.some((entry) => entry.file.endsWith('ios-qualification.json')));
});

test('Android initial connection failure stops before root and records the failed stage', () => {
  const calls = [], evidence = [];
  const run = createCommandRunner((_command, args) => {
    calls.push(args);
    return { status: null, error: Object.assign(Error('device wait deadline'), { code: 'ETIMEDOUT' }) };
  });
  assert.throws(() => prepareAndroidRoot(run, (value) => evidence.push(value)),
    (error) => describeQualificationFailure(error).errorCode === 'ETIMEDOUT');
  assert.deepEqual(calls, [['wait-for-device']]);
  assert.deepEqual(evidence, [{ version: 1, status: 'failed', stage: 'connection', rootTransportRecovered: false }]);
});


test('iOS launch query excludes unrelated system output before the unchanged command bound', () => {
  const expected = '(process == "SpringBoard" OR process == "runningboardd" OR process == "launchd") AND eventMessage CONTAINS "com.paliwallet.qualification"';
  const primary = Error('original launch failure'), calls = [], evidence = [];
  const secret = 'synthetic_log_message_must_not_be_retained';
  const services = '12\t0\tcom.apple.SpringBoard\n';
  const messages = [
    `${PACKAGE} launch failed timeout ${secret}`,
    `unrelated.app ${secret}`,
    `${PACKAGE} exited`,
    'COM.PALIWALLET.QUALIFICATION unrelated case',
  ];
  const lines = (values) => values.map((eventMessage) => JSON.stringify({ eventMessage })).join('\n');
  const command = createCommandRunner((_command, args, options) => {
    calls.push({ args, options });
    if (args.includes('launchctl')) return ok(services);
    const predicate = args[args.indexOf('--predicate') + 1];
    if (predicate !== expected) return { status: 143, error: Object.assign(Error('unrelated system output exceeds bound'), { code: 'ENOBUFS' }) };
    return ok(lines(messages.filter((message) => message.includes(PACKAGE))));
  });
  const run = (name, args, ...rest) => { if (args[1] === 'launch') { calls.push({ args, launch: true }); throw primary; } return command(name, args, ...rest); };
  const times = [0, 180000, 180010, 180020];
  assert.throws(() => launchIos(run, 'owned-simulator', 'public-link', (value) => evidence.push(value), () => times.shift()), (error) => error === primary);
  const query = calls.find((call) => call.args.includes('--predicate'));
  assert.equal(query.args[query.args.indexOf('--predicate') + 1], expected);
  assert.equal(query.args[query.args.indexOf('--last') + 1], '5m');
  assert.equal(query.options.timeout, 10000);
  assert.equal(query.options.maxBuffer, 8 * 1024 * 1024);
  assert.equal(calls.filter((call) => call.launch).length, 1);
  assert.equal(calls.length, 3);
  assert.equal(evidence[0].logsAvailable, true);
  assert.equal(evidence[0].logCountConfidence, 'complete-for-query');
  assert.deepEqual(evidence[0].logCounts, summarizeIosLaunch(services, lines(messages), true).logCounts);
  assert.deepEqual(evidence[0].logCounts, { matched: 2, failure: 1, timeout: 1, termination: 1 });
  assert(!JSON.stringify(evidence).includes(secret));
});

test('iOS package-scoped log overflow stays unavailable and cannot replace the original launch failure', () => {
  const primary = Error('original launch failure'), calls = [], evidence = [];
  const secret = 'synthetic_overflow_message_must_not_be_retained';
  const command = createCommandRunner((_command, args, options) => {
    calls.push({ args, options });
    if (args.includes('launchctl')) return ok('12\t0\tcom.apple.SpringBoard\n');
    return { status: 143, signal: null, stdout: secret, stderr: secret,
      error: Object.assign(Error(secret), { code: 'ENOBUFS' }) };
  });
  const run = (name, args, ...rest) => { if (args[1] === 'launch') { calls.push({ args, launch: true }); throw primary; } return command(name, args, ...rest); };
  const times = [0, 180000, 180010, 180020, 183020];
  assert.throws(() => launchIos(run, 'owned-simulator', 'public-link', (value) => { evidence.push(value); throw Error('diagnostic write failed'); }, () => times.shift()), (error) => error === primary);
  assert.equal(calls.filter((call) => call.launch).length, 1);
  assert.equal(calls.length, 3);
  assert.equal(evidence[0].logsAvailable, false);
  assert.equal(evidence[0].logCountConfidence, 'unavailable');
  assert.equal(evidence[0].logQueryFailure.errorCode, 'ENOBUFS');
  assert.equal(evidence[0].logQueryFailure.timeoutMs, 10000);
  assert.equal(evidence[0].logQueryFailure.status, 143);
  assert(!JSON.stringify(evidence).includes(secret));
});
