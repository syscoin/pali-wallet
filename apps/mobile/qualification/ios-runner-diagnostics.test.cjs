const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const { prepareIosSimulator, createIosStageRecorder, inspectIosServices, assertOwnedIosDevice } = require('./ios-runner-diagnostics.cjs');
const { launchIos, summarizeIosLaunch } = require('./native-readiness.cjs');

const DEVICE = '11111111-2222-3333-4444-555555555555';
const RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-26-5';
const SPRINGBOARD = 'PID\tStatus\tLabel\n12\t0\tcom.apple.SpringBoard\n';
const inventory = (changes = {}) => JSON.stringify({ devices: { [RUNTIME]: [
  { udid: DEVICE, isAvailable: true, state: 'Booted', ...changes },
] } });

function fixture({ inventories = [inventory()], services = SPRINGBOARD, probeCost = 0 } = {}) {
  let time = 0, probes = 0;
  const calls = [], records = [], sleeps = [];
  const run = (command, args, optional, timeout) => {
    calls.push({ command, args, optional, timeout });
    time += Math.min(probeCost, timeout);
    if (args.includes('devices')) return inventories[Math.min(probes++, inventories.length - 1)];
    assert.deepEqual(args, ['simctl', 'spawn', DEVICE, 'launchctl', 'list']);
    return services;
  };
  const options = { now: () => time, sleep: async (ms) => { sleeps.push(ms); time += ms; } };
  return { calls, records, sleeps, options, time: () => time,
    invoke: (record = (value) => records.push(value)) => prepareIosSimulator(run, DEVICE, RUNTIME, record, options) };
}

test('owned Booted simulator and live SpringBoard are required before readiness is recorded', async () => {
  const f = fixture(); await f.invoke();
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls.map((call) => call.timeout), [10000, 10000]);
  assert(f.calls.every((call) => call.command === 'xcrun' && call.optional === false));
  assert.deepEqual(f.records, [{ version: 1, status: 'ready', stage: 'ready', device: DEVICE, runtime: RUNTIME,
    deviceState: 'Booted', springboardPidPresent: true, probes: 1, elapsedMs: 0, deadlineMs: 30000,
    deadlineExceeded: false, elapsedTruncated: false }]);
});

test('readiness waits for Booted without spawning commands inside an unbooted simulator', async () => {
  const f = fixture({ inventories: [inventory({ state: 'Booting' }), inventory()] }); await f.invoke();
  assert.deepEqual(f.calls.map((call) => call.args[2]), ['devices', 'devices', DEVICE]);
  assert.deepEqual(f.sleeps, [500]); assert.equal(f.records[0].probes, 2);
});

for (const services of ['', '0\t0\tcom.apple.SpringBoard\n', '-\t0\tcom.apple.SpringBoard\n', '12\t0\tother.app\n']) {
  test(`missing live SpringBoard exhausts one bounded readiness deadline: ${JSON.stringify(services)}`, async () => {
    const f = fixture({ services });
    await assert.rejects(f.invoke(), /readiness deadline exceeded/);
    assert.equal(f.time(), 30000);
    assert.equal(f.records[0].status, 'failed');
    assert.equal(f.records[0].springboardPidPresent, false);
    assert(!f.calls.some((call) => call.args.includes('launch')));
  });
}

for (const [name, raw] of [
  ['malformed', 'not JSON'], ['null map', '{"devices":null}'], ['array map', '{"devices":[]}'],
  ['missing device', '{"devices":{}}'], ['unavailable', inventory({ isAvailable: false })],
  ['unknown state', inventory({ state: 'Running' })],
  ['wrong runtime', JSON.stringify({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [{ udid: DEVICE, isAvailable: true, state: 'Booted' }] } })],
  ['duplicate', JSON.stringify({ devices: { [RUNTIME]: [{ udid: DEVICE, isAvailable: true, state: 'Booted' }, { udid: DEVICE, isAvailable: true, state: 'Booted' }] } })],
]) test(`invalid or mismatched owned inventory fails before a simulator probe: ${name}`, async () => {
  const f = fixture({ inventories: [raw] });
  await assert.rejects(f.invoke()); assert.equal(f.calls.length, 1); assert.equal(f.records[0].status, 'failed');
});

test('readiness rejects aliases and malformed ownership before any host command', async () => {
  for (const device of ['booted', 'all', '', DEVICE + '\n'])
    await assert.rejects(prepareIosSimulator(() => assert.fail('host command'), device, RUNTIME, () => {}), /Invalid owned/);
  await assert.rejects(prepareIosSimulator(() => assert.fail('host command'), DEVICE, 'arbitrary-runtime', () => {}), /Invalid owned/);
  for (const device of [null, {}, 'all', DEVICE + '\n']) assert.throws(() => assertOwnedIosDevice(device, RUNTIME), /Invalid owned/);
});

