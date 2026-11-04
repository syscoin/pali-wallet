/* eslint-disable @typescript-eslint/no-var-requires -- Standalone Node shell fixtures run without a transpiler. */
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const script = path.resolve(__dirname, '../configure-chromium-sandbox.sh');
const directory = '/usr/local/lib/pali-chromium-sandbox';
const helper = `${directory}/chrome-sandbox`;
const manifest = '/var/lib/dpkg/info/google-chrome-stable.md5sums';
const bytes = 'fixed installed vendor helper fixture';
const digest = (algorithm, value) =>
  crypto.createHash(algorithm).update(value).digest('hex');
const protectedEntry = (type) => ({
  type,
  owner: '0',
  group: '0',
  mode: '755',
});

// Run the real shell script against a disposable command/filesystem model.
// No production path or privileged command is touched: even sudo is an
// executable stub, and unknown commands/paths are rejected by the model.
const commandSource = String.raw`
const fs = require('node:fs');
const crypto = require('node:crypto');
const file = process.env.SANDBOX_TEST_STATE;
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const args = process.argv.slice(3);
const command = process.argv[2];
const directory = '/usr/local/lib/pali-chromium-sandbox';
const helper = directory + '/chrome-sandbox';
const source = '/opt/google/chrome/chrome-sandbox';
const manifest = '/var/lib/dpkg/info/google-chrome-stable.md5sums';
fs.appendFileSync(process.env.SANDBOX_TEST_CALLS, JSON.stringify([command, ...args]) + '\n');
const save = () => fs.writeFileSync(file, JSON.stringify(state));
const done = (value = '', status = 0) => { save(); if (value) process.stdout.write(value + '\n'); process.exit(status); };
const check = (condition) => { if (!condition) done('Unexpected fixture command: ' + JSON.stringify([command, ...args]), 2); };
const hash = (algorithm, value) => crypto.createHash(algorithm).update(value).digest('hex');
if (command === 'uname') { check(args.join(' ') === '-s'); done(state.platform || 'Linux'); }
if (command === 'id') { check(args.join(' ') === '-u'); done(state.uid || '1001'); }
if (command === 'stat') {
  check(args[0] === '-c' && args[2] === '--' && args.length === 4);
  const entry = state.paths[args[3]];
  if (!entry) done('', 1);
  if (args[1] === '%a') done(entry.mode);
  check(args[1] === '%u:%g:%a:%F');
  done([entry.owner, entry.group, entry.mode, entry.type].join(':'));
}
if (command === 'dpkg-query') {
  if (args[0] === '-W') { check(args.join(' ') === "-W -f=\u0024{Status} google-chrome-stable"); done(state.packageStatus || 'install ok installed'); }
  check(args.join(' ') === '-S ' + source);
  done((state.packageOwner || 'google-chrome-stable') + ': ' + source);
}
if (command === 'awk') { check(args.length === 2 && args[1] === manifest); done(state.expected); }
if (command === 'cat') {
  check(args.join(' ') === '-- ' + source);
  if (state.sourceReadable === false) { process.stderr.write('cat: Permission denied\n'); process.exit(1); }
  // cat and tee run concurrently; this reader never writes the shared model.
  process.stdout.write(state.installBytes || state.sourceBytes);
  process.exit(0);
}
if (command === 'md5sum' || command === 'sha256sum') {
  check(args.length === 1 && args[0] === helper && state.paths[helper]);
  check(state.paths[helper].mode === '4755');
  done(hash(command === 'md5sum' ? 'md5' : 'sha256', state.paths[helper].bytes) + '  ' + helper);
}
if (command === 'sudo') {
  check(args[0] === '-n');
  const operation = args[1];
  if (state.failOperation === operation) done('', 1);
  if (operation === 'mkdir') {
    check(args.slice(2).join(' ') === '-m 755 -- ' + directory);
    if (state.paths[directory]) done('', 1);
    state.paths[directory] = { type: 'directory', owner: '0', group: '0', mode: '755' };
  } else if (operation === 'install') {
    check(args.slice(2).join(' ') === '-o 0 -g 0 -m 600 -- /dev/null ' + helper);
    check(state.paths[directory] && !state.paths[helper]);
    state.paths[helper] = { type: 'regular file', owner: '0', group: '0', mode: '600', bytes: '', ...state.installedMetadata };
  } else if (operation === 'tee') {
    check(args.slice(2).join(' ') === '-- ' + helper && state.paths[helper].mode === '600');
    state.paths[helper].bytes = fs.readFileSync(0, 'utf8');
  } else if (operation === 'md5sum') {
    check(args.slice(2).join(' ') === '-- ' + helper && state.paths[helper].mode === '600');
    done(hash('md5', state.paths[helper].bytes) + '  ' + helper);
  } else if (operation === 'chmod') {
    check(args.slice(2).join(' ') === '4755 -- ' + helper && state.paths[helper]);
    state.paths[helper].mode = state.finalMode || '4755';
    if (state.tamperAfterChmod) state.paths[helper].bytes += ' tampered';
  } else if (operation === 'rm') {
    check(args.slice(2).join(' ') === '-f -- ' + helper);
    delete state.paths[helper];
  } else if (operation === 'rmdir') {
    check(args.slice(2).join(' ') === '-- ' + directory && !state.paths[helper]);
    delete state.paths[directory];
  } else check(false);
  done();
}
check(false);
`;

