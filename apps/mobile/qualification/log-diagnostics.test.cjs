const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeAndroidLog, summarizeAndroidExitInfo } = require('./log-diagnostics.cjs');

test('Android runtime evidence retains only fixed code/module/library identifiers', () => {
  const log = `FATAL EXCEPTION: main\njava.lang.UnsatisfiedLinkError: libQuickCrypto.so secret-phrase secret-password\n at com.example.NativeBridge.install(NativeBridge.java:123)\nReferenceError: PaliWalletCrypto secret-phrase`;
  const result = summarizeAndroidLog(log);
  assert(result.codes.includes('UnsatisfiedLinkError'));
  assert(result.modules.includes('PaliWalletCrypto'));
  assert(result.libraries.includes('libQuickCrypto.so'));
  assert.deepEqual(Object.keys(result).sort(), ['causes', 'codes', 'exceptions', 'frames', 'libraries', 'modules']);
  assert.deepEqual(result.exceptions, ['java.lang.UnsatisfiedLinkError']);
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
    exceptions: [], causes: [], frames: [],
  });
});

test('Java crash classification retains fixed common exceptions from arbitrary error tags', () => {
  const log = 'E/UnknownTag: java.lang.IllegalStateException java.lang.NullPointerException RuntimeException NoSuchMethodError NoSuchFieldError VerifyError ClassCastException ExceptionInInitializerError StackOverflowError OutOfMemoryError synthetic_secret_token_42';
  assert.deepEqual(summarizeAndroidLog(log), {
    codes: ['IllegalStateException', 'NullPointerException', 'RuntimeException', 'NoSuchMethodError', 'NoSuchFieldError', 'VerifyError', 'ClassCastException', 'ExceptionInInitializerError', 'StackOverflowError', 'OutOfMemoryError'],
    modules: [], libraries: [], exceptions: [], causes: [], frames: [],
  });
});

test('Android crash details retain only exact allowlisted exception, cause and frame identifiers', () => {
  const log = `E/AndroidRuntime( 1234): java.lang.RuntimeException: synthetic_secret_token_42
E/AndroidRuntime( 1234):   at android.app.ActivityThread.handleBindApplication(ActivityThread.java:7890)
E/AndroidRuntime( 1234): Caused by: java.lang.ClassNotFoundException: synthetic_secret_token_42
E/AndroidRuntime( 1234):   at com.paliwallet.qualification.MainApplication.onCreate(MainApplication.kt:29)
E/AndroidRuntime( 1234):   at com.facebook.react.synthetic_secret_token_42(secret.java:1)
E/AndroidRuntime( 1234): Caused by: com.private.synthetic_secret_token_42: secret`;
  const result = summarizeAndroidLog(log);
  assert.deepEqual(result.exceptions, ['java.lang.RuntimeException']);
  assert.deepEqual(result.causes, ['java.lang.ClassNotFoundException']);
  assert.deepEqual(result.frames, ['android.app.ActivityThread.handleBindApplication', 'com.paliwallet.qualification.MainApplication.onCreate']);
  assert(!JSON.stringify(result).includes('synthetic_secret_token_42'));
});

test('Android exit history maps only the dedicated process reason codes to fixed labels', () => {
  const history = `ApplicationExitInfo #0:
    timestamp=public pid=1234
    process=com.paliwallet.qualification reason=5 (APP CRASH(NATIVE)) subreason=0 (UNKNOWN) status=6
    description=synthetic_secret_token_42 trace=/private/secret
ApplicationExitInfo #1:
    process=com.paliwallet.qualification reason=10 (USER REQUESTED) subreason=21 (FORCE STOP) status=0
    process=com.other.app reason=4 (APP CRASH(EXCEPTION))
    description=reason=3 (LOW_MEMORY)
    process=com.paliwallet.qualification reason=5 (untrusted label ignored)`;
  assert.deepEqual(summarizeAndroidExitInfo(history), { exitReasons: ['CRASH_NATIVE', 'USER_REQUESTED'] });
  assert(!JSON.stringify(summarizeAndroidExitInfo(history)).includes('secret'));
});

test('Android exit history has bounded input and output and never copies unknown fields', () => {
  assert.deepEqual(summarizeAndroidExitInfo(null), { exitReasons: [] });
  assert.deepEqual(summarizeAndroidExitInfo('failure at synthetic_secret_token_42('), { exitReasons: [] });
  assert.deepEqual(summarizeAndroidExitInfo('process=com.paliwallet.qualification reason=255 (synthetic_secret_token_42)'), { exitReasons: ['UNRECOGNIZED'] });
  assert.deepEqual(summarizeAndroidExitInfo('x'.repeat(128 * 1024) + '\nprocess=com.paliwallet.qualification reason=5 (APP CRASH(NATIVE))'), { exitReasons: [] });
  const history = Array.from({ length: 17 }, (_, index) => `process=com.paliwallet.qualification reason=${index} (ignored)`).join('\n');
  assert.equal(summarizeAndroidExitInfo(history).exitReasons.length, 8);
});
