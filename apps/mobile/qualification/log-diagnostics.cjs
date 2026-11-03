// Runtime logs can contain arguments or credentials. Keep only fixed error codes,
// known native module/library names and exact allowlisted frames; never messages.
const CODES = ['UnsatisfiedLinkError', 'NoClassDefFoundError', 'ClassNotFoundException', 'SecurityException', 'IllegalArgumentException', 'IllegalStateException', 'NullPointerException', 'RuntimeException', 'NoSuchMethodError', 'NoSuchFieldError', 'VerifyError', 'ClassCastException', 'ExceptionInInitializerError', 'StackOverflowError', 'OutOfMemoryError', 'JavascriptException', 'TypeError', 'ReferenceError', 'RangeError', 'Invariant Violation', 'FATAL EXCEPTION', 'SIGSEGV', 'SIGABRT'];
const MODULES = ['PaliWalletCrypto', 'PaliWalletStorage', 'ExpoSQLite', 'NitroModules', 'QuickCrypto'];
const LIBRARIES = ['libQuickCrypto.so', 'libNitroModules.so', 'libexpo-sqlite.so', 'libreactnative.so', 'libhermes.so'];
const EXCEPTIONS = [
  'java.lang.RuntimeException', 'java.lang.IllegalStateException', 'java.lang.NullPointerException',
  'java.lang.ClassNotFoundException', 'java.lang.NoClassDefFoundError', 'java.lang.UnsatisfiedLinkError',
  'java.lang.NoSuchMethodError', 'java.lang.NoSuchFieldError', 'java.lang.VerifyError', 'java.lang.ClassCastException',
  'java.lang.ExceptionInInitializerError', 'java.lang.SecurityException', 'java.lang.IllegalArgumentException',
  'java.lang.StackOverflowError', 'java.lang.OutOfMemoryError', 'kotlin.UninitializedPropertyAccessException',
  'com.facebook.react.common.JavascriptException', 'com.facebook.react.common.DebugServerException',
  'com.facebook.react.bridge.JSApplicationIllegalArgumentException', 'com.facebook.react.bridge.JSApplicationCausedNativeException',
  'com.facebook.soloader.SoLoaderDSONotFoundError', 'com.facebook.soloader.SoLoaderCorruptedLibFileError',
  'expo.modules.kotlin.exception.UnexpectedException', 'expo.modules.kotlin.exception.CodedException',
];
// Only these exact public framework/application frames may be returned. No
// identifier copied from a message or an arbitrary stack frame is retained.
const FRAMES = [
  'android.app.ActivityThread.handleBindApplication', 'android.app.ActivityThread.performLaunchActivity',
  'android.app.ActivityThread.handleLaunchActivity', 'android.app.LoadedApk.makeApplication',
  'android.app.LoadedApk.makeApplicationInner', 'android.app.Instrumentation.newApplication',
  'android.app.Instrumentation.callApplicationOnCreate', 'android.app.AppComponentFactory.instantiateApplication',
  'androidx.core.app.CoreComponentFactory.instantiateApplication', 'android.os.Handler.dispatchMessage',
  'android.os.Looper.loopOnce', 'android.os.Looper.loop',
  'com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative',
  'com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.load',
  'com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.load$default',
  'com.facebook.soloader.SoLoader.init', 'com.facebook.soloader.SoLoader.loadLibrary',
  'com.paliwallet.qualification.MainApplication.onCreate', 'com.paliwallet.qualification.MainActivity.onCreate',
  'com.facebook.react.ReactActivity.onCreate', 'com.facebook.react.ReactActivityDelegate.onCreate',
  'expo.modules.ReactActivityDelegateWrapper.onCreate', 'expo.modules.ApplicationLifecycleDispatcher.onApplicationCreate',
];
// android.app.ApplicationExitInfo reason values, never its description or trace.
const EXIT_REASONS = ['UNKNOWN', 'EXIT_SELF', 'SIGNALED', 'LOW_MEMORY', 'CRASH', 'CRASH_NATIVE', 'ANR', 'INITIALIZATION_FAILURE', 'PERMISSION_CHANGE', 'EXCESSIVE_RESOURCE_USAGE', 'USER_REQUESTED', 'USER_STOPPED', 'DEPENDENCY_DIED', 'OTHER', 'FREEZER', 'PACKAGE_STATE_CHANGE', 'PACKAGE_UPDATED'];
function summarizeAndroidLog(value) {
  const text = typeof value === 'string' ? value.slice(-128 * 1024) : '';
  const exceptions = [], causes = [], frames = [];
  for (const line of text.split('\n')) {
    const body = line.replace(/^[A-Z]\/[^()\r\n]{1,64}\(\s*[0-9]{1,10}\):[ \t]*/, '');
    const exception = body.match(/^[ \t]*(Caused by:[ \t]*)?([A-Za-z_$][A-Za-z0-9_.$]*)(?::|[ \t]*$)/);
    if (exception && EXCEPTIONS.includes(exception[2])) {
      const target = exception[1] ? causes : exceptions;
      if (target.length < 16 && !target.includes(exception[2])) target.push(exception[2]);
    }
    const frame = body.match(/^[ \t]*at ([A-Za-z_$][A-Za-z0-9_.$]*)\([^()\r\n]{1,100}\)[ \t]*$/);
    if (frame && FRAMES.includes(frame[1]) && frames.length < 16 && !frames.includes(frame[1])) frames.push(frame[1]);
  }
  return { codes: CODES.filter((value) => text.includes(value)), modules: MODULES.filter((value) => text.includes(value)), libraries: LIBRARIES.filter((value) => text.includes(value)), exceptions, causes, frames };
}
function summarizeAndroidExitInfo(value) {
  // dumpsys lists recent records first. Keep a bounded prefix and fixed labels.
  const text = typeof value === 'string' ? value.slice(0, 128 * 1024) : '';
  const exitReasons = [];
  for (const match of text.matchAll(/^[ \t]*process=com\.paliwallet\.qualification reason=(0|[1-9][0-9]{0,2}) \(/gm)) {
    const reason = EXIT_REASONS[Number(match[1])] || 'UNRECOGNIZED';
    if (!exitReasons.includes(reason)) exitReasons.push(reason);
    if (exitReasons.length === 8) break;
  }
  return { exitReasons };
}
module.exports = { summarizeAndroidLog, summarizeAndroidExitInfo };
