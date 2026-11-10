import assert from 'node:assert/strict';
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
  const json = (file: string, value: unknown) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(value));
  };
  for (const host of [root, mobile]) {
    json(path.join(host, 'package.json'), {
      dependencies: { [name]: version },
    });
    json(path.join(host, 'node_modules', name, 'package.json'), {
      name,
      version,
    });
  }
  return {
    root,
    mobile,
    version,
    json,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('both hosts require the same exact published pin and installed version', () => {
  const f = fixture();
  try {
    const expected = { version: f.version, identity: f.version };
    for (const host of [f.root, f.mobile]) {
      assert.deepEqual(readQualificationSdkPin(host), expected);
      verifyInstalledQualificationSdk(host, expected);
    }
  } finally {
    f.dispose();
  }
});

for (const pin of [
  '^2.1.10',
  'latest',
  'file:vendor/sysweb3-keyring-2.1.10.tgz',
  'file:apps/mobile/vendor/sysweb3-keyring-2.1.10.tgz',
  undefined,
])
  test(`qualification refuses a non-exact or temporary package pin: ${pin}`, () => {
    const f = fixture();
    try {
      f.json(path.join(f.mobile, 'package.json'), {
        dependencies: { [name]: pin },
      });
      assert.throws(
        () => readQualificationSdkPin(f.mobile),
        /exact shared keyring pin/
      );
    } finally {
      f.dispose();
    }
  });

test('installed package and captured qualification identity must match', () => {
  const f = fixture();
  try {
    const pin = readQualificationSdkPin(f.mobile);
    for (const metadata of [
      { name, version: '2.1.9' },
      { name: 'another-package', version: f.version },
    ]) {
      f.json(
        path.join(f.mobile, 'node_modules', name, 'package.json'),
        metadata
      );
      assert.throws(
        () => verifyInstalledQualificationSdk(f.mobile, pin),
        /exact manifest version/
      );
    }
    f.json(path.join(f.mobile, 'node_modules', name, 'package.json'), {
      name,
      version: f.version,
    });
    assert.throws(
      () =>
        verifyInstalledQualificationSdk(f.mobile, {
          ...pin,
          identity: `${pin.identity}.changed`,
        }),
      /identity mismatch/
    );
  } finally {
    f.dispose();
  }
});
