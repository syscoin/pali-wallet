const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readHttpSidecar, readAndroidHttpSidecar } = require('./post-sidecar.cjs');
const name = `pali-native-post-${'a'.repeat(32)}.json`;
test('host sidecars are bounded regular no-follow files; symlinks, directories and FIFOs refuse', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-post-sidecar-'));
  try {
    const file = path.join(root, name); fs.writeFileSync(file, '{"version":1}'); assert.equal(readHttpSidecar(root, name), '{"version":1}');
    fs.writeFileSync(file, ' '.repeat(8193)); assert.throws(() => readHttpSidecar(root, name)); fs.unlinkSync(file);
    fs.symlinkSync('missing', file); assert.throws(() => readHttpSidecar(root, name)); fs.unlinkSync(file);
    fs.mkdirSync(file); assert.throws(() => readHttpSidecar(root, name)); fs.rmdirSync(file);
    assert.equal(spawnSync('mkfifo', [file]).status, 0); assert.throws(() => readHttpSidecar(root, name));
    assert.throws(() => readHttpSidecar(root, '../outside'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('Android reads require fixed names and a finite command/body bound', () => {
  let calls = 0;
  assert.equal(readAndroidHttpSidecar((command, args, optional, timeout) => {
    calls++; assert.equal(command, 'adb'); assert.equal(optional, false); assert.equal(timeout, 5000);
    assert.deepEqual(args.slice(0, 1), ['shell']); assert(args[1].includes('[ ! -L ')); assert(args[1].includes('head -c 8193'));
    return '{}';
  }, name), '{}');
  assert.equal(calls, 1); assert.throws(() => readAndroidHttpSidecar(() => { throw Error('Must not execute'); }, 'invalid;command'));
  assert.throws(() => readAndroidHttpSidecar(() => ' '.repeat(8193), name));
});
