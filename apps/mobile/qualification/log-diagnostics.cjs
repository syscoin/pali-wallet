// Runtime logs can contain arguments or credentials. Keep only fixed error codes,
// known native module/library names; never messages or frame identifiers.
const CODES = ['UnsatisfiedLinkError', 'NoClassDefFoundError', 'ClassNotFoundException', 'SecurityException', 'IllegalArgumentException', 'JavascriptException', 'TypeError', 'ReferenceError', 'RangeError', 'Invariant Violation', 'FATAL EXCEPTION', 'SIGSEGV', 'SIGABRT'];
const MODULES = ['PaliWalletCrypto', 'PaliWalletStorage', 'ExpoSQLite', 'NitroModules', 'QuickCrypto'];
const LIBRARIES = ['libQuickCrypto.so', 'libNitroModules.so', 'libexpo-sqlite.so', 'libreactnative.so', 'libhermes.so'];
function summarizeAndroidLog(value) {
  const text = typeof value === 'string' ? value.slice(-128 * 1024) : '';
  return { codes: CODES.filter((value) => text.includes(value)), modules: MODULES.filter((value) => text.includes(value)), libraries: LIBRARIES.filter((value) => text.includes(value)) };
}
module.exports = { summarizeAndroidLog };
