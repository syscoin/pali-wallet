import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const { readQualificationSdkPin, verifyInstalledQualificationSdk } =
  createRequire(import.meta.url)('../scripts/qualification-sdk.cjs');
const name = '@sidhujag/sysweb3-keyring';

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'pali-qualified-sdk-pin-'));
  const mobile = path.join(root, 'apps/mobile');
  const version = '2.1.10';
  const filename = `sysweb3-keyring-${version}.tgz`;
  const bytes = Buffer.from('Public candidate identity fixture');
  const json = (file: string, value: unknown) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(value));
  };
  const mobilePin = `file:vendor/${filename}`;
  const lock = { packages: {
    '': { dependencies: { [name]: mobilePin } },
    [`node_modules/${name}`]: { version, resolved: mobilePin,
      integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` },
  } };
  const archive = path.join(mobile, 'vendor', filename);
  mkdirSync(path.dirname(archive), { recursive: true });
  writeFileSync(archive, bytes);
  json(path.join(root, 'package.json'), { dependencies: { [name]: `file:apps/mobile/vendor/${filename}` } });
  json(path.join(mobile, 'package.json'), { dependencies: { [name]: mobilePin } });
  json(path.join(mobile, 'package-lock.json'), lock);
  for (const host of [root, mobile])
    json(path.join(host, 'node_modules', name, 'package.json'), { name, version });
  return { root, mobile, version, bytes, archive, json, lock,
    dispose: () => rmSync(root, { recursive: true, force: true }) };
}

test('both hosts bind the same exact locked candidate and installed version', () => {
  const f = fixture();
  try {
    const rootPin = readQualificationSdkPin(f.root);
    const mobilePin = readQualificationSdkPin(f.mobile);
    assert.deepEqual(rootPin, mobilePin);
    assert.equal(rootPin.version, f.version);
    assert.equal(rootPin.identity, `${f.version}.keyring.${createHash('sha256').update(f.bytes).digest('hex')}`);
    for (const host of [f.root, f.mobile])
      verifyInstalledQualificationSdk(host, readQualificationSdkPin(host));
  } finally { f.dispose(); }
});

test('published exact versions retain their existing qualification identity', () => {
  const f = fixture();
  try {
    f.json(path.join(f.mobile, 'package.json'), { dependencies: { [name]: f.version } });
    assert.deepEqual(readQualificationSdkPin(f.mobile), { version: f.version, identity: f.version });
  } finally { f.dispose(); }
});

for (const change of ['bytes', 'integrity', 'version', 'resolved', 'manifest'] as const)
  test(`candidate ${change} drift fails qualification`, () => {
    const f = fixture();
    try {
      const pin = readQualificationSdkPin(f.mobile);
      const entry = f.lock.packages[`node_modules/${name}`];
      if (change === 'bytes') writeFileSync(f.archive, 'Different public bytes');
      else if (change === 'manifest') f.lock.packages[''].dependencies[name] = '2.1.10';
      else entry[change] = 'mismatched';
      f.json(path.join(f.mobile, 'package-lock.json'), f.lock);
      assert.throws(() => verifyInstalledQualificationSdk(f.mobile, pin), /exact locked archive/);
    } finally { f.dispose(); }
  });

test('installed version mismatch and unrecognized file paths fail qualification', () => {
  const f = fixture();
  try {
    const pin = readQualificationSdkPin(f.mobile);
    f.json(path.join(f.mobile, 'node_modules', name, 'package.json'), { name, version: '2.1.9' });
    assert.throws(() => verifyInstalledQualificationSdk(f.mobile, pin), /exact manifest version/);
    f.json(path.join(f.mobile, 'package.json'), { dependencies: { [name]: 'file:../../other.tgz' } });
    assert.throws(() => readQualificationSdkPin(f.mobile), /repository keyring candidate/);
  } finally { f.dispose(); }
});
