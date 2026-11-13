import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

type Result = { status: number; stdout: string };
type Git = (args: string[], input?: string) => Promise<Result>;
type Channel = 'mobile' | 'canary';
type Options = { cwd: string; purpose: string; channel: Channel; series?: string };
type Receipt = { schemaVersion: 1; channel: Channel; series?: string; buildNumber: number; sourceRevision: string; allocationRevision: string;
  requestId: string; purpose: 'qa' | 'store'; allocatedAt: string; sourceDirty: boolean };
const { parseBuildNumber, reserveBuildNumber, assertBuildSource, _testing } = createRequire(import.meta.url)('../../../scripts/build-number.cjs') as {
  parseBuildNumber(value: unknown, channel: Channel): number;
  reserveBuildNumber(options: Options): Promise<Receipt>;
  assertBuildSource(options: { cwd: string; receipt: Receipt }): Promise<void>;
  _testing: { createGit(cwd: string): Git; MOBILE_COUNTER_REF: string; MAX_BUILD_NUMBERS: Record<Channel, number>; MAX_ATTEMPTS: number;
    reserve(options: Options, dependencies: { git: Git; requestId?: () => string; now?: () => Date }): Promise<Receipt> };
};
const CANONICAL = 'https://github.com/syscoin/pali-wallet.git';
const REF = _testing.MOBILE_COUNTER_REF;
const run = (cwd: string, args: string[], input?: string) => execFileSync('git', args, {
  cwd, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' },
}).trim();

