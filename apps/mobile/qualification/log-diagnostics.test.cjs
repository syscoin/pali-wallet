const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeAndroidLog } = require('./log-diagnostics.cjs');

test('Android runtime evidence retains only fixed code/module/library identifiers', () => {
  const log = `FATAL EXCEPTION: main\njava.lang.UnsatisfiedLinkError: libQuickCrypto.so secret-phrase secret-password\n at com.example.NativeBridge.install(NativeBridge.java:123)\nReferenceError: PaliWalletCrypto secret-phrase`;
  const result = summarizeAndroidLog(log);
  assert(result.codes.includes('UnsatisfiedLinkError'));
  assert(result.modules.includes('PaliWalletCrypto'));
  assert(result.libraries.includes('libQuickCrypto.so'));
  assert.deepEqual(Object.keys(result).sort(), ['codes', 'libraries', 'modules']);
  assert(!JSON.stringify(result).includes('com.example.NativeBridge.install'));
  assert(!JSON.stringify(result).includes('secret-'));
  assert(JSON.stringify(summarizeAndroidLog('x'.repeat(200000))).length < 1000);
});

test('Android runtime evidence discards identifier-shaped secrets embedded in messages', () => {
  const log = 'E/ReactNativeJS: ReferenceError: failure at synthetic_secret_token_42(';
  assert.deepEqual(summarizeAndroidLog(log), {
    codes: ['ReferenceError'],
    modules: [],
    libraries: [],
  });
});
