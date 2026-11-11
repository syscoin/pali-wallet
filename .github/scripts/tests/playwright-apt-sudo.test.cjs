/* eslint-disable @typescript-eslint/no-var-requires -- Standalone CI fixture. */
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const scripts = path.resolve(__dirname, '..');
const prefix = 'apt-get update&& apt-get install -y --no-install-recommends ';
const dependencies = ['libx11-6', 'libglib2.0-0t64', 'fonts-noto-color-emoji'];
const elevationArgs = ['--', 'sh', '-c', prefix + dependencies.join(' ')];
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-apt-sudo-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin'),
    log = path.join(root, 'calls.jsonl');
  fs.mkdirSync(bin);
  const recorder = `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const name=path.basename(process.argv[1]),args=process.argv.slice(2);
const record=value=>fs.appendFileSync(process.env.APT_TEST_LOG,JSON.stringify(value)+'\\n');
if(name==='id') { console.log(process.env.APT_TEST_UID); process.exit(0); }
if(name==='npx') {
  const sudo=spawnSync('which',['sudo'],{encoding:'utf8'}).stdout.trim();
  record({name,args,uid:process.getuid(),sudo,mode:fs.statSync(path.dirname(sudo)).mode&0o777});
  const r=spawnSync('sudo',JSON.parse(process.env.APT_TEST_ELEVATION),{stdio:'inherit'});process.exit(r.status??127);
}
record({name,args});
if(name==='timeout') {
  const end=args.findIndex(arg=>/^[0-9]+s$/.test(arg));
  const r=spawnSync(args[end+1],args.slice(end+2),{stdio:'inherit'});process.exit(r.status??127);
}
process.exit(name==='sudo-real'?Number(process.env.APT_TEST_STATUS):0);
`;
  for (const name of ['sudo-real', 'sudo', 'id', 'npx', 'timeout'])
    fs.writeFileSync(path.join(bin, name), recorder, { mode: 0o755 });
  const original = fs.readFileSync(
    path.join(scripts, 'playwright-apt-sudo.sh'),
    'utf8'
  );
  assert.equal(original.split('exec /usr/bin/sudo ').length, 2);
  const shim = path.join(root, 'playwright-apt-sudo.sh');
  // Only replace the privileged executable with a recorder; never elevate in this test.
  fs.writeFileSync(
    shim,
    original.replace(
      'exec /usr/bin/sudo ',
      `exec '${path.join(bin, 'sudo-real')}' `
    ),
    { mode: 0o755 }
  );
  const wrapper = path.join(root, 'with-playwright-apt-diagnostics.sh');
  fs.copyFileSync(
    path.join(scripts, 'with-playwright-apt-diagnostics.sh'),
    wrapper
  );
  const run = (file, args, extra = {}) =>
    spawnSync('bash', [file, ...args], {
      encoding: 'utf8',
      timeout: 5000,
      env: {
        ...process.env,
        PATH: bin + path.delimiter + process.env.PATH,
        APT_TEST_LOG: log,
        APT_TEST_UID: '1001',
        APT_TEST_STATUS: '0',
        APT_TEST_ELEVATION: JSON.stringify(elevationArgs),
        ...extra,
      },
    });
  return {
    shim,
    wrapper,
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

test('only the root-owned timer receives fixed apt commands and positional dependency names', (t) => {
  const f = fixture(t),
    result = f.run(f.shim, elevationArgs);
  assert.equal(result.status, 0, result.stderr);
  const [call] = f.calls();
  assert.equal(call.name, 'sudo-real');
  assert.deepEqual(call.args.slice(0, 7), [
    '-n',
    '/usr/bin/timeout',
    '--signal=TERM',
    '--kill-after=15s',
    '480s',
    '/bin/sh',
    '-c',
  ]);
  assert.deepEqual(call.args.slice(8), [
    'pali-playwright-apt',
    ...dependencies,
  ]);
  assert.match(
    call.args[7],
    /\/usr\/bin\/apt-get .*APT::Update::Error-Mode=any update &&/
  );
  assert.match(
    call.args[7],
    /\/usr\/bin\/apt-get .*install -y --no-install-recommends "\$@"/
  );
  assert(!dependencies.some((name) => call.args[7].includes(name)));
  assert.equal(
    (call.args[7].match(/Acquire::http::Timeout=20/g) || []).length,
    2
  );
  assert.equal(
    (call.args[7].match(/Acquire::https::Timeout=20/g) || []).length,
    2
  );
});

for (const [name, args] of [
  ['missing arguments', []],
  ['unexpected sudo flags', ['-n', ...elevationArgs]],
  ['other command', ['--', 'sh', '-c', 'echo bad']],
  ['other shell', ['--', 'bash', '-c', prefix + 'libx11-6']],
  ...[
    'libx11-6;id',
    '$(id)',
    '--allow-unauthenticated',
    'libx11-6\nlibnss3',
    'libx11-6\tlibnss3',
    'libx11-6  libnss3',
    'x'.repeat(8192),
  ].map((value) => [
    'unsafe package ' + JSON.stringify(value.slice(0, 32)),
    ['--', 'sh', '-c', prefix + value],
  ]),
])
  test('rejects ' + name + ' before elevation', (t) => {
    const f = fixture(t),
      result = f.run(f.shim, args);
    assert.equal(result.status, 64, result.stderr);
    assert.deepEqual(f.calls(), []);
  });

for (const uid of ['0'])
  test('root invocation cannot bypass the scoped Playwright elevation path', (t) => {
    const f = fixture(t);
    assert.equal(
      f.run(f.shim, elevationArgs, { APT_TEST_UID: uid }).status,
      64
    );
    assert.equal(
      f.run(
        f.wrapper,
        ['npx', 'playwright', 'install', '--with-deps', 'chromium'],
        { APT_TEST_UID: uid }
      ).status,
      64
    );
    assert.deepEqual(f.calls(), []);
  });

for (const args of [
  ['npx', 'playwright', 'install', '--with-deps', 'chromium'],
  ['npx', '--no-install', 'playwright', 'install', '--with-deps', 'chromium'],
])
  for (const status of ['0', '42'])
    test(`scopes elevation and removes its private directory after status ${status}: ${args.join(
      ' '
    )}`, (t) => {
      const f = fixture(t),
        result = f.run(f.wrapper, args, { APT_TEST_STATUS: status });
      assert.equal(result.status, Number(status), result.stderr);
      const calls = f.calls(),
        npx = calls.find((call) => call.name === 'npx');
      assert(npx);
      assert.equal(
        npx.uid,
        process.getuid(),
        'The package manager/browser process remains unprivileged'
      );
      assert.equal(npx.mode, 0o700);
      assert.match(path.dirname(npx.sudo), /pali-playwright-elevation\./);
      assert.equal(fs.existsSync(path.dirname(npx.sudo)), false);
      assert.equal(calls.filter((call) => call.name === 'sudo-real').length, 1);
    });
