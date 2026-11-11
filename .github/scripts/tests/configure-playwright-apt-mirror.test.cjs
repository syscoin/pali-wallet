/* eslint-disable @typescript-eslint/no-var-requires -- Standalone CI fixture. */
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const helper = path.resolve(__dirname, '../configure-playwright-apt-mirror.py');
// Exact bytes emitted by runner-images ubuntu24/20261101.360 configure-apt-sources.sh.
const original =
  'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n';
const kernelFirst =
  'https://mirrors.kernel.org/ubuntu/\tpriority:1\nhttp://azure.archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://archive.ubuntu.com/ubuntu/\tpriority:3\nhttps://security.ubuntu.com/ubuntu/\tpriority:4\n';
const preferred =
  'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://mirrors.kernel.org/ubuntu/\tpriority:2\nhttps://archive.ubuntu.com/ubuntu/\tpriority:3\nhttps://security.ubuntu.com/ubuntu/\tpriority:4\n';
const runner =
  'import importlib.util,sys; s=importlib.util.spec_from_file_location("mirror",sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(m.configure(sys.argv[2],sys.argv[3]))';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-mirror-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'etc/apt');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'apt-mirrors.txt');
  fs.writeFileSync(file, original, { mode: 0o644 });
  return {
    root,
    directory,
    file,
    run: (arch = 'amd64') =>
      spawnSync('python3', ['-IB', '-c', runner, helper, root, arch], {
        encoding: 'utf8',
      }),
  };
}
test('prefers Azure, preserving the fixed fallback, canonical mirrors and file permissions', (t) => {
  const f = fixture(t),
    before = fs.statSync(f.file);
  fs.writeFileSync(path.join(f.directory, 'unrelated'), 'unchanged');
  assert.equal(f.run().status, 0);
  assert.equal(fs.readFileSync(f.file, 'utf8'), preferred);
  const after = fs.statSync(f.file);
  for (const key of ['mode', 'uid', 'gid'])
    assert.equal(after[key], before[key]);
  assert.equal(
    fs.readFileSync(path.join(f.directory, 'unrelated'), 'utf8'),
    'unchanged'
  );
  const repeat = f.run();
  assert.equal(repeat.status, 0, repeat.stderr);
  assert.equal(repeat.stdout.trim(), 'False');
  assert.equal(fs.statSync(f.file).ino, after.ino);
});
test('reorders the exact previous kernel-first list without changing its mirror set', (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.file, kernelFirst);
  assert.equal(f.run().status, 0);
  assert.equal(fs.readFileSync(f.file, 'utf8'), preferred);
  const urls = (value) =>
    value
      .trim()
      .split('\n')
      .map((line) => line.split('\t')[0])
      .sort();
  assert.deepEqual(urls(kernelFirst), urls(preferred));
});
for (const [name, change] of [
  [
    'unknown URL',
    (f) =>
      fs.writeFileSync(
        f.file,
        original.replace('azure.archive.ubuntu.com', 'unexpected.example')
      ),
  ],
  [
    'unexpected priorities',
    (f) =>
      fs.writeFileSync(f.file, original.replace('priority:1', 'priority:7')),
  ],
  [
    'extra entry',
    (f) =>
      fs.appendFileSync(f.file, 'https://unexpected.example/\tpriority:9\n'),
  ],
  ['writable file', (f) => fs.chmodSync(f.file, 0o666)],
  ['writable parent', (f) => fs.chmodSync(f.directory, 0o777)],
  ['hard link', (f) => fs.linkSync(f.file, path.join(f.root, 'link'))],
  [
    'file symlink',
    (f) => {
      fs.renameSync(f.file, path.join(f.root, 'target'));
      fs.symlinkSync(path.join(f.root, 'target'), f.file);
    },
  ],
  [
    'parent symlink',
    (f) => {
      fs.renameSync(f.directory, path.join(f.root, 'target'));
      fs.symlinkSync(path.join(f.root, 'target'), f.directory);
    },
  ],
])
  test('refuses ' + name + ' without changing bytes', (t) => {
    const f = fixture(t);
    change(f);
    const before = fs.readFileSync(f.file);
    assert.notEqual(f.run().status, 0);
    assert.deepEqual(fs.readFileSync(f.file), before);
  });
test('refuses arm64 rather than selecting an amd64 archive', (t) => {
  const f = fixture(t);
  assert.notEqual(f.run('arm64').status, 0);
  assert.equal(fs.readFileSync(f.file, 'utf8'), original);
});
