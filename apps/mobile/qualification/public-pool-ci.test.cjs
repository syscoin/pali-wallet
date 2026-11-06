const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createCommandRunner } = require('./command-runner.cjs');
const { androidPublicPoolSerial, readPublicPoolCiBuild, waitPublicPoolReport, withPublicPoolAndroidRoutes } = require('./public-pool-ci.cjs');
const { readHttpSidecar } = require('./post-sidecar.cjs');

const serial = 'emulator-5554';
const ok = (stdout = '') => ({ status: 0, stdout });

test('pool qualification rejects host use before reading the build receipt', () => {
  const env = { CI: 'true', GITHUB_ACTIONS: 'true', PALI_NATIVE_QUALIFICATION: '1',
    PALI_NATIVE_PUBLIC_POOL_QUALIFICATION: '1', PALI_NATIVE_HTTP_QUALIFICATION: '0' };
  for (const [field, value] of [['CI', 'false'], ['GITHUB_ACTIONS', undefined], ['PALI_NATIVE_QUALIFICATION', '0'],
    ['PALI_NATIVE_HTTP_QUALIFICATION', '1'], ['PALI_PHYSICAL_QUALIFICATION', 'import']]) {
    assert.throws(() => readPublicPoolCiBuild({ ...env, [field]: value }, 'absent.json'), /PUBLIC_POOL_REQUIRES_HOSTED_ISOLATION/);
  }
  assert.throws(() => readPublicPoolCiBuild(env, 'absent.json'), { code: 'ENOENT' });
});

test('public pool admission verifies an emulator serial, qemu and dedicated AVD before mutation', () => {
  for (const [device, avd, properties, admitted, expectedCalls] of [
    ['physical', '', [], false, 1],
    [serial, 'Other\nOK', [], false, 2],
    [serial, 'PaliQualification\nOK', ['0', '0'], false, 4],
    [serial, 'PaliQualification\r\nOK', ['1', '34'], false, 4],
    [serial, 'PaliQualification\r\nOK', ['1', '35', '0'], false, 5],
    [serial, 'PaliQualification\r\nOK', ['1', '35', '1'], true, 5],
  ]) {
    const calls = [];
    const run = (command, args) => { assert.equal(command, 'adb'); calls.push(args); return [device, avd, ...properties][calls.length - 1]; };
    if (admitted) assert.equal(androidPublicPoolSerial(run), serial);
    else assert.throws(() => androidPublicPoolSerial(run), /PUBLIC_POOL_REQUIRES_OWNED_CI_EMULATOR/);
    assert.equal(calls.length, expectedCalls);
    assert.deepEqual(calls[0], ['get-serialno']);
    assert(calls.slice(1).every((args) => args[0] === '-s' && args[1] === serial));
  }
});

function routeFixture({ initial = [], loseAck, uncertain } = {}) {
  const routes = new Map(initial), mutations = [];
  const run = createCommandRunner((command, args) => {
    assert.equal(command, 'adb');
    assert.deepEqual(args.slice(0, 3), ['-s', serial, 'reverse']);
    const [method, remote, local] = args.slice(3);
    if (method === '--list') return ok([...routes].map(([from, to]) => `host ${from} ${to}`).join('\n'));
    mutations.push([method, remote, local]);
    if (method === '--remove') { assert(routes.delete(remote)); return ok(); }
    assert.equal(method, '--no-rebind');
    assert(!routes.has(remote));
    if (remote !== uncertain) routes.set(remote, local);
    if (remote === loseAck)
      return { status: null, error: Object.assign(Error('lost ACK'), { code: 'ETIMEDOUT' }) };
    return ok();
  });
  return { routes, mutations, run };
}

test('pool reverse mappings leave collisions and changed routes alone and roll back only exact owned mappings', async () => {
  const route1 = 'tcp:42001', route2 = 'tcp:42002', foreign = 'tcp:47000';
  const collision = routeFixture({ initial: [[route2, foreign]] });
  await assert.rejects(withPublicPoolAndroidRoutes(collision.run, serial, [42001, 42002],
    () => assert.fail('must not launch')), /PUBLIC_POOL_REVERSE_COLLISION/);
  assert.deepEqual([...collision.routes], [[route2, foreign]]);
  assert.deepEqual(collision.mutations.map(([method, remote]) => [method, remote]), [['--no-rebind', route1], ['--remove', route1]]);

  const fixture = routeFixture({ initial: [[foreign, foreign]] });
  assert.equal(await withPublicPoolAndroidRoutes(fixture.run, serial, [42001, 42002], async () => {
    assert.deepEqual([...fixture.routes], [[foreign, foreign], [route1, route1], [route2, route2]]);
    fixture.routes.set(route1, foreign);
    return 'verified';
  }), 'verified');
  assert.deepEqual([...fixture.routes], [[foreign, foreign], [route1, foreign]]);
});

test('a lost reverse ACK can only prove ownership for cleanup, never for launch', async () => {
  for (const uncertain of [undefined, 'tcp:42002']) {
    const fixture = routeFixture({ loseAck: 'tcp:42002', uncertain });
    await assert.rejects(withPublicPoolAndroidRoutes(fixture.run, serial, [42001, 42002],
      () => assert.fail('must not launch')), (error) => error.failure.timedOut);
    assert.deepEqual([...fixture.routes], []);
    assert.deepEqual(fixture.mutations.filter(([method]) => method === '--remove').map(([, route]) => route),
      uncertain ? ['tcp:42001'] : ['tcp:42002', 'tcp:42001']);
  }
});

test('pool report wait admits exact sidecar content, rejects failed apps and enforces the existing time budget', async () => {
  let now = 0;
  const clock = () => now;
  const pause = async (ms) => { assert.equal(ms, 1000); now += ms; };
  assert.equal(await waitPublicPoolReport(() => now === 1000 ? '{}' : undefined, undefined, clock, pause), '{}');
  await assert.rejects(waitPublicPoolReport(() => assert.fail('must not read'), () => true, clock, pause), /PUBLIC_POOL_APP_FAILED/);
  now = 0;
  await assert.rejects(waitPublicPoolReport(() => undefined, undefined, clock, pause), /PUBLIC_POOL_APP_REPORT_TIMEOUT/);
  assert.equal(now, 300000);
});

test('only a token-bound pool sidecar shares the bounded qualification report reader', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-pool-sidecar-'));
  try {
    const name = `pali-native-public-pool-${'a'.repeat(32)}.json`;
    const file = path.join(root, name);
    fs.writeFileSync(file, '{}');
    assert.equal(readHttpSidecar(root, name), '{}');
    assert.throws(() => readHttpSidecar(root, `../${name}`), /HTTP_SIDECAR_INVALID/);
    fs.unlinkSync(file);
    fs.symlinkSync('non-fixture', file);
    assert.throws(() => readHttpSidecar(root, name), /HTTP_SIDECAR_INVALID/);
  } finally { fs.rmSync(root, { force: true, recursive: true }); }
});
