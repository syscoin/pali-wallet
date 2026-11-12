import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once, EventEmitter, getEventListeners } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';

const scripts = fileURLToPath(new NodeURL('../scripts/', import.meta.url));
async function waitFor(file: string) {
  const end = Date.now() + 5000;
  while (!existsSync(file)) {
    if (Date.now() >= end) throw Error(`Fixture did not reach ${file}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function fixture() {
  const temporary = mkdtempSync(join(tmpdir(), 'pali-build-interruption-'));
  const root = join(temporary, 'apps/mobile');
  const runner = join(root, 'scripts/run-native-build.cjs');
  mkdirSync(dirname(runner), { recursive: true });
  mkdirSync(join(temporary, 'scripts'));
  mkdirSync(join(root, 'node_modules/expo/bin'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '5.0.0' }));
  writeFileSync(join(root, 'app.json'), JSON.stringify({ expo: { version: '5.0.0',
    ios: { bundleIdentifier: 'com.paliwallet.mobile' }, android: { package: 'com.paliwallet.mobile' } } }));
  writeFileSync(join(root, 'node_modules/expo/package.json'), '{}');
  writeFileSync(runner, readFileSync(join(scripts, 'run-native-build.cjs'), 'utf8') + `
    process.once('beforeExit', () => fs.writeFileSync(${JSON.stringify(join(temporary, 'listeners'))},
      JSON.stringify(['SIGINT', 'SIGTERM', 'SIGTSTP', 'SIGCONT'].map(signal => process.listenerCount(signal)))));
  `);
  writeFileSync(join(root, 'scripts/owned-build-child.cjs'), readFileSync(join(scripts, 'owned-build-child.cjs')));
  writeFileSync(join(root, 'scripts/native-build-number.cjs'), `
    const fs = require('node:fs'), path = require('node:path');
    exports.reserveBuildNumber = async ({ cwd, purpose }) => {
      const file = path.join(cwd, 'counter');
      const buildNumber = (fs.existsSync(file) ? Number(fs.readFileSync(file)) : 1) + 1;
      fs.writeFileSync(file, String(buildNumber));
      if (process.env.PALI_TEST_PHASE === 'reserve') {
        fs.writeFileSync(${JSON.stringify(join(temporary, 'ready'))}, '{}');
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      return { buildNumber, purpose };
    };
    exports.assertBuildSource = async () => {};
  `);
  const leaf = join(temporary, 'leaf.cjs');
  writeFileSync(leaf, `
    const fs = require('node:fs');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
      fs.writeFileSync(${JSON.stringify(join(temporary, 'signalled'))}, signal);
      setTimeout(() => { fs.writeFileSync(${JSON.stringify(join(temporary, 'drained'))}, 'yes'); process.exit(0); }, 200);
    });
    let heartbeat = 0;
    setInterval(() => fs.writeFileSync(${JSON.stringify(join(temporary, 'heartbeat'))}, String(++heartbeat)), 20);
    fs.writeFileSync(${JSON.stringify(join(temporary, 'ready'))}, JSON.stringify({ child: process.ppid, leaf: process.pid }));
  `);
  const body = `
    const fs = require('node:fs'), { spawn } = require('node:child_process');
    const phase = process.argv[2] === '--app' ? 'assets' : process.argv[2];
    fs.appendFileSync(${JSON.stringify(join(temporary, 'phases'))}, phase + '\\n');
    if (phase === process.env.PALI_TEST_PHASE) {
      const leaf = spawn(process.execPath, [${JSON.stringify(leaf)}], { stdio: 'inherit' });
      if (process.env.PALI_TEST_ABANDON) {
        const ready = setInterval(() => {
          if (!fs.existsSync(${JSON.stringify(join(temporary, 'ready'))})) return;
          clearInterval(ready);
          if (process.env.PALI_TEST_ABANDON === 'signal') process.kill(process.pid, 'SIGTERM');
          else process.exit(Number(process.env.PALI_TEST_ABANDON));
        }, 10);
      } else {
        for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {});
        leaf.on('close', () => process.exit(0));
      }
    }
  `;
  writeFileSync(join(temporary, 'scripts/prepare-native-private-prover.cjs'), body);
  writeFileSync(join(root, 'node_modules/expo/bin/cli'), body);
  const start = (phase: string, abandon = '') => {
    const child = spawn(process.execPath, [runner, 'ios'], { cwd: root,
      env: { ...process.env, PALI_TEST_PHASE: phase, PALI_TEST_ABANDON: abandon }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    return { child, output: () => output, closed: once(child, 'close') };
  };
  return { temporary, root, start, lock: join(root, '.pali-build/inflight'),
    file: (name: string) => join(temporary, name),
    close() {
      if (!existsSync(join(temporary, 'drained')) && existsSync(join(temporary, 'ready'))) {
        const pids = JSON.parse(readFileSync(join(temporary, 'ready'), 'utf8'));
        for (const pid of [pids.leaf, pids.child]) if (pid) {
          try { process.kill(pid, 'SIGKILL'); } catch {}
        }
      }
      rmSync(temporary, { recursive: true, force: true });
    } };
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  for (const phase of ['assets', 'prebuild', 'run:ios']) {
    test(`${signal} drains only its ${phase} child tree before releasing the build lock`, { skip: process.platform === 'win32', timeout: 15000 }, async () => {
      const f = fixture(), first = f.start(phase);
      try {
        await waitFor(f.file('ready'));
        assert(existsSync(f.lock));
        first.child.kill(signal);
        await waitFor(f.file('signalled'));
        assert(existsSync(f.lock), 'lock must remain while the owned grandchild drains');
        assert.equal(first.child.exitCode, null);
        const [code] = await first.closed;
        assert.equal(code, signal === 'SIGINT' ? 130 : 143, first.output());
        assert(existsSync(f.file('drained')));
        assert(!existsSync(f.lock));
        assert.deepEqual(JSON.parse(readFileSync(f.file('listeners'), 'utf8')), [0, 0, 0, 0]);
        assert.equal(readFileSync(f.file('phases'), 'utf8').trim().split('\n').at(-1), phase);
        assert(existsSync(join(f.root, '.pali-build/build-2.json')));
        const second = f.start('none');
        assert.equal((await second.closed)[0], 0, second.output());
        assert(!existsSync(f.lock));
        assert(existsSync(join(f.root, '.pali-build/build-3.json')));
      } finally {
        if (first.child.exitCode === null && first.child.signalCode === null) first.child.kill('SIGTERM');
        f.close();
      }
    });
  }
  test(`${signal} during allocation burns the receipt but starts no later phase`, { timeout: 10000 }, async () => {
    const f = fixture(), build = f.start('reserve');
    try {
      await waitFor(f.file('ready'));
      build.child.kill(signal);
      assert(existsSync(f.lock));
      assert.equal((await build.closed)[0], signal === 'SIGINT' ? 130 : 143, build.output());
      assert(!existsSync(f.file('phases')));
      assert(existsSync(join(f.root, '.pali-build/build-2.json')));
      assert(!existsSync(f.lock));
      assert.deepEqual(JSON.parse(readFileSync(f.file('listeners'), 'utf8')), [0, 0, 0, 0]);
    } finally {
      if (build.child.exitCode === null && build.child.signalCode === null) build.child.kill('SIGTERM');
      f.close();
    }
  });
}

for (const abandon of ['0', '7', 'signal']) {
  test(`a child exit ${abandon} cannot leave a live descendant or start the next phase`, { skip: process.platform === 'win32', timeout: 15000 }, async () => {
    const f = fixture(), build = f.start('prebuild', abandon);
    try {
      await waitFor(f.file('signalled'));
      assert(existsSync(f.lock));
      assert.equal((await build.closed)[0], 1, build.output());
      assert(existsSync(f.file('drained')));
      assert(!existsSync(f.lock));
      assert.equal(readFileSync(f.file('phases'), 'utf8').trim(), 'assets\nprebuild');
      assert.deepEqual(JSON.parse(readFileSync(f.file('listeners'), 'utf8')), [0, 0, 0, 0]);
    } finally {
      if (build.child.exitCode === null && build.child.signalCode === null) build.child.kill('SIGTERM');
      f.close();
    }
  });
}

test('terminal suspend and resume also stop and continue the owned child group', { skip: process.platform === 'win32', timeout: 15000 }, async () => {
  const f = fixture(), build = f.start('assets');
  try {
    await waitFor(f.file('heartbeat'));
    build.child.kill('SIGTSTP');
    await new Promise(resolve => setTimeout(resolve, 100));
    const paused = readFileSync(f.file('heartbeat'), 'utf8');
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(readFileSync(f.file('heartbeat'), 'utf8'), paused);
    assert(existsSync(f.lock));
    build.child.kill('SIGCONT');
    const deadline = Date.now() + 5000;
    while (readFileSync(f.file('heartbeat'), 'utf8') === paused) {
      assert(Date.now() < deadline, 'owned child did not resume');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    build.child.kill('SIGTERM');
    assert.equal((await build.closed)[0], 143, build.output());
    assert(!existsSync(f.lock));
    assert.deepEqual(JSON.parse(readFileSync(f.file('listeners'), 'utf8')), [0, 0, 0, 0]);
  } finally {
    if (build.child.exitCode === null && build.child.signalCode === null) { build.child.kill('SIGCONT'); build.child.kill('SIGTERM'); }
    f.close();
  }
});

test('an interrupted platform without provable descendant drainage keeps the lock policy', async () => {
  const controller = new AbortController();
  const child = Object.assign(new EventEmitter(), { pid: 321, kill() { queueMicrotask(() => child.emit('close', 0, null)); }, unref() {} });
  const exports = { exports: {} as { runOwnedBuildChild(...args: unknown[]): Promise<unknown> } };
  runInNewContext(readFileSync(join(scripts, 'owned-build-child.cjs'), 'utf8'), {
    module: exports, process: { platform: 'win32' }, setTimeout, clearTimeout,
    require(name: string) { assert.equal(name, 'node:child_process'); return { spawn: () => child }; },
  });
  const waiting = exports.exports.runOwnedBuildChild('node', [], { signal: controller.signal });
  controller.abort('SIGINT');
  await assert.rejects(waiting, (error: unknown) => (error as { preserveLock: boolean }).preserveLock === true);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});
