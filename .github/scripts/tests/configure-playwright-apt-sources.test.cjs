/* eslint-disable @typescript-eslint/no-var-requires -- Standalone Node fixtures run without a transpiler. */
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const script = path.resolve(
  __dirname,
  '../configure-playwright-apt-sources.py'
);
const mirror = 'mirror+file:/etc/apt/apt-mirrors.txt';
const securityMirror = 'mirror+file:/etc/apt/apt-security-mirrors.txt';
const archive = 'https://archive.ubuntu.com/ubuntu';
const security = 'https://security.ubuntu.com/ubuntu';
// The pinned ubuntu24/20261101.360 configure-apt-sources.sh substitutes this
// exact mirror URI in ubuntu.sources. Keep Ubuntu's Deb822 fields/comments.
const source = `# Ubuntu archive
Types: deb
URIs: ${mirror}
Suites: noble noble-updates noble-backports
Components: main universe restricted multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg

# Ubuntu security
Types: deb
URIs: ${mirror}
Suites: noble-security
Components: main universe restricted multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
`;
const expected = source.replace(mirror, archive).replace(mirror, security);
const invoke = `
import importlib.util, json, pathlib, sys
spec = importlib.util.spec_from_file_location("apt_sources", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
data = json.load(sys.stdin)
try:
    print(module.configure(pathlib.Path(data["root"]), data["os"], data["version"], data["architecture"]))
except (ValueError, OSError) as error:
    print(str(error), file=sys.stderr)
    sys.exit(1)
`;

function fixture(t, change) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-apt-sources-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'etc/apt/sources.list.d');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'ubuntu.sources');
  fs.writeFileSync(file, source, { mode: 0o644 });
  const input = { root, os: 'ubuntu', version: '24.04', architecture: 'amd64' };
  change?.({ root, directory, file, input });
  const run = () =>
    spawnSync('python3', ['-IB', '-c', invoke, script], {
      input: JSON.stringify(input),
      encoding: 'utf8',
    });
  return { root, directory, file, input, run };
}

test('all apt consumers pin the supported image and hash the source helper', () => {
  for (const [file, jobs] of [
    ['main.yml', ['visual', 'conformance']],
    ['mobile.yml', ['browser']],
    ['browser-cache.yml', ['warm']],
  ]) {
    const workflow = fs.readFileSync(
      path.resolve(__dirname, '../../workflows', file),
      'utf8'
    );
    for (const job of jobs) {
      const body = workflow
        .split('\n  ' + job + ':\n')[1]
        .split(/\n  [a-z][\w-]*:\n/)[0];
      assert.match(body, /runs-on: ubuntu-24\.04\n/);
      assert.match(
        body,
        /hashFiles\([^\n]*'\.github\/scripts\/configure-playwright-apt-sources\.py'/
      );
      assert.match(body, /bash .*verify-playwright-apt-cache\.sh/);
    }
  }
  const verifier = fs.readFileSync(
    path.resolve(__dirname, '../verify-playwright-apt-cache.sh'),
    'utf8'
  );
  assert.ok(
    verifier.indexOf('configure-playwright-apt-sources.py') <
      verifier.indexOf('archives=(')
  );
  assert.match(verifier, /APT::Update::Error-Mode=any/);
  assert.match(verifier, /sudo -u _apt/);
});

test('rewrites only the two Ubuntu URIs, preserving fields, mode and unrelated sources', (t) => {
  const other =
    '\nTypes: deb\nURIs: https://vendor.example/packages\nSuites: noble\nComponents: stable\nSigned-By:\n /vendor/keyring.gpg\nEnabled: yes\n';
  const value = fixture(t, ({ directory, file }) => {
    fs.appendFileSync(file, other);
    fs.writeFileSync(
      path.join(directory, 'vendor.sources'),
      'untouched vendor source'
    );
  });
  const before = fs.statSync(value.file);
  const result = value.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(value.file, 'utf8'), expected + other);
  const after = fs.statSync(value.file);
  assert.equal(after.mode, before.mode);
  assert.equal(after.uid, before.uid);
  assert.equal(after.gid, before.gid);
  assert.equal(
    fs.readFileSync(path.join(value.directory, 'vendor.sources'), 'utf8'),
    'untouched vendor source'
  );
  const repeat = value.run();
  assert.equal(repeat.status, 0, repeat.stderr);
  assert.equal(repeat.stdout.trim(), 'False');
  assert.equal(
    fs.statSync(value.file).ino,
    after.ino,
    'no rewrite when already configured'
  );
});