test('running qualification app and truncated service inventory never become ready', async () => {
  for (const services of [SPRINGBOARD + '34\t0\tUIKitApplication:com.paliwallet.qualification[public]\n', SPRINGBOARD + ' '.repeat(65536)]) {
    const f = fixture({ services }); await assert.rejects(f.invoke()); assert.equal(f.records[0].status, 'failed');
  }
});

test('readiness shares one deadline across slow probes and sleeps', async () => {
  const f = fixture({ services: '', probeCost: 9000 }); await assert.rejects(f.invoke(), /readiness deadline/);
  assert.equal(f.time(), 30000);
  assert(f.calls.at(-1).timeout < 10000);
  assert(f.calls.every((call) => call.timeout > 0 && call.timeout <= 10000));
});

test('readiness reports a host overrun without shortening it to the requested deadline', async () => {
  for (const [cost, elapsed, truncated] of [[40000, 40000, false], [700000, 600000, true]]) {
    let time = 0; const records = [];
    const run = () => { time += cost; return inventory(); };
    await assert.rejects(prepareIosSimulator(run, DEVICE, RUNTIME, (value) => records.push(value), {
      now: () => time, sleep: async () => assert.fail('expired probe must not sleep'),
    }), /readiness deadline exceeded/);
    assert.equal(records[0].status, 'failed');
    assert.equal(records[0].elapsedMs, elapsed);
    assert.equal(records[0].deadlineExceeded, true);
    assert.equal(records[0].elapsedTruncated, truncated);
  }
});

test('a ready proof must persist, while diagnostic write failure cannot replace an earlier probe failure', async () => {
  await assert.rejects(fixture().invoke(() => { throw Error('write failed'); }), /write failed/);
  const original = Error('probe failure');
  await assert.rejects(prepareIosSimulator(() => { throw original; }, DEVICE, RUNTIME, () => { throw Error('write failed'); }), (error) => error === original);
});

test('stage recorder stores running and final timing without changing the action result or error', async () => {
  let time = 0; const values = [];
  const stage = createIosStageRecorder((value) => values.push(value), () => time);
  assert.equal(await stage('boot', () => { time = 12; return 'boot result'; }), 'boot result');
  const original = Error('original failure');
  await assert.rejects(stage('launch-create', async () => { time = 19; throw original; }), (error) => error === original);
  assert.deepEqual(values.at(-1).stages, [{ stage: 'boot', status: 'complete', elapsedMs: 12 }, { stage: 'launch-create', status: 'failed', elapsedMs: 7 }]);
  assert.equal(values[0].stages[0].status, 'running');
  assert.equal(values[0].stages[0].elapsedMs, null);
  assert(!JSON.stringify(values).includes('original failure'));
});

test('stage write failures prevent unrecorded action and preserve an already failed action', async () => {
  const stage = createIosStageRecorder(() => { throw Error('write failed'); });
  await assert.rejects(stage('boot', () => assert.fail('unrecorded action')), /write failed/);
  let writes = 0; const original = Error('action failed');
  const failing = createIosStageRecorder(() => { if (++writes > 1) throw Error('write failed'); });
  await assert.rejects(failing('boot', () => { throw original; }), (error) => error === original);
});

test('launch log window includes full command wait and probe delay, or explicitly reports incomplete coverage', () => {
  for (const [times, minutes, complete] of [[[0, 180000, 190000], 5, true], [[0, 920000, 930000], 15, false], [[100, 50, 40], 15, false]]) {
    const values = [...times], calls = [], records = [], original = Error('original');
    const run = (_command, args) => { calls.push(args); if (args[1] === 'launch') throw original; return ''; };
    assert.throws(() => launchIos(run, DEVICE, 'public-link', (value) => records.push(value), () => values.shift()), (error) => error === original);
    assert.equal(calls.filter((args) => args[1] === 'launch').length, 1);
    assert.equal(calls.at(-1)[calls.at(-1).indexOf('--last') + 1], minutes + 'm');
    assert.equal(records[0].fullAttemptRequested, complete);
    assert.equal(records[0].logCountConfidence, complete ? 'complete-for-query' : 'lower-bound');
  }
});

test('missing, malformed and truncated diagnostics cannot claim complete counts', () => {
  assert.equal(summarizeIosLaunch(null, null, true).logCountConfidence, 'unavailable');
  assert.equal(summarizeIosLaunch(null, 'bad JSON', true).logCountConfidence, 'lower-bound');
  const truncated = summarizeIosLaunch(SPRINGBOARD + ' '.repeat(65536), ' '.repeat(262145), true);
  assert.equal(truncated.servicesTruncated, true); assert.equal(truncated.logsTruncated, true);
  assert.equal(truncated.logCountConfidence, 'lower-bound');
  assert.equal(inspectIosServices(null).servicesAvailable, false);
});

