const test = require('node:test');
const assert = require('node:assert/strict');
const { assertQualificationBuild, parseQualificationLaunch } = require('./launch-parameters.ts');

test('qualification launch arguments require exact isolated bundle identifiers', () => {
  assert.doesNotThrow(() => assertQualificationBuild('com.paliwallet.qualification', 'com.paliwallet.qualification'));
  for (const identifiers of [['com.paliwallet.mobile', 'com.paliwallet.qualification'], ['com.paliwallet.qualification', 'com.paliwallet.mobile'], [undefined, undefined]])
    assert.throws(() => assertQualificationBuild(...identifiers), /QUALIFICATION_BUILD_IDENTIFIER_REQUIRED/);
});

test('public create and restart arguments parse without a wallet or native-module import', () => {
  const address = '0x' + 'A1'.repeat(20);
  assert.deepEqual(parseQualificationLaunch('pali-wallet-qualification://run?phase=create&scenario=generate'), { phase: 'create', scenario: 'generate', address: null });
  assert.deepEqual(parseQualificationLaunch(`pali-wallet-qualification://run?phase=restart&scenario=import&address=${address}`), { phase: 'restart', scenario: 'import', address });
});

test('untrusted launch arguments cannot select an alternate route, credential, or parameter set', () => {
  const base = 'pali-wallet-qualification://run?phase=create&scenario=import';
  for (const value of [undefined, null, {}, '', 'x'.repeat(2049), base.replace('run?', 'other?'), base.replace('run?', 'run/path?'), base.replace('qualification:', 'mobile:'), base.replace('//run', '//user@run'), base + '&phase=restart', base + '&unknown=1', base + '#fragment', base + '&address=0x' + '11'.repeat(20), base.replace('create', 'restart'), base.replace('create', 'delete'), base.replace('import', 'restore')])
    assert.throws(() => parseQualificationLaunch(value), /QUALIFICATION_LINK_INVALID/);
});
