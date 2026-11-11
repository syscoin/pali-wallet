/* eslint-disable @typescript-eslint/no-var-requires -- Standalone CI fixture. */
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const scripts = path.resolve(__dirname, '..');
const wrapper = path.join(scripts, 'with-playwright-apt-diagnostics.sh');
const nativeTimeout = spawnSync('sh', ['-c', 'command -v timeout'], {
  encoding: 'utf8',
}).stdout.trim();
const stub = `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const name = path.basename(process.argv[1]), args = process.argv.slice(2);
fs.appendFileSync(process.env.APT_TEST_LOG, JSON.stringify({name,args})+'\\n');
const run = (cmd, argv) => {
  const result = spawnSync(cmd, argv, {stdio:'inherit'});
  if (result.error) throw result.error;
  process.exit(result.status === null ? 137 : result.status);
};
if (name === 'timeout') {
  if (args[2] === '600s' && process.env.APT_TEST_REAL_TIMEOUT === '1')
    run(process.env.APT_TEST_TIMEOUT, ['--signal=TERM','--kill-after=0.2s','0.5s',...args.slice(3)]);
  const end = args.findIndex(arg => /^[0-9]+s$/.test(arg));
  if (end < 0) throw Error('Missing timeout');
  run(args[end+1], args.slice(end+2));
}
if (name === 'sudo') {
  if (args[0] === '-n' && args[1] === 'timeout') run('timeout', args.slice(2));
  if ((args[0] === '-n' && args[1] === 'python3') || args[0] === '-u') process.exit(0);
  throw Error('Unexpected sudo command');
}
if (name === 'apt-get') process.exit(Number(process.env.APT_TEST_UPDATE_STATUS || '0'));
if (name === 'dpkg-deb') {
  const fields = {Package:'fixture', Version:'1.0', Architecture:'amd64'};
  if (args[0] !== '--field' || !fields[args[2]]) throw Error('Unexpected package read');
  console.log(fields[args[2]]); process.exit(0);
}
if (name === 'apt-cache') {
  if (JSON.stringify(args) !== JSON.stringify(['show','--','fixture=1.0'])) throw Error('Unexpected metadata read');
  console.log('SHA256: '+process.env.APT_TEST_SIGNED_HASH); process.exit(0);
}
if (name === 'sha256sum') {
  console.log(crypto.createHash('sha256').update(fs.readFileSync(args[0])).digest('hex')+'  '+args[0]); process.exit(0);
}
if (name === 'stat') { console.log(fs.statSync(args[2]).size); process.exit(0); }
if (name === 'chmod') {
  if (args[0] !== '0644' || args[1] !== '--') throw Error('Unexpected mode change');
  fs.chmodSync(args[2], 0o644); process.exit(0);
}
throw Error('Unexpected fixture command');
`;

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-apt-bounds-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin'),
    cache = path.join(root, 'cache');
  fs.mkdirSync(bin);
  fs.mkdirSync(cache);
  for (const name of [
    'sudo',
    'timeout',
    'apt-get',
    'dpkg-deb',
    'apt-cache',
    'sha256sum',
    'stat',
    'chmod',
  ])
    fs.writeFileSync(path.join(bin, name), stub, { mode: 0o755 });
  const log = path.join(root, 'calls.jsonl');
  const env = {
    ...process.env,
    PATH: bin + path.delimiter + process.env.PATH,
    APT_TEST_LOG: log,
    APT_TEST_TIMEOUT: nativeTimeout,
  };
  const run = (file, args = [], extra = {}) =>
    spawnSync('bash', [file, ...args], {
      env: { ...env, ...extra },
      encoding: 'utf8',
      timeout: 8000,
    });
  return {
    root,
    cache,
    run,
    calls: () =>
      fs.existsSync(log)
        ? fs
            .readFileSync(log, 'utf8')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line))
        : [],
  };
}

function cachedVerifier(f) {
  const source = fs.readFileSync(
    path.join(scripts, 'verify-playwright-apt-cache.sh'),
    'utf8'
  );
  const fixedPath = 'archive_dir=/var/cache/pali-playwright-apt';
  assert.equal(source.split(fixedPath).length, 2);
  const verifier = path.join(f.root, 'verify.sh');
  // Execute the real verifier with only its fixed cache path redirected into this fixture.
  fs.writeFileSync(
    verifier,
    source.replace(fixedPath, `archive_dir='${f.cache}'`)
  );
  const archive = path.join(f.cache, 'fixture_1.0_amd64.deb');
  fs.writeFileSync(archive, 'public fixture archive');
  return {
    verifier,
    archive,
    hash: crypto
      .createHash('sha256')
      .update(fs.readFileSync(archive))
      .digest('hex'),
  };
}