test('actual runner refuses unavailable owned simulator before app launch, preserves evidence and cleans up', async () => {
  const calls = [], writes = [];
  const process = { env: { CI: 'true', PALI_NATIVE_QUALIFICATION: '1', QUALIFICATION_ARTIFACTS: '/public-output' }, argv: ['node', 'runner', 'ios', '/public-app'], exitCode: 0 };
  await runInNewContext(readFileSync(require.resolve('./run-native.cjs'), 'utf8'), {
    require(name) {
      if (name === 'fs') return { existsSync: () => true, mkdirSync() {}, writeFileSync: (path, data) => writes.push({ path, data }) };
      if (name === 'child_process') return { spawnSync(command, args) {
        calls.push(args);
        let stdout = '';
        if (command === 'plutil') stdout = args.includes('CFBundleIdentifier') ? 'com.paliwallet.qualification' : 'PaliQualification';
        else if (args.includes('runtimes')) stdout = JSON.stringify({ runtimes: [{ identifier: RUNTIME, version: '26.5', isAvailable: true }] });
        else if (args.includes('devicetypes')) stdout = JSON.stringify({ devicetypes: [{ identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17' }] });
        else if (args[1] === 'create') stdout = DEVICE;
        else if (args[1] === 'get_app_container') stdout = '/public-container';
        else if (args.includes('devices')) stdout = inventory({ isAvailable: false });
        return { status: 0, stdout };
      } };
      return require(name);
    }, process, console: { error() {}, log() {} }, setTimeout,
  });
  assert.equal(process.exitCode, 1);
  assert(!calls.some((args) => args[1] === 'launch'));
  assert(calls.some((args) => args[1] === 'delete' && args[2] === DEVICE));
  const readiness = JSON.parse(writes.find((row) => row.path.endsWith('-create-readiness.json')).data);
  assert.equal(readiness.status, 'failed');
  const stages = JSON.parse(writes.filter((row) => row.path.endsWith('-stages.json')).at(-1).data);
  assert.equal(stages.stages.at(-1).stage, 'readiness-create'); assert.equal(stages.stages.at(-1).status, 'failed');
  assert(!writes.some((row) => /ios-(qualification|simulator-limited)\.json$/.test(row.path)));
});

for (const failure of ['before-create', 'after-create', 'invalid-identity', 'create-command']) {
  test(`actual runner cleans only validated ownership after create-stage failure: ${failure}`, async () => {
    const calls = [], writes = []; let stageWrites = 0;
    const process = { env: { CI: 'true', PALI_NATIVE_QUALIFICATION: '1', QUALIFICATION_ARTIFACTS: '/public-output' }, argv: ['node', 'runner', 'ios', '/public-app'], exitCode: 0 };
    await runInNewContext(readFileSync(require.resolve('./run-native.cjs'), 'utf8'), {
      require(name) {
        if (name === 'fs') return { existsSync: () => true, mkdirSync() {}, writeFileSync(path, data) {
          if (path.endsWith('-stages.json') && ++stageWrites === (failure === 'before-create' ? 1 : 2))
            throw Error('stage persistence fixture failure');
          writes.push({ path, data });
        } };
        if (name === 'child_process') return { spawnSync(command, args) {
          calls.push(args); let stdout = '';
          if (command === 'plutil') stdout = args.includes('CFBundleIdentifier') ? 'com.paliwallet.qualification' : 'PaliQualification';
          else if (args.includes('runtimes')) stdout = JSON.stringify({ runtimes: [{ identifier: RUNTIME, version: '26.5', isAvailable: true }] });
          else if (args.includes('devicetypes')) stdout = JSON.stringify({ devicetypes: [{ identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17' }] });
          else if (args[1] === 'create') {
            if (failure === 'create-command') return { status: 7, stderr: 'create fixture failure' };
            stdout = failure === 'invalid-identity' ? 'all' : DEVICE;
          }
          return { status: 0, stdout };
        } };
        return require(name);
      }, process, console: { error() {}, log() {} }, setTimeout,
    });
    assert.equal(process.exitCode, 1);
    assert.equal(calls.filter((args) => args[1] === 'create').length, failure === 'before-create' ? 0 : 1);
    assert(!calls.some((args) => ['boot', 'bootstatus', 'install', 'launch'].includes(args[1])));
    const cleanup = calls.filter((args) => ['shutdown', 'delete'].includes(args[1]));
    assert.deepEqual(cleanup.map((args) => [args[1], args[2]]), failure === 'after-create' ? [['shutdown', DEVICE], ['delete', DEVICE]] : []);
    const failed = JSON.parse(writes.find((row) => row.path.endsWith('ios-failure.json')).data);
    if (failure === 'before-create' || failure === 'after-create') assert.equal(failed.failure.message, 'stage persistence fixture failure');
    else if (failure === 'invalid-identity') assert.equal(failed.failure.message, 'Invalid owned iOS simulator identity');
    else assert.equal(failed.failure.status, 7);
    assert(!writes.some((row) => /ios-(qualification|simulator-limited)\.json$/.test(row.path)));
  });
}