function fixture(t: { after(callback: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), 'pali-build-number-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = join(root, 'counter.git');
  run(root, ['init', '--bare', remote]);
  const calls: string[][] = [];
  function workspace(name: string) {
    const cwd = join(root, name);
    run(root, ['init', cwd]);
    run(cwd, ['config', 'user.name', 'Native Build Number Test']);
    run(cwd, ['config', 'user.email', 'build-number-test@invalid.example']);
    run(cwd, ['config', 'commit.gpgsign', 'false']);
    writeFileSync(join(cwd, 'app.json'), JSON.stringify({ version: '5.0.0', workspace: name }));
    run(cwd, ['add', 'app.json']); run(cwd, ['commit', '-m', 'fixture source']);
    run(cwd, ['remote', 'add', 'origin', CANONICAL]);
    const nativeGit = _testing.createGit(cwd);
    const git: Git = async (args, input) => {
      calls.push([...args]);
      // Only this internal test port substitutes a local bare repository. The
      // production API still validates and uses the canonical GitHub origin.
      const mapped = args.map(arg => arg === CANONICAL || arg === 'git@github.com:syscoin/pali-wallet.git' ? remote : arg);
      assert(!mapped.some(arg => arg.includes('github.com') && arg !== 'origin'));
      return nativeGit(mapped, input);
    };
    return { cwd, git, nativeGit, reserve: (purpose = 'qa', override: Git = git, channel: Channel = 'mobile', series?: string) => _testing.reserve({ cwd, purpose, channel, ...(series === undefined ? {} : { series }) }, { git: override }) };
  }
  const first = workspace('first');
  const state = (ref = REF) => JSON.parse(run(root, [`--git-dir=${remote}`, 'show', `${ref}:state.json`]));
  function replaceState(value: unknown, extraFile = false, ref = REF) {
    const previous = run(root, [`--git-dir=${remote}`, 'rev-parse', ref]);
    const blob = run(first.cwd, ['hash-object', '-w', '--stdin'], `${JSON.stringify(value)}\n`);
    const tree = run(first.cwd, ['mktree'], `100644 blob ${blob}\tstate.json\n${extraFile ? `100644 blob ${blob}\textra.json\n` : ''}`);
    const revision = run(first.cwd, ['commit-tree', tree, '-p', previous], 'Synthetic invalid state\n');
    run(first.cwd, ['push', remote, `${revision}:${ref}`]);
  }
  return { root, remote, calls, workspace, first, state, replaceState };
}

test('build numbers are canonical positive store-safe integers', () => {
  for (const [input, expected] of [[1, 1], ['2', 2], [2100000000, 2100000000], ['2100000000', 2100000000]] as const)
    assert.equal(parseBuildNumber(input, 'mobile'), expected);
  for (const input of [0, -1, 1.2, NaN, Infinity, 2100000001, null, undefined, true, {}, '', '0', '02', '+2', '2.0', '2e0', ' 2', '2\n', '2.1.0'])
    assert.throws(() => parseBuildNumber(input, 'mobile'), { code: 'INVALID_BUILD_NUMBER' });
});

test('channel and Canary series are explicit, canonical and bounded before Git access', async t => {
  const f = fixture(t);
  for (const channel of [undefined, '', 'production', '__proto__', Object('mobile'), Object('canary'),
    { toString() { throw new Error('Channel coercion must not run'); } }]) {
    assert.throws(() => parseBuildNumber(1, channel as Channel), { code: 'INVALID_CHANNEL' });
    await assert.rejects(_testing.reserve({ cwd: f.first.cwd, purpose: 'qa', channel } as Options, { git: f.first.git }),
      { code: 'INVALID_CHANNEL' });
  }
  for (const series of [undefined, '', '5', '5.0', '05.0.0', '5.00.0', '5.0.0.1', '5.0.0-beta', '5.0.0/other', '65536.0.0', '5.0.0\n'])
    await assert.rejects(f.first.reserve('qa', f.first.git, 'canary', series), { code: 'INVALID_SERIES' });
  await assert.rejects(f.first.reserve('qa', f.first.git, 'mobile', '5.0.0'), { code: 'INVALID_SERIES' });
  assert.equal(f.calls.length, 0);
  assert.equal(parseBuildNumber('65535', 'canary'), 65535);
  assert.throws(() => parseBuildNumber(65536, 'canary'), { code: 'INVALID_BUILD_NUMBER' });
  assert.equal(parseBuildNumber(65536, 'mobile'), 65536);
});

test('mobile and each Canary series advance independently without changing remote state schema', async t => {
  const f = fixture(t), a = 'refs/heads/pali-canary-builds/5.0.0', b = 'refs/heads/pali-canary-builds/5.1.0';
  assert.equal((await f.first.reserve()).buildNumber, 2);
  const first = await f.first.reserve('qa', f.first.git, 'canary', '5.0.0');
  assert.equal(first.buildNumber, 1); assert.equal(first.channel, 'canary'); assert.equal(first.series, '5.0.0');
  const next = await f.first.reserve('store', f.first.git, 'canary', '5.0.0');
  assert.equal(next.buildNumber, 2);
  assert.equal((await f.first.reserve('qa', f.first.git, 'canary', '5.1.0')).buildNumber, 1);
  const mobile = await f.first.reserve();
  assert.equal(mobile.buildNumber, 3); assert.equal(mobile.channel, 'mobile'); assert.equal(Object.hasOwn(mobile, 'series'), false);
  assert.equal(f.state().buildNumber, 3); assert.equal(f.state(a).buildNumber, 2); assert.equal(f.state(b).buildNumber, 1);
  assert.deepEqual(Object.keys(f.state(a)).sort(), ['schemaVersion', 'buildNumber', 'requestId', 'sourceRevision', 'purpose', 'allocatedAt'].sort());
  assert.equal(run(f.root, [`--git-dir=${f.remote}`, 'ls-tree', '--name-only', a]), 'state.json');
  assert.equal(run(f.first.cwd, ['status', '--porcelain']), '');
});

test('Canary reservations use the same verified concurrency boundary across machines', async t => {
  const f = fixture(t), second = f.workspace('second');
  let waiting = 0, release!: () => void;
  const bothAtPush = new Promise<void>(resolve => { release = resolve; });
  const barrier = (git: Git): Git => async (args, input) => {
    if (args[0] === 'push' && waiting < 2) { waiting++; if (waiting === 2) release(); await bothAtPush; }
    return git(args, input);
  };
  const receipts = await Promise.all([
    f.first.reserve('qa', barrier(f.first.git), 'canary', '5.0.0'),
    second.reserve('store', barrier(second.git), 'canary', '5.0.0'),
  ]);
  assert.deepEqual(receipts.map(receipt => receipt.buildNumber).sort(), [1, 2]);
  assert.equal(new Set(receipts.map(receipt => receipt.allocationRevision)).size, 2);
  for (const receipt of receipts)
    assert.equal(run(f.root, [`--git-dir=${f.remote}`, 'merge-base', '--is-ancestor', receipt.allocationRevision, 'refs/heads/pali-canary-builds/5.0.0']), '');
});

test('exhausted Canary series refuses further allocation without limiting mobile or a new series', async t => {
  const f = fixture(t), ref = 'refs/heads/pali-canary-builds/5.0.0';
  await f.first.reserve('qa', f.first.git, 'canary', '5.0.0');
  const original = f.state(ref);
  f.replaceState({ ...original, buildNumber: 0 }, false, ref);
  await assert.rejects(f.first.reserve('qa', f.first.git, 'canary', '5.0.0'), { code: 'INVALID_COUNTER_STATE' });
  f.replaceState({ ...original, buildNumber: 65534 }, false, ref);
  assert.equal((await f.first.reserve('qa', f.first.git, 'canary', '5.0.0')).buildNumber, 65535);
  const pushes = f.calls.filter(args => args[0] === 'push').length;
  await assert.rejects(f.first.reserve('qa', f.first.git, 'canary', '5.0.0'), { code: 'INVALID_BUILD_NUMBER' });
  assert.equal(f.calls.filter(args => args[0] === 'push').length, pushes);
  assert.equal(f.state(ref).buildNumber, 65535);
  assert.equal((await f.first.reserve()).buildNumber, 2);
  assert.equal((await f.first.reserve('qa', f.first.git, 'canary', '5.0.1')).buildNumber, 1);
});

test('source rechecks refuse receipts without their channel or with a malformed Canary identity', async t => {
  const f = fixture(t), receipt = await f.first.reserve('qa', f.first.git, 'canary', '5.0.0');
  await assertBuildSource({ cwd: f.first.cwd, receipt });
  for (const update of [{ channel: undefined }, { series: undefined }, { series: '5.0.0/other' }, { buildNumber: 65536 }])
    await assert.rejects(assertBuildSource({ cwd: f.first.cwd, receipt: { ...receipt, ...update } as Receipt }));
});

test('first reservation is 2, uses only state.json and binds the exact source', async t => {
  const f = fixture(t), receipt = await f.first.reserve('store');
  assert.equal(receipt.buildNumber, 2); assert.equal(receipt.sourceDirty, false);
  assert.equal(receipt.sourceRevision, run(f.first.cwd, ['rev-parse', 'HEAD']));
  assert.equal(receipt.allocationRevision, run(f.root, [`--git-dir=${f.remote}`, 'rev-parse', REF]));
  assert.deepEqual(f.state(), { schemaVersion: 1, buildNumber: 2, sourceRevision: receipt.sourceRevision,
    requestId: receipt.requestId, purpose: 'store', allocatedAt: receipt.allocatedAt });
  assert.equal(run(f.root, [`--git-dir=${f.remote}`, 'ls-tree', '--name-only', REF]), 'state.json');
  assert.equal(run(f.first.cwd, ['status', '--porcelain']), '');
  assert.equal(Object.isFrozen(receipt), true);
  assert(f.calls.filter(args => args[0] === 'push').every(args => !args.some(arg => arg.startsWith('+') || arg.includes('force'))));
});

test('counter metadata skips source hooks while ordinary source pushes still run them', async t => {
  const f = fixture(t), cwd = f.first.cwd;
  const originalHead = run(cwd, ['rev-parse', 'HEAD']);
  const originalTree = run(cwd, ['rev-parse', 'HEAD^{tree}']);
  const hook = join(cwd, '.git', 'hooks', 'pre-push');
  const hookMarker = join(cwd, '.git', 'pre-push-hook-ran');
  run(cwd, ['config', 'core.hooksPath', '.git/hooks']);
  writeFileSync(hook, '#!/bin/sh\nprintf "%s\\n" "blocked fixture source push" > "$PWD/.git/pre-push-hook-ran"\nexit 1\n');
  chmodSync(hook, 0o755);

  const receipt = await f.first.reserve('store', f.first.git, 'canary', '5.0.0');
  const ref = 'refs/heads/pali-canary-builds/5.0.0';
  assert.equal(existsSync(hookMarker), false);
  assert.equal(receipt.sourceRevision, originalHead);
  assert.equal(receipt.sourceDirty, false);
  assert.equal(receipt.allocationRevision, run(f.root, [`--git-dir=${f.remote}`, 'rev-parse', ref]));
  assert.equal(f.state(ref).requestId, receipt.requestId);
  assert.equal(run(f.root, [`--git-dir=${f.remote}`, 'ls-tree', '--name-only', ref]), 'state.json');
  assert.equal(run(cwd, ['rev-parse', 'HEAD']), originalHead);
  assert.equal(run(cwd, ['rev-parse', 'HEAD^{tree}']), originalTree);
  assert.equal(run(cwd, ['status', '--porcelain']), '');

  const sourcePush = await f.first.nativeGit(['push', f.remote, 'HEAD:refs/heads/source-under-test']);
  assert.notEqual(sourcePush.status, 0);
  assert.equal(readFileSync(hookMarker, 'utf8'), 'blocked fixture source push\n');
  assert.equal((await f.first.nativeGit(['ls-remote', '--exit-code', '--heads', f.remote, 'refs/heads/source-under-test'])).status, 2);
  assert.equal(run(cwd, ['rev-parse', 'HEAD']), originalHead);
  assert.equal(run(cwd, ['rev-parse', 'HEAD^{tree}']), originalTree);
  assert.equal(run(cwd, ['status', '--porcelain']), '');
});

test('same counter is used across source versions, workspaces, QA and store purposes', async t => {
  const f = fixture(t);
  assert.equal((await f.first.reserve()).buildNumber, 2);
  const second = f.workspace('second');
  writeFileSync(join(second.cwd, 'app.json'), JSON.stringify({ version: '5.1.0' }));
  run(second.cwd, ['add', 'app.json']); run(second.cwd, ['commit', '-m', 'different marketing version']);
  const next = await second.reserve('store');
  assert.equal(next.buildNumber, 3); assert.equal(next.purpose, 'store');
  assert.notEqual(next.sourceRevision, run(f.first.cwd, ['rev-parse', 'HEAD']));
  assert.equal((await f.first.reserve()).buildNumber, 4);
});

test('concurrent workspaces resolve compare-and-swap conflicts without duplicate numbers', async t => {
  const f = fixture(t), second = f.workspace('second');
  let waiting = 0, release!: () => void;
  const bothAtPush = new Promise<void>(resolve => { release = resolve; });
  const barrier = (git: Git): Git => async (args, input) => {
    if (args[0] === 'push' && waiting < 2) { waiting++; if (waiting === 2) release(); await bothAtPush; }
    return git(args, input);
  };
  const receipts = await Promise.all([f.first.reserve('qa', barrier(f.first.git)), second.reserve('store', barrier(second.git))]);
  assert.deepEqual(receipts.map(value => value.buildNumber).sort(), [2, 3]);
  assert.equal(new Set(receipts.map(value => value.allocationRevision)).size, 2);
  for (const receipt of receipts)
    assert.equal(run(f.root, [`--git-dir=${f.remote}`, 'merge-base', '--is-ancestor', receipt.allocationRevision, REF]), '');
});

test('concurrent requests for the identical source still reserve distinct commits', async t => {
  const f = fixture(t);
  const receipts = await Promise.all([f.first.reserve(), f.first.reserve()]);
  assert.deepEqual(receipts.map(value => value.buildNumber).sort(), [2, 3]);
  assert.equal(receipts[0].sourceRevision, receipts[1].sourceRevision);
  assert.notEqual(receipts[0].requestId, receipts[1].requestId);
  assert.notEqual(receipts[0].allocationRevision, receipts[1].allocationRevision);
});

test('an ambiguous successful push returns only after remote ancestry verification', async t => {
  const f = fixture(t);
  const ambiguous: Git = async (args, input) => {
    const result = await f.first.git(args, input);
    if (args[0] === 'push') return { status: -1, stdout: 'network response lost' };
    return result;
  };
  const receipt = await f.first.reserve('qa', ambiguous);
  assert.equal(receipt.buildNumber, 2); assert.equal(f.state().requestId, receipt.requestId);
  assert.equal(f.calls.filter(args => args[0] === 'push').length, 1);
});

test('ambiguous success remains owned after a later allocation advances the counter', async t => {
  const f = fixture(t), second = f.workspace('second');
  const ambiguous: Git = async (args, input) => {
    const result = await f.first.git(args, input);
    if (args[0] === 'push') { await second.reserve(); return { status: -1, stdout: '' }; }
    return result;
  };
  const receipt = await f.first.reserve('qa', ambiguous);
  assert.equal(receipt.buildNumber, 2); assert.equal(f.state().buildNumber, 3);
});

test('failed push without a proven competing reservation fails closed and does not retry', async t => {
  const f = fixture(t); await f.first.reserve();
  let pushes = 0;
  const denied: Git = async (args, input) => args[0] === 'push'
    ? (pushes++, { status: 1, stdout: 'https://secret:token@example.invalid forbidden' }) : f.first.git(args, input);
  await assert.rejects(f.first.reserve('qa', denied), error => {
    assert.match(String(error), /COUNTER_RESERVATION_FAILED/); assert(!String(error).includes('token')); return true;
  });
  assert.equal(pushes, 1); assert.equal(f.state().buildNumber, 2);
});

test('unverifiable ambiguous success is burned instead of returned or reused', async t => {
  const f = fixture(t);
  let pushed = false;
  const disconnected: Git = async (args, input) => {
    if (pushed && args[0] === 'ls-remote') throw Error('private credential helper diagnostic');
    const result = await f.first.git(args, input);
    if (args[0] === 'push') { pushed = true; return { status: -1, stdout: '' }; }
    return result;
  };
  await assert.rejects(f.first.reserve('qa', disconnected), { code: 'COUNTER_VERIFICATION_FAILED' });
  assert.equal(f.state().buildNumber, 2);
  assert.equal((await f.first.reserve()).buildNumber, 3);
});

test('an unavailable remote never becomes an empty counter', async t => {
  const f = fixture(t);
  const unavailable: Git = async (args, input) => args[0] === 'ls-remote'
    ? { status: 128, stdout: '' } : f.first.git(args, input);
  await assert.rejects(f.first.reserve('qa', unavailable), { code: 'COUNTER_UNAVAILABLE' });
  assert.equal(f.calls.some(args => args[0] === 'push'), false);
});

test('store rejects dirty source but QA records it without changing the checkout', async t => {
  const f = fixture(t);
  writeFileSync(join(f.first.cwd, 'draft.txt'), 'uncommitted work');
  await assert.rejects(f.first.reserve('store'), { code: 'DIRTY_STORE_SOURCE' });
  assert.equal(f.calls.some(args => args[0] === 'push'), false);
  const receipt = await f.first.reserve();
  assert.equal(receipt.sourceDirty, true); assert.equal(readFileSync(join(f.first.cwd, 'draft.txt'), 'utf8'), 'uncommitted work');
});

test('source HEAD changes and newly dirty store work fail before push', async t => {
  for (const mode of ['head', 'dirty']) {
    const f = fixture(t); let changed = false;
    const mutate: Git = async (args, input) => {
      const result = await f.first.git(args, input);
      if (!changed && args.includes('commit-tree')) {
        changed = true; writeFileSync(join(f.first.cwd, 'app.json'), JSON.stringify({ version: 'changed' }));
        if (mode === 'head') { run(f.first.cwd, ['add', 'app.json']); run(f.first.cwd, ['commit', '-m', 'changed source']); }
      }
      return result;
    };
    await assert.rejects(f.first.reserve('store', mutate), { code: mode === 'head' ? 'SOURCE_CHANGED' : 'DIRTY_STORE_SOURCE' });
    assert.equal(f.calls.some(args => args[0] === 'push'), false);
  }
});

test('only the canonical resolved fetch and push origins are admitted', async t => {
  const f = fixture(t);
  for (const invalid of ['https://token@github.com/syscoin/pali-wallet.git', 'https://github.com/elsewhere/pali-wallet.git',
    'https://github.com/syscoin/pali-wallet.git?token=secret', 'https://example.invalid/syscoin/pali-wallet.git',
    'file:///tmp/counter', 'https://github.com/syscoin/pali-wallet.git\nhttps://example.invalid/other']) {
    for (const push of [false, true]) {
      const bad: Git = async (args, input) => args[0] === 'remote' && args.includes('--push') === push
        ? { status: 0, stdout: `${invalid}\n` } : f.first.git(args, input);
      await assert.rejects(f.first.reserve('qa', bad), { code: 'INVALID_ORIGIN' });
    }
  }
  assert.equal(f.calls.some(args => args[0] === 'ls-remote' || args[0] === 'push'), false);
  run(f.first.cwd, ['remote', 'set-url', 'origin', 'git@github.com:syscoin/pali-wallet.git']);
  assert.equal((await f.first.reserve()).buildNumber, 2);
});

test('maximum value and malformed counter state refuse allocation without reset', async t => {
  const f = fixture(t); await f.first.reserve();
  const valid = f.state();
  for (const malformed of [{ ...valid, buildNumber: '2' }, { ...valid, buildNumber: 1 }, { ...valid, buildNumber: 0 },
    { ...valid, schemaVersion: 2 }, { ...valid, extra: true }, { ...valid, purpose: 'release' },
    { ...valid, allocatedAt: 'not-a-date' }, { ...valid, sourceRevision: 'short' }, { ...valid, requestId: 'wrong' }]) {
    f.replaceState(malformed); const before = f.calls.filter(args => args[0] === 'push').length;
    await assert.rejects(f.first.reserve(), { code: 'INVALID_COUNTER_STATE' });
    assert.equal(f.calls.filter(args => args[0] === 'push').length, before);
  }
  f.replaceState({ ...valid, buildNumber: _testing.MAX_BUILD_NUMBERS.mobile - 1 });
  assert.equal((await f.first.reserve()).buildNumber, _testing.MAX_BUILD_NUMBERS.mobile);
  await assert.rejects(f.first.reserve(), { code: 'INVALID_BUILD_NUMBER' });
  assert.equal(f.state().buildNumber, _testing.MAX_BUILD_NUMBERS.mobile);
});

test('counter tree cannot carry any second file', async t => {
  const f = fixture(t); await f.first.reserve();
  f.replaceState(f.state(), true);
  await assert.rejects(f.first.reserve(), { code: 'INVALID_COUNTER_TREE' });
});

test('repeated verified conflicts have a fixed retry limit', async t => {
  const f = fixture(t), rival = f.workspace('rival');
  let pushes = 0;
  const competing: Git = async (args, input) => {
    if (args[0] === 'push') { pushes++; await rival.reserve(); return { status: 1, stdout: '' }; }
    return f.first.git(args, input);
  };
  await assert.rejects(f.first.reserve('qa', competing), { code: 'COUNTER_CONTENTION' });
  assert.equal(pushes, _testing.MAX_ATTEMPTS); assert.equal(f.state().buildNumber, 1 + _testing.MAX_ATTEMPTS);
});

test('public API has no local-remote override or invalid-purpose fallback', async t => {
  const f = fixture(t);
  run(f.first.cwd, ['remote', 'set-url', 'origin', f.remote]);
  await assert.rejects(reserveBuildNumber({ cwd: f.first.cwd, purpose: 'qa', channel: 'mobile' }), { code: 'INVALID_ORIGIN' });
  await assert.rejects(f.first.reserve('production'), { code: 'INVALID_REQUEST' });
});

test('reserved source can be checked again before and after build preparation', async t => {
  const f = fixture(t), receipt = await f.first.reserve('store');
  await assertBuildSource({ cwd: f.first.cwd, receipt });
  writeFileSync(join(f.first.cwd, 'app.json'), JSON.stringify({ version: 'edited' }));
  await assert.rejects(assertBuildSource({ cwd: f.first.cwd, receipt }), { code: 'DIRTY_STORE_SOURCE' });
  await assertBuildSource({ cwd: f.first.cwd, receipt: { ...receipt, purpose: 'qa' } });
  run(f.first.cwd, ['add', 'app.json']); run(f.first.cwd, ['commit', '-m', 'new source']);
  await assert.rejects(assertBuildSource({ cwd: f.first.cwd, receipt }), { code: 'SOURCE_CHANGED' });
});