test('bounds the real metadata command and retains signed SHA256 cache verification', (t) => {
  const f = fixture(t),
    { verifier, archive, hash } = cachedVerifier(f);
  const result = f.run(verifier, [], { APT_TEST_SIGNED_HASH: hash });
  assert.equal(result.status, 0, result.stderr);
  assert(fs.existsSync(archive));
  assert(
    f
      .calls()
      .some(
        (call) =>
          call.name === 'sudo' &&
          JSON.stringify(call.args) ===
            JSON.stringify([
              '-n',
              'timeout',
              '--signal=TERM',
              '--kill-after=15s',
              '300s',
              'apt-get',
              'update',
              '-o',
              'Acquire::http::Timeout=20',
              '-o',
              'Acquire::https::Timeout=20',
              '-o',
              'Acquire::Retries=1',
              '-o',
              'APT::Update::Error-Mode=any',
            ])
      )
  );
  assert(f.calls().some((call) => call.name === 'sha256sum'));
  assert(
    f
      .calls()
      .some(
        (call) =>
          call.name === 'sudo' &&
          JSON.stringify(call.args) ===
            JSON.stringify(['-u', '_apt', 'test', '-r', archive])
      )
  );
});

test('failed metadata refresh cannot approve cached archives', (t) => {
  const f = fixture(t),
    { verifier, archive, hash } = cachedVerifier(f);
  const result = f.run(verifier, [], {
    APT_TEST_SIGNED_HASH: hash,
    APT_TEST_UPDATE_STATUS: '42',
  });
  assert.equal(result.status, 42);
  assert(fs.existsSync(archive));
  assert(
    !f
      .calls()
      .some((call) => call.name === 'sha256sum' || call.name === 'apt-cache')
  );
});

test('a cached archive with the wrong signed digest is removed', (t) => {
  const f = fixture(t),
    { verifier, archive } = cachedVerifier(f);
  const result = f.run(verifier, [], { APT_TEST_SIGNED_HASH: '0'.repeat(64) });
  assert.equal(result.status, 0, result.stderr);
  assert(!fs.existsSync(archive));
});

for (const status of [0, 37, 124, 137])
  test(`wrapper preserves command status ${status} without retry`, (t) => {
    const f = fixture(t);
    const result = f.run(wrapper, [
      process.execPath,
      '-e',
      `process.exit(${status})`,
      'argument with spaces',
    ]);
    assert.equal(result.status, status, result.stderr);
    const calls = f.calls(),
      primary = calls.filter(
        (call) => call.name === 'timeout' && call.args[2] === '600s'
      );
    assert.equal(primary.length, 1);
    assert.deepEqual(primary[0].args, [
      '--signal=TERM',
      '--kill-after=15s',
      '600s',
      process.execPath,
      '-e',
      `process.exit(${status})`,
      'argument with spaces',
    ]);
    const probes = calls.filter(
      (call) => call.name === 'timeout' && call.args[2] !== '600s'
    );
    assert.equal(probes.length, status === 0 ? 0 : 15);
    for (const probe of probes)
      assert.deepEqual(probe.args.slice(0, 3), [
        '--kill-after=2s',
        '8s',
        'sudo',
      ]);
  });

test('wrapper timeout terminates an ignoring command and its owned child process', async (t) => {
  assert(nativeTimeout, 'The CI timeout executable is required');
  const f = fixture(t),
    pids = path.join(f.root, 'pids.json');
  const source = `const fs=require('node:fs'),{spawn}=require('node:child_process');process.on('SIGTERM',()=>{});const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});fs.writeFileSync(process.argv[1],JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);`;
  let owned = [];
  t.after(() => {
    for (const pid of owned) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  });
  const result = f.run(wrapper, [process.execPath, '-e', source, pids], {
    APT_TEST_REAL_TIMEOUT: '1',
  });
  if (fs.existsSync(pids)) owned = JSON.parse(fs.readFileSync(pids, 'utf8'));
  assert.equal(result.status, 137, result.stderr);
  assert.equal(owned.length, 2);
  const live = (pid) => {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return false;
      throw error;
    }
    const state = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], {
      encoding: 'utf8',
    });
    if (state.status === 0 && /^\s*Z/.test(state.stdout)) return false;
    return true;
  };
  for (let i = 0; i < 40 && owned.some(live); i++)
    await new Promise((resolve) => setTimeout(resolve, 25));
  assert(
    owned.every((pid) => !live(pid)),
    'No timed-out parent or child may remain running'
  );
});