function runFixture(change) {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pali-sandbox-test-')
  );
  try {
    const bin = path.join(temporary, 'bin');
    fs.mkdirSync(bin);
    const state = {
      calls: [],
      sourceBytes: bytes,
      expected: digest('md5', bytes),
      paths: Object.fromEntries(
        [
          '/',
          '/usr',
          '/usr/local',
          '/usr/local/lib',
          '/var',
          '/var/lib',
          '/var/lib/dpkg',
          '/var/lib/dpkg/info',
        ].map((entry) => [entry, protectedEntry('directory')])
      ),
    };
    for (const entry of [
      manifest,
      '/var/lib/dpkg/info/google-chrome-stable.list',
      '/var/lib/dpkg/status',
    ]) {
      state.paths[entry] = { ...protectedEntry('regular file'), mode: '644' };
    }
    change?.(state);
    const stateFile = path.join(temporary, 'state.json');
    fs.writeFileSync(stateFile, JSON.stringify(state));
    const callsFile = path.join(temporary, 'calls.jsonl');
    fs.writeFileSync(callsFile, '');
    const model = path.join(temporary, 'command.cjs');
    fs.writeFileSync(model, commandSource);
    const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
    for (const name of [
      'uname',
      'id',
      'stat',
      'dpkg-query',
      'awk',
      'cat',
      'md5sum',
      'sha256sum',
      'sudo',
    ]) {
      fs.writeFileSync(
        path.join(bin, name),
        `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(model)} ${quote(
          name
        )} "$@"\n`,
        { mode: 0o755 }
      );
    }
    const githubEnv = path.join(temporary, 'github-env');
    fs.writeFileSync(githubEnv, '');
    const result = spawnSync('/bin/bash', [script], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        SANDBOX_TEST_STATE: stateFile,
        SANDBOX_TEST_CALLS: callsFile,
        GITHUB_ENV: githubEnv,
      },
      encoding: 'utf8',
      timeout: 15000,
    });
    assert.ifError(result.error);
    return {
      ...result,
      state: {
        ...JSON.parse(fs.readFileSync(stateFile, 'utf8')),
        calls: fs
          .readFileSync(callsFile, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line)),
      },
      exported: fs.readFileSync(githubEnv, 'utf8'),
    };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function assertRefused(result, message, { copied = false } = {}) {
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, message);
  assert.equal(result.exported, '');
  assert.equal(result.state.paths[directory], undefined);
  assert.equal(result.state.paths[helper], undefined);
  assert.equal(
    result.state.calls.some(
      ([command, , operation]) => command === 'sudo' && operation === 'install'
    ),
    copied
  );
}

test('reads the source unprivileged into a private target, verifies it, then enables only the protected copy', () => {
  const result = runFixture();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.exported, `CHROME_DEVEL_SANDBOX=${helper}\n`);
  assert.equal(result.state.paths[helper].mode, '4755');
  assert.equal(result.state.paths[helper].bytes, bytes);
  assert.match(result.stdout, new RegExp(digest('sha256', bytes)));
  const calls = result.state.calls;
  const install = calls.findIndex(
    ([command, , operation]) => command === 'sudo' && operation === 'install'
  );
  const read = calls.findIndex(([command]) => command === 'cat');
  const copy = calls.findIndex(
    ([command, , operation]) => command === 'sudo' && operation === 'tee'
  );
  const firstHash = calls.findIndex(
    ([command, , operation]) => command === 'sudo' && operation === 'md5sum'
  );
  const chmod = calls.findIndex(
    ([command, , operation]) => command === 'sudo' && operation === 'chmod'
  );
  assert.ok(
    install < read && install < copy && copy < firstHash && firstHash < chmod
  );
  assert.equal(calls.filter(([command]) => command === 'md5sum').length, 1);
  assert.equal(
    calls.some(
      (entry) =>
        (entry[0] === 'sudo' &&
          entry.some((argument) => argument.startsWith('/opt/'))) ||
        (entry[0] === 'sudo' && entry[2] === 'rm')
    ),
    false
  );
});

