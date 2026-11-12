const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { Buffer } = require('node:buffer');
const { createHash } = require('node:crypto');
const { deflateRawSync } = require('node:zlib');

// Test the real install scripts with a tiny bounded artifact. Their separate
// manifest tests continue to verify the production versions and payload hashes.
const scripts = [
  { file: 'apply-walletconnect-terminal.cjs', manifest: './walletconnect-terminal.json', apply: 'applyWalletConnectTerminalPatch', suffix: 'terminal' },
  { file: 'apply-quickcrypto-sentry.cjs', manifest: './quickcrypto-sentry.json', apply: 'applyQuickCryptoSentryPatch', suffix: 'quickcrypto' },
];
const digest = value => createHash('sha256').update(value).digest('hex');
function fixture(script, renameFailure = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-install-write-'));
  const target = path.join(root, 'node_modules/@pali/fixture/candidate.js');
  const before = 'original bytes', after = 'reviewed bytes';
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, before);
  fs.writeFileSync(path.join(path.dirname(target), 'package.json'), JSON.stringify({ name: '@pali/fixture', version: '1.0.0' }));
  const artifact = { ...require('../../../scripts/' + script.manifest.slice(2)), packages: [{ name: '@pali/fixture', version: '1.0.0', files: [{
    path: 'candidate.js', before: digest(before), after: digest(after), bytes: Buffer.byteLength(after), deflate: deflateRawSync(after).toString('base64'),
  }] }] };
  const scriptFile = require.resolve('../../../scripts/' + script.file);
  const module = { exports: {} };
  const filesystem = renameFailure ? { ...fs, renameSync() { throw Object.assign(new Error('injected rename failure'), { code: 'EIO' }); } } : fs;
  vm.runInNewContext(fs.readFileSync(scriptFile, 'utf8'), {
    module, __dirname: path.dirname(scriptFile), process, Buffer,
    require(name) { return name === script.manifest ? artifact : name === 'node:fs' ? filesystem : require(name); },
  }, { filename: scriptFile });
  return { root, target, temporary: `${target}.pali-${script.suffix}-${process.pid}`, before, after,
    apply: () => module.exports[script.apply](root), close: () => fs.rmSync(root, { recursive: true, force: true }) };
}
for (const script of scripts) {
  test(`${script.file} refuses an unowned temporary symlink without touching its target`, () => {
    const f = fixture(script);
    try {
      const external = path.join(f.root, 'external'); fs.writeFileSync(external, 'untouched');
      fs.symlinkSync(external, f.temporary);
      assert.throws(f.apply, { code: 'EEXIST' });
      assert.equal(fs.readFileSync(external, 'utf8'), 'untouched');
      assert.equal(fs.readFileSync(f.target, 'utf8'), f.before);
      assert(fs.lstatSync(f.temporary).isSymbolicLink());
    } finally { f.close(); }
  });
  test(`${script.file} preserves an existing regular temporary file`, () => {
    const f = fixture(script);
    try {
      fs.writeFileSync(f.temporary, 'other process');
      assert.throws(f.apply, { code: 'EEXIST' });
      assert.equal(fs.readFileSync(f.temporary, 'utf8'), 'other process');
      assert.equal(fs.readFileSync(f.target, 'utf8'), f.before);
    } finally { f.close(); }
  });
  test(`${script.file} cleans up only its own temporary file after rename failure`, () => {
    const f = fixture(script, true);
    try {
      assert.throws(f.apply, { code: 'EIO' });
      assert.equal(fs.existsSync(f.temporary), false);
      assert.equal(fs.readFileSync(f.target, 'utf8'), f.before);
    } finally { f.close(); }
  });
  test(`${script.file} installs exact bytes atomically and leaves no temporary file`, () => {
    const f = fixture(script);
    try {
      f.apply();
      assert.equal(fs.readFileSync(f.target, 'utf8'), f.after);
      assert.equal(fs.existsSync(f.temporary), false);
      assert.equal(fs.statSync(f.target).mode & 0o777, 0o600);
    } finally { f.close(); }
  });
}