test('accepts the known separate security mirror and already-direct HTTPS sources', (t) => {
  for (const contents of [
    source.replace(
      'URIs: ' + mirror + '\nSuites: noble-security',
      'URIs: ' + securityMirror + '\nSuites: noble-security'
    ),
    expected,
    expected.replace(archive, archive + '/').replace(security, security + '/'),
  ]) {
    const value = fixture(t, ({ file }) => fs.writeFileSync(file, contents));
    const result = value.run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      fs.readFileSync(value.file, 'utf8'),
      contents.includes(mirror) ? expected : contents
    );
  }
});

for (const [name, transform] of [
  ['unknown host', (s) => s.replace(mirror, 'https://unknown.example/ubuntu')],
  [
    'plain HTTP fallback',
    (s) => s.replace(mirror, 'http://archive.ubuntu.com/ubuntu'),
  ],
  [
    'ports archive',
    (s) => s.replace(mirror, 'https://ports.ubuntu.com/ubuntu-ports'),
  ],
  ['unknown mirror file', (s) => s.replace(mirror, 'mirror+file:/tmp/mirrors')],
  [
    'security mirror used for archive',
    (s) => s.replace(mirror, securityMirror),
  ],
  ['multiple URIs', (s) => s.replace(mirror, mirror + ' ' + archive)],
  [
    'continued URI field',
    (s) => s.replace('URIs: ' + mirror, 'URIs:\n ' + mirror),
  ],
  ['wrong suite', (s) => s.replace('noble-updates', 'oracular-updates')],
  [
    'mixed security and archive suites',
    (s) => s.replace('noble-backports', 'noble-backports noble-security'),
  ],
  [
    'wrong keyring',
    (s) =>
      s.replace(
        '/usr/share/keyrings/ubuntu-archive-keyring.gpg',
        '/tmp/unsigned.gpg'
      ),
  ],
  [
    'missing keyring',
    (s) =>
      s.replace(
        'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n',
        ''
      ),
  ],
  [
    'disabled signature verification',
    (s) => s.replace('Types: deb', 'Types: deb\nTrusted: yes'),
  ],
  [
    'duplicate URI field',
    (s) => s.replace('Types: deb', 'Types: deb\nURIs: ' + mirror),
  ],
  [
    'incomplete components',
    (s) => s.replace('main universe restricted multiverse', 'main'),
  ],
  [
    'missing security stanza',
    (s) => s.slice(0, s.indexOf('\n# Ubuntu security')),
  ],
  [
    'duplicate archive stanza',
    (s) => s + '\n' + s.slice(0, s.indexOf('\n# Ubuntu security')),
  ],
  ['oversized source', (s) => s + '#'.repeat(65537)],
]) {
  test('rejects ' + name + ' without writing any source', (t) => {
    const contents = transform(source);
    const value = fixture(t, ({ file }) => fs.writeFileSync(file, contents));
    const result = value.run();
    assert.equal(result.status, 1, result.stderr);
    assert.equal(fs.readFileSync(value.file, 'utf8'), contents);
    assert.deepEqual(fs.readdirSync(value.directory), ['ubuntu.sources']);
  });
}

for (const [name, change] of [
  [
    'non-Ubuntu',
    ({ input }) => {
      input.os = 'debian';
    },
  ],
  [
    'Ubuntu 26',
    ({ input }) => {
      input.version = '26.04';
    },
  ],
  [
    'arm64',
    ({ input }) => {
      input.architecture = 'arm64';
    },
  ],
  ['writable file', ({ file }) => fs.chmodSync(file, 0o666)],
  ['writable directory', ({ directory }) => fs.chmodSync(directory, 0o777)],
  [
    'hard-linked source',
    ({ file, root }) => fs.linkSync(file, path.join(root, 'linked')),
  ],
  [
    'symlinked source',
    ({ file, root }) => {
      const target = path.join(root, 'linked');
      fs.renameSync(file, target);
      fs.symlinkSync(target, file);
    },
  ],
  [
    'symlinked parent',
    ({ directory, root }) => {
      const target = path.join(root, 'linked');
      fs.renameSync(directory, target);
      fs.symlinkSync(target, directory);
    },
  ],
]) {
  test('rejects ' + name + ' before modifying the target', (t) => {
    const value = fixture(t, change);
    const result = value.run();
    assert.equal(result.status, 1, result.stderr);
    assert.equal(fs.readFileSync(value.file, 'utf8'), source);
  });
}
