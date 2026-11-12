const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { composeQualificationSdkIdentity, assertQualificationSdkIdentity, QUALIFICATION_SDK_IDENTITY_STAGE } = require('../scripts/qualificationSdkIdentity.ts');

const version = '2.1.12';
const quick = `quickcrypto.1.1.9.source.${'a'.repeat(40)}.sha256.${'b'.repeat(64)}`;
const fee = `keyring.e75b239.sha256.${'c'.repeat(64)}`;

test('qualification identity includes every present candidate in one exact order', () => {
  assert.equal(composeQualificationSdkIdentity(version), version);
  assert.equal(composeQualificationSdkIdentity(version, quick), `${version}.${quick}`);
  assert.equal(composeQualificationSdkIdentity(version, undefined, fee), `${version}.${fee}`);
  const identity = `${version}.${quick}.${fee}`;
  assert.equal(composeQualificationSdkIdentity(version, quick, fee), identity);
  assert.doesNotThrow(() => assertQualificationSdkIdentity(identity, version, quick, fee));
  for (const actual of [undefined, `${version}.${quick}`, `${version}.${fee}.${quick}`, `${identity}.extra`])
    assert.throws(() => assertQualificationSdkIdentity(actual, version, quick, fee));
  assert.throws(() => assertQualificationSdkIdentity(identity, version, quick));
  assert.throws(() => assertQualificationSdkIdentity(identity, version, quick, `${fee}0`));
});

test('qualification identities reject coercion, empty values and malformed components', () => {
  for (const invalid of [undefined, null, 2, '', '^2.1.12', '2.1', '02.1.12', '2.1.12\n', '2.1.12\r'])
    assert.throws(() => composeQualificationSdkIdentity(invalid));
  for (const invalid of [null, {}, 2, '', 'a b', 'a\n', 'a'.repeat(513)]) {
    assert.throws(() => composeQualificationSdkIdentity(version, invalid));
    assert.throws(() => composeQualificationSdkIdentity(version, quick, invalid));
  }
});

test('native qualification validates the generated fee identity and names identity failures separately', () => {
  const source = fs.readFileSync(require.resolve('./index.tsx'), 'utf8');
  const start = source.indexOf('stage = QUALIFICATION_SDK_IDENTITY_STAGE;');
  const end = source.indexOf('verifiedQuickCryptoIdentity = paliQuickCryptoSentryIdentity;', start);
  assert(start > 0 && end > start);
  const block = source.slice(start, end + 'verifiedQuickCryptoIdentity = paliQuickCryptoSentryIdentity;'.length);
  const run = extra => vm.runInNewContext(`(() => { let stage; let verifiedQuickCryptoIdentity; ${block}; return { stage, verifiedQuickCryptoIdentity }; })()`, {
    Constants: { expoConfig: { extra } }, assertQualificationSdkIdentity, QUALIFICATION_SDK_IDENTITY_STAGE,
    expect(value) { assert(value); },
  });
  const extra = { paliQualificationSdkVersion: version, paliQuickCryptoSentryIdentity: quick,
    paliKeyringFeeRateIdentity: fee, paliQualificationSdkIdentity: composeQualificationSdkIdentity(version, quick, fee) };
  assert.equal(run(extra).stage, QUALIFICATION_SDK_IDENTITY_STAGE);
  assert.equal(run(extra).verifiedQuickCryptoIdentity, quick);
  assert.throws(() => run({ ...extra, paliKeyringFeeRateIdentity: undefined }), /IDENTITY_MISMATCH/);
  assert.throws(() => run({ ...extra, paliKeyringFeeRateIdentity: `${fee}0` }), /IDENTITY_MISMATCH/);
  assert.throws(() => run({ ...extra, paliQualificationSdkIdentity: `${version}.${quick}` }), /IDENTITY_MISMATCH/);
});

test('isolated configuration forwards both candidate components without changing their identity', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-sdk-identity-'));
  try {
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.copyFileSync(require.resolve('../scripts/configure-native-qualification.cjs'), path.join(root, 'scripts/configure-native-qualification.cjs'));
    const pin = { version, quickCryptoIdentity: quick, feeRateIdentity: fee,
      identity: composeQualificationSdkIdentity(version, quick, fee) };
    fs.writeFileSync(path.join(root, 'scripts/qualification-sdk.cjs'), `const pin = ${JSON.stringify(pin)}; module.exports = { readQualificationSdkPin() { return pin; }, verifyInstalledQualificationSdk() {}, readWalletConnectSdkIdentity() {} };`);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ main: 'index.ts' }));
    fs.writeFileSync(path.join(root, 'app.json'), JSON.stringify({ expo: {
      ios: { bundleIdentifier: 'com.paliwallet.mobile' }, android: { package: 'com.paliwallet.mobile', allowBackup: false }, updates: { enabled: false },
    } }));
    fs.writeFileSync(path.join(root, 'index.ts'), '// public configuration fixture');
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/configure-native-qualification.cjs')], {
      env: { CI: 'true', PALI_NATIVE_QUALIFICATION: '1', PALI_NATIVE_HTTP_QUALIFICATION: '0' }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const extra = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo.extra;
    assert.equal(extra.paliQualificationSdkVersion, version);
    assert.equal(extra.paliQuickCryptoSentryIdentity, quick);
    assert.equal(extra.paliKeyringFeeRateIdentity, fee);
    assertQualificationSdkIdentity(extra.paliQualificationSdkIdentity, extra.paliQualificationSdkVersion,
      extra.paliQuickCryptoSentryIdentity, extra.paliKeyringFeeRateIdentity);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
