// Runtime logs can contain arguments or credentials. Keep only fixed error codes,
// known native module/library names; never messages or frame identifiers.
const CODES = ['UnsatisfiedLinkError', 'NoClassDefFoundError', 'ClassNotFoundException', 'SecurityException', 'IllegalArgumentException', 'IllegalStateException', 'NullPointerException', 'RuntimeException', 'NoSuchMethodError', 'NoSuchFieldError', 'VerifyError', 'ClassCastException', 'ExceptionInInitializerError', 'StackOverflowError', 'OutOfMemoryError', 'JavascriptException', 'TypeError', 'ReferenceError', 'RangeError', 'Invariant Violation', 'FATAL EXCEPTION', 'SIGSEGV', 'SIGABRT'];
const MODULES = ['PaliWalletCrypto', 'PaliWalletStorage', 'ExpoSQLite', 'NitroModules', 'QuickCrypto'];
const LIBRARIES = ['libQuickCrypto.so', 'libNitroModules.so', 'libexpo-sqlite.so', 'libreactnative.so', 'libhermes.so'];
// android.app.ApplicationExitInfo reason values, never its description or trace.
const EXIT_REASONS = ['UNKNOWN', 'EXIT_SELF', 'SIGNALED', 'LOW_MEMORY', 'CRASH', 'CRASH_NATIVE', 'ANR', 'INITIALIZATION_FAILURE', 'PERMISSION_CHANGE', 'EXCESSIVE_RESOURCE_USAGE', 'USER_REQUESTED', 'USER_STOPPED', 'DEPENDENCY_DIED', 'OTHER', 'FREEZER', 'PACKAGE_STATE_CHANGE', 'PACKAGE_UPDATED'];
function summarizeAndroidLog(value) {
  const text = typeof value === 'string' ? value.slice(-128 * 1024) : '';
  return { codes: CODES.filter((value) => text.includes(value)), modules: MODULES.filter((value) => text.includes(value)), libraries: LIBRARIES.filter((value) => text.includes(value)) };
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
