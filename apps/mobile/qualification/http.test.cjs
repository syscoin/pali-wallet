const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { Buffer } = require('node:buffer');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { HTTP_CASES, httpBuild, httpLaunch, assertHttpReport } = require('./http-contract.ts');
const { createHttpFixture, ROUTES } = require('./http-server.cjs');
const { startHttpCompanion, assertAudit } = require('./http-companion.cjs');
const { qualifyNativeHttp } = require('./http-native.ts');
const build = { version: 1, sourceRevision: 'a'.repeat(40), lockfileSha256: 'b'.repeat(64) };
const expected = { ...build, token: 'c'.repeat(32), phase: 'create', scenario: 'import', platform: 'ios' };
delete expected.version;
const report = () => ({ version: 1, kind: 'native-http', status: 'passed', nativeHttpQualified: true,
  ...expected, sessionId: '11111111-1111-1111-1111-111111111111', networkCalls: 0, cases: [...HTTP_CASES] });
const audit = () => ({ token: expected.token, port: 45454, invalid: 0,
  counts: Object.fromEntries(ROUTES.map((route) => [route, route === 'target' ? 0 : 1])),
  closed: { before: true, body: true, oversize: true } });

test('HTTP launch/build identity cannot choose hosts, secrets or arbitrary parameters', () => {
  assert.deepEqual(httpLaunch('45454', expected.token), { port: 45454, token: expected.token });
  assert.deepEqual(httpBuild(build), build);
  for (const port of ['0', '80', '045454', '65536', 'http://127.0.0.1', 45454, null]) assert.throws(() => httpLaunch(port, expected.token));
  for (const token of ['', expected.token + 'c', 'G'.repeat(32), 'https://example.invalid']) assert.throws(() => httpLaunch('45454', token));
  for (const input of [{}, { ...build, host: 'elsewhere' }, { ...build, sourceRevision: 'a' }, { ...build, version: 2 }]) assert.throws(() => httpBuild(input));
});
test('HTTP report and server audit require every current-run field, case and close proof', () => {
  assert.doesNotThrow(() => assertHttpReport(report(), expected));
  assert.doesNotThrow(() => assertAudit(audit(), expected.token, 45454));
  for (const key of Object.keys(report())) { const value = report(); delete value[key]; assert.throws(() => assertHttpReport(value, expected)); }
  for (const value of [{ ...report(), token: 'd'.repeat(32) }, { ...report(), nativeHttpQualified: false },
    { ...report(), networkCalls: 1 }, { ...report(), cases: [...HTTP_CASES].reverse() },
    { ...report(), sourceRevision: 'd'.repeat(40) }, { ...report(), rawBody: 'unexpected' }]) assert.throws(() => assertHttpReport(value, expected));
  for (const value of [{ ...audit(), port: 45455 }, { ...audit(), invalid: 1 }, { ...audit(), token: 'd'.repeat(32) },
    { ...audit(), counts: { ...audit().counts, target: 1 } }, { ...audit(), closed: { ...audit().closed, body: false } }])
    assert.throws(() => assertAudit(value, expected.token, 45454));
});

function cookieControl() {
  let cookie;
  return async (url, init) => {
    const headers = new Headers(init.headers);
    if (init.credentials === 'include' && cookie) headers.set('Cookie', cookie);
    const result = await fetch(url, { ...init, headers });
    if (init.credentials === 'include') {
      const set = result.headers.get('set-cookie');
      if (set) cookie = set.includes('Max-Age=0') ? undefined : set.split(';')[0];
    }
    return result;
  };
}
test('actual loopback fixture exercises all helper cases and independent server evidence (Node control)', async () => {
  const fixture = await createHttpFixture(); fixture.begin(expected.token);
  try {
    const value = await qualifyNativeHttp({ launch: { port: fixture.port, token: expected.token }, build,
      walletFetch: (url, init) => fetch(url, { ...init, credentials: 'omit', redirect: 'error' }), cookieFetch: cookieControl(),
      phase: 'create', scenario: 'import', platform: 'ios', sessionId: report().sessionId, networkCalls: () => 0 });
    assertHttpReport(value, expected);
    assertAudit(fixture.snapshot(expected.token), expected.token, fixture.port);
  } finally { await fixture.close(); }
});
test('redirect-following adapter fails; fixture sees forbidden target rather than claiming privacy', async () => {
  const fixture = await createHttpFixture(); fixture.begin(expected.token);
  try {
    await assert.rejects(qualifyNativeHttp({ launch: { port: fixture.port, token: expected.token }, build,
      walletFetch: (url, init) => fetch(url, { ...init, redirect: 'follow' }), cookieFetch: cookieControl(),
      phase: 'create', scenario: 'import', platform: 'ios', sessionId: report().sessionId, networkCalls: () => 0 }));
    assert.equal(fixture.snapshot(expected.token).counts.target, 1);
  } finally { await fixture.close(); }
});
test('late successful completion after abort cannot be reported as native HTTP qualification', async () => {
  const fixture = await createHttpFixture(); fixture.begin(expected.token);
  try {
    const walletFetch = (url, init) => fetch(url, { ...init, credentials: 'omit', redirect: 'error' }).catch((error) => {
      if (url.includes('/before?') && init.signal.aborted) return new Response('{"ok":true}');
      throw error;
    });
    await assert.rejects(qualifyNativeHttp({ launch: { port: fixture.port, token: expected.token }, build,
      walletFetch, cookieFetch: cookieControl(), phase: 'create', scenario: 'import', platform: 'ios',
      sessionId: report().sessionId, networkCalls: () => 0 }), /HTTP_QUALIFICATION_FAILED/);
    const evidence = fixture.snapshot(expected.token);
    assert.equal(evidence.counts.before, 1); assert.equal(evidence.counts.body, 0);
  } finally { await fixture.close(); }
});
test('cache-busting or foreign-token URLs fail closed without a generic proxy', async () => {
  const fixture = await createHttpFixture(); fixture.begin(expected.token);
  try {
    for (const route of [`/${expected.token}/exact?q=exact&_=1`, `/${'d'.repeat(32)}/exact?q=exact`]) {
      const response = await fetch(`http://127.0.0.1:${fixture.port}${route}`); assert.equal(response.status, 400);
    }
    assert.equal(fixture.snapshot(expected.token).invalid, 2);
  } finally { await fixture.close(); }
});

