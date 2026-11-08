const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applyKeyringLedgerPatch, verifyKeyringLedgerPatch } = require('../../../scripts/apply-keyring-ledger.cjs');
const manifest = require('../../../scripts/keyring-ledger-2.1.7.json');

for (const kind of ['node_modules', 'package', 'output', 'dangling-output']) {
  test(`Ledger patch refuses a linked ${kind} without changing another installation`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-ledger-patch-'));
    try {
      const external = path.join(root, 'external');
      fs.mkdirSync(external);
      const sentinel = path.join(external, 'sentinel');
      fs.writeFileSync(sentinel, 'unchanged');
      const installation = path.join(root, 'installation');
      const modules = path.join(installation, 'node_modules');
      const packageRoot = path.join(modules, manifest.package);
      fs.mkdirSync(installation);
      if (kind === 'node_modules') fs.symlinkSync(external, modules);
      else if (kind === 'package') {
        fs.mkdirSync(path.dirname(packageRoot), { recursive: true });
        fs.symlinkSync(external, packageRoot);
      } else {
        fs.mkdirSync(packageRoot, { recursive: true });
        fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: manifest.package, version: manifest.version }));
        const target = path.join(packageRoot, manifest.files[0].path);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.symlinkSync(kind === 'output' ? sentinel : path.join(external, 'absent'), target);
      }
      assert.throws(() => applyKeyringLedgerPatch(packageRoot), /linked installation/);
      assert.throws(() => verifyKeyringLedgerPatch(packageRoot), /linked installation/);
      assert.equal(fs.readFileSync(sentinel, 'utf8'), 'unchanged');
      assert.deepEqual(fs.readdirSync(external), ['sentinel']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