test('a source symlink to root-only content cannot be read by the unprivileged copier', () => {
  const secret = 'root-only fixture content must never be copied';
  const result = runFixture((state) => {
    state.sourceReadable = false;
    state.sourceBytes = secret;
  });
  assertRefused(result, /cannot read installed helper as the ordinary user/, {
    copied: true,
  });
  assert.equal(
    (result.stdout + result.stderr + result.exported).includes(secret),
    false
  );
  assert.equal(
    result.state.calls.some(
      ([command, , operation]) =>
        command === 'sudo' && ['chmod', 'md5sum'].includes(operation)
    ),
    false
  );
});

for (const [name, change, message] of [
  [
    'root caller',
    (state) => {
      state.uid = '0';
    },
    /ordinary job user, not root/,
  ],
  [
    'writable destination ancestor',
    (state) => {
      state.paths['/usr/local/lib'].mode = '777';
    },
    /must not be writable/,
  ],
  [
    'symlinked destination ancestor',
    (state) => {
      state.paths['/usr/local'].type = 'symbolic link';
    },
    /not a symlink/,
  ],
  [
    'unowned destination ancestor',
    (state) => {
      state.paths['/usr'].owner = '1001';
    },
    /owned by root:root/,
  ],
  [
    'writable package manifest',
    (state) => {
      state.paths[manifest].mode = '666';
    },
    /must not be writable/,
  ],
  [
    'symlinked package manifest',
    (state) => {
      state.paths[manifest].type = 'symbolic link';
    },
    /not a symlink/,
  ],
  [
    'writable package identity metadata',
    (state) => {
      state.paths['/var/lib/dpkg/info/google-chrome-stable.list'].mode = '666';
    },
    /must not be writable/,
  ],
  [
    'uninstalled package',
    (state) => {
      state.packageStatus = 'deinstall ok config-files';
    },
    /not installed/,
  ],
  [
    'wrong package identity',
    (state) => {
      state.packageOwner = 'different-package';
    },
    /does not belong/,
  ],
  [
    'duplicate manifest digest',
    (state) => {
      state.expected += '\n' + state.expected;
    },
    /exactly one helper digest/,
  ],
]) {
  test(`refuses ${name} before copying or exporting`, () =>
    assertRefused(runFixture(change), message));
}

test('refuses pre-existing state without modifying or cleaning it', () => {
  const existing = { ...protectedEntry('directory'), marker: 'not ours' };
  const result = runFixture((state) => {
    state.paths[directory] = existing;
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /fresh protected helper directory/);
  assert.deepEqual(result.state.paths[directory], existing);
  assert.equal(result.exported, '');
  assert.equal(
    result.state.calls.some(
      ([command, , operation]) =>
        command === 'sudo' &&
        ['install', 'chmod', 'rm', 'rmdir'].includes(operation)
    ),
    false
  );
});

for (const [name, change, message] of [
  [
    'changed source during copy',
    (state) => {
      state.installBytes = bytes + ' changed while copying';
    },
    /does not match/,
  ],
  [
    'copied symlink',
    (state) => {
      state.installedMetadata = { type: 'symbolic link' };
    },
    /not a symlink/,
  ],
  [
    'copied wrong owner',
    (state) => {
      state.installedMetadata = { owner: '1001' };
    },
    /owned by root:root/,
  ],
  [
    'copied setuid mode',
    (state) => {
      state.installedMetadata = { mode: '4755' };
    },
    /initially have mode 600/,
  ],
  [
    'failure enabling setuid',
    (state) => {
      state.failOperation = 'chmod';
    },
    /cannot enable/,
  ],
  [
    'missing setuid after chmod',
    (state) => {
      state.finalMode = '755';
    },
    /must have mode 4755/,
  ],
  [
    'content changed after chmod',
    (state) => {
      state.tamperAfterChmod = true;
    },
    /changed after verification/,
  ],
]) {
  test(`refuses ${name} and cleans only the newly created copy`, () =>
    assertRefused(runFixture(change), message, { copied: true }));
}