function childControl() {
  const child = new EventEmitter(); child.exitCode = null; child.signalCode = null;
  child.send = (message, callback) => {
    callback?.();
    if (message.kind === 'begin') child.token = message.token;
    const value = message.kind === 'snapshot' ? { ...audit(), token: child.token } : undefined;
    queueMicrotask(() => child.emit('message', { id: message.id, ok: true, value }));
  };
  child.kill = () => { child.signalCode = 'SIGTERM'; queueMicrotask(() => child.emit('exit')); return true; };
  queueMicrotask(() => child.emit('message', { kind: 'ready', port: 45454 }));
  return child;
}
test('companion owns only one reverse mapping and requires matching sidecar/session before completion', async () => {
  const commands = []; let child, mapped = false;
  const companion = await startHttpCompanion({ platform: 'android', sourceRevision: build.sourceRevision,
    run: (command, args) => {
      commands.push([command, args]);
      if (args.includes('get-serialno')) return 'emulator-5554';
      if (args.includes('ro.kernel.qemu')) return '1';
      if (args.includes('--no-rebind')) mapped = true;
      return args.includes('--list') && mapped ? 'emulator-5554 tcp:45454 tcp:45454' : '';
    }, spawn: () => (child = childControl()) });
  try {
    assert.throws(() => companion.assertComplete(1));
    const suffix = await companion.begin('create', 'import');
    const token = new URLSearchParams(suffix).get('httpToken');
    const value = { ...report(), token, platform: 'android', lockfileSha256: createHash('sha256').update(readFileSync(require.resolve('../package-lock.json'))).digest('hex') };
    await assert.rejects(companion.verify(() => undefined, value.sessionId));
    await assert.rejects(companion.verify(() => JSON.stringify(value), '22222222-2222-2222-2222-222222222222'));
    await companion.verify(() => JSON.stringify(value), value.sessionId);
    companion.assertComplete(1);
  } finally { await companion.close(); }
  assert.deepEqual(commands.map(([, args]) => args), [['get-serialno'], ['-s', 'emulator-5554', 'shell', 'getprop', 'ro.kernel.qemu'],
    ['-s', 'emulator-5554', 'reverse', '--list'], ['-s', 'emulator-5554', 'reverse', '--no-rebind', 'tcp:45454', 'tcp:45454'],
    ['-s', 'emulator-5554', 'reverse', '--list'], ['-s', 'emulator-5554', 'reverse', '--remove', 'tcp:45454']]);
  assert.equal(child.signalCode, 'SIGTERM');
});
test('reverse collision never removes someone else mapping; cleanup error still terminates child', async () => {
  let child; const commands = [];
  await assert.rejects(startHttpCompanion({ platform: 'android', sourceRevision: build.sourceRevision,
    run: (_command, args) => {
      commands.push(args);
      if (args.includes('get-serialno')) return 'emulator-5554';
      if (args.includes('ro.kernel.qemu')) return '1';
      return 'serial tcp:45454 tcp:9000';
    }, spawn: () => (child = childControl()) }));
  assert.equal(child.signalCode, 'SIGTERM'); assert.equal(commands.length, 3);
  let mapped = false;
  const companion = await startHttpCompanion({ platform: 'android', sourceRevision: build.sourceRevision,
    run: (_command, args) => {
      if (args.includes('--remove')) throw Error('cleanup-failed');
      if (args.includes('get-serialno')) return 'emulator-5554';
      if (args.includes('ro.kernel.qemu')) return '1';
      if (args.includes('--no-rebind')) mapped = true;
      return args.includes('--list') && mapped ? 'emulator-5554 tcp:45454 tcp:45454' : '';
    }, spawn: () => (child = childControl()) });
  await assert.rejects(companion.close(), /cleanup-failed/); assert.equal(child.signalCode, 'SIGTERM');
});
test('physical or unverified Android targets are rejected before any reverse mapping', async () => {
  for (const [serial, qemu] of [['real-device', '1'], ['emulator-5554', '0']]) {
    const commands = []; let child;
    await assert.rejects(startHttpCompanion({ platform: 'android', sourceRevision: build.sourceRevision,
      run: (_command, args) => { commands.push(args); return args.includes('get-serialno') ? serial : qemu; },
      spawn: () => (child = childControl()) }), /REQUIRES_CI_EMULATOR/);
    assert.equal(commands.some((args) => args.includes('reverse')), false); assert.equal(child.signalCode, 'SIGTERM');
  }
});
test('real child IPC, same-source sidecar, server audit and shutdown compose without device commands', async () => {
  const companion = await startHttpCompanion({ platform: 'ios', sourceRevision: build.sourceRevision,
    run() { throw Error('No device commands belong in this control'); } });
  let endpoint;
  try {
    const suffix = new URLSearchParams(await companion.begin('create', 'import'));
    const launch = httpLaunch(suffix.get('httpPort'), suffix.get('httpToken'));
    endpoint = `http://127.0.0.1:${launch.port}/${launch.token}/exact?q=exact`;
    const value = await qualifyNativeHttp({ launch, build: { ...build,
      lockfileSha256: createHash('sha256').update(readFileSync(require.resolve('../package-lock.json'))).digest('hex') },
      walletFetch: (url, init) => fetch(url, { ...init, credentials: 'omit', redirect: 'error' }), cookieFetch: cookieControl(),
      phase: 'create', scenario: 'import', platform: 'ios', sessionId: report().sessionId, networkCalls: () => 0 });
    await companion.verify(() => JSON.stringify(value), value.sessionId);
    companion.assertComplete(1);
  } finally { await companion.close(); }
  await assert.rejects(fetch(endpoint));
});
test('late or wrong-token server evidence cannot satisfy a new native phase', () => {
  const old = audit();
  assert.throws(() => assertAudit(old, 'd'.repeat(32), 45454));
  const late = { ...old, closed: { ...old.closed, before: false } };
  assert.throws(() => assertAudit(late, expected.token, 45454));
  assert.equal(Buffer.byteLength(JSON.stringify(report())) < 8192, true);
});
test('HTTP build gate is source-bound, fixture-only and leaves production configuration bytes unchanged', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-http-config-'));
  const originalApp = readFileSync(require.resolve('../app.json'));
  try {
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.copyFileSync(require.resolve('../scripts/configure-native-qualification.cjs'), path.join(root, 'scripts/configure-native-qualification.cjs'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ main: 'index.ts', dependencies: { '@sidhujag/sysweb3-keyring': '2.0.0' } }));
    fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
    fs.writeFileSync(path.join(root, 'app.json'), originalApp);
    fs.writeFileSync(path.join(root, 'index.ts'), 'public production entry');
    const env = { ...process.env, CI: 'true', PALI_NATIVE_QUALIFICATION: '1', PALI_NATIVE_HTTP_QUALIFICATION: '1', GITHUB_SHA: build.sourceRevision };
    delete env.PALI_PHYSICAL_QUALIFICATION;
    const run = (extra) => spawnSync(process.execPath, [path.join(root, 'scripts/configure-native-qualification.cjs')], { env: { ...env, ...extra } });
    assert.notEqual(run({ GITHUB_SHA: '' }).status, 0);
    assert.notEqual(run({ PALI_PHYSICAL_QUALIFICATION: 'import' }).status, 0);
    assert.equal(run({}).status, 0);
    const configured = JSON.parse(readFileSync(path.join(root, 'app.json'))).expo;
    assert.equal(configured.android.package, 'com.paliwallet.qualification');
    assert.equal(configured.ios.bundleIdentifier, 'com.paliwallet.qualification');
    assert.deepEqual(configured.extra.paliHttpQualification, { ...build, lockfileSha256: createHash('sha256').update('{}').digest('hex') });
    assert.equal(configured.plugins.at(-1), './qualification/withHttpFixture.cjs');
    assert.equal(readFileSync(path.join(root, 'index.ts'), 'utf8'), 'public production entry');
    assert.deepEqual(readFileSync(require.resolve('../app.json')), originalApp);
    assert.equal(JSON.parse(originalApp).expo.plugins.some((plugin) => String(plugin).includes('withHttpFixture')), false);
    const safety = readFileSync(require.resolve('../plugins/withMobileSafety.cjs'), 'utf8');
    assert(safety.includes("app.$['android:usesCleartextTraffic'] = 'false'"));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
