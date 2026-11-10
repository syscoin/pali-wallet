import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const { readQualificationSdkPin, verifyInstalledQualificationSdk } = createRequire(import.meta.url)('../scripts/qualification-sdk.cjs');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

test('qualification binds the reviewed candidate archive and installed bytes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pali-sdk-identity-'));
  const root = join(directory, 'apps/mobile'), vendor = join(directory, 'vendor/sysweb3-operation');
  const installed = join(root, 'node_modules/@sidhujag/sysweb3-keyring');
  const filename = 'reviewed.tgz', version = '2.1.11-operation.test';
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: '@sidhujag/sysweb3-keyring', version }),
    'cjs/software.js': 'software fixture', 'cjs/keyring-core.js': 'keyring fixture',
    'cjs/private-records.js': 'record fixture', 'cjs/transactions/syscoin-core.js': 'transaction fixture',
  };
  try {
    mkdirSync(root, { recursive: true }); mkdirSync(vendor, { recursive: true });
    for (const [file, contents] of Object.entries(files)) {
      const location = join(installed, file); mkdirSync(join(location, '..'), { recursive: true }); writeFileSync(location, contents);
    }
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { '@sidhujag/sysweb3-keyring': `file:../../vendor/sysweb3-operation/${filename}` } }));
    writeFileSync(join(vendor, filename), 'archive fixture');
    writeFileSync(join(vendor, 'REVIEWED-CANDIDATE.json'), JSON.stringify({
      status: 'unpublished-review-candidate', repository: 'https://github.com/sidhujag/sysweb3', head: 'a'.repeat(40),
      package: { name: '@sidhujag/sysweb3-keyring', version, filename, sha256: digest('archive fixture') },
      distFiles: Object.fromEntries(Object.entries(files).map(([file, contents]) => [file, digest(contents)])),
    }));
    const pin = readQualificationSdkPin(root);
    assert.match(pin.identity, new RegExp(digest('archive fixture')));
    verifyInstalledQualificationSdk(root, pin);
    writeFileSync(join(installed, 'cjs/keyring-core.js'), 'different installed code');
    assert.throws(() => verifyInstalledQualificationSdk(root, pin), /candidate differs/);
    writeFileSync(join(installed, 'cjs/keyring-core.js'), files['cjs/keyring-core.js']!);
    writeFileSync(join(vendor, filename), 'changed archive');
    assert.throws(() => readQualificationSdkPin(root), /candidate identity mismatch/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
