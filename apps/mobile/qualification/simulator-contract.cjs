const { CRYPTO_FULL_CASES, isCryptoDiagnostic } = require('../src/crypto/diagnostics.ts');
const { SENTRY_CLASSICAL_CHECK } = require('./native-sentry-classical.ts');
const { SENTRY_SHAKE_CHECK } = require('./native-sentry-shake.ts');

const MODE = '--ios-simulator-contract';

const REFUSAL_STAGES = Object.freeze([
  'ios-policy-protection-missing',
  'ios-policy-protection-none',
  'ios-policy-protection-unless-open',
  'ios-policy-protection-until-auth',
]);
const CHECKS = Object.freeze([
  'Hermes text and string capabilities',
  'native crypto bridge and full vectors',
  'native factory handles reject direct construction',
  'native public Merkle and HMAC vectors',
  'native SLH leaf setup vector',
  SENTRY_CLASSICAL_CHECK,
  SENTRY_SHAKE_CHECK,
]);
// The remaining labels are substeps, not completed timed cases.
const TIMED_CRYPTO_CASES = Object.freeze(CRYPTO_FULL_CASES.filter((name) =>
  name !== 'sdk-hkdf-key-import' && name !== 'sdk-hkdf-domain-key' && !name.endsWith(':key-import')));

function qualificationMode(platform, args) {
  if (args.length === 0) return 'full';
  if (platform === 'ios' && args.length === 1 && args[0] === MODE) return 'ios-simulator-contract';
  throw Error('Unknown or incompatible native qualification mode');
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

const duration = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 300000;
const completedCryptoChecks = (checks) => Array.isArray(checks) && CHECKS.every((name, index) =>
  exactKeys(checks[index], ['name', 'durationMs']) && checks[index].name === name && duration(checks[index].durationMs));

/** This recognizes a refusal after real crypto checks; it never recognizes custody success. */
function assertSimulatorRefusal(report, expectedVersion, expectedQuickCryptoIdentity) {
  const valid = exactKeys(report, [
    'version', 'status', 'phase', 'scenario', 'platform', 'osVersion', 'sessionId',
    'checks', 'networkCalls', 'failedStage', 'cryptoEvidence', 'nativeBridgeExercised',
    'storageDiagnostic', 'cryptoDiagnostic',
    ...(expectedQuickCryptoIdentity ? ['quickCryptoIdentity'] : []),
  ]) && report.version === 1 && report.status === 'failed' && report.phase === 'create' &&
    report.scenario === 'import' && report.platform === 'ios' && typeof expectedVersion === 'string' && /^\d+(?:\.\d+){0,2}$/.test(expectedVersion) && report.osVersion === expectedVersion &&
    typeof report.sessionId === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(report.sessionId) &&
    report.failedStage === 'open SQLCipher and device key' && report.networkCalls === 0 &&
    report.nativeBridgeExercised === true &&
    exactKeys(report.storageDiagnostic, ['stage', 'code']) &&
    report.storageDiagnostic.code === 'STORAGE_UNAVAILABLE' && REFUSAL_STAGES.includes(report.storageDiagnostic.stage) &&
    (!expectedQuickCryptoIdentity || report.quickCryptoIdentity === expectedQuickCryptoIdentity) &&
    completedCryptoChecks(report.checks) && report.checks.length === CHECKS.length &&
    exactKeys(report.cryptoEvidence, ['passed', 'productionIterations', 'cases']) &&
    report.cryptoEvidence.passed === true && report.cryptoEvidence.productionIterations === 900000 &&
    Array.isArray(report.cryptoEvidence.cases) && report.cryptoEvidence.cases.length === TIMED_CRYPTO_CASES.length &&
    report.cryptoEvidence.cases.every((entry, index) => exactKeys(entry, ['name', 'milliseconds']) &&
      entry.name === TIMED_CRYPTO_CASES[index] && duration(entry.milliseconds)) &&
    isCryptoDiagnostic(report.cryptoDiagnostic) &&
    exactKeys(report.cryptoDiagnostic, ['bootstrap', 'fullCase']) &&
    report.cryptoDiagnostic.bootstrap === 'ready' &&
    report.cryptoDiagnostic.fullCase === 'opaque-key-owner-and-disposal';
  if (!valid) throw Error('Unexpected iOS Simulator refusal evidence');
}

function assertSimulatorTarget(platformName, runtime, expectedRuntime) {
  if (platformName !== 'iphonesimulator' ||
      typeof expectedRuntime !== 'string' ||
      !/^com\.apple\.CoreSimulator\.SimRuntime\.iOS-[0-9]+(?:-[0-9]+){0,2}$/.test(expectedRuntime) ||
      runtime !== expectedRuntime)
    throw Error('Simulator contract requires the selected Simulator target');
}

/** Select once from the actual inventory; an explicit unavailable target never falls back. */
function selectSimulatorTarget(runtimes, types, requestedRuntime, requestedType) {
  if (!Array.isArray(runtimes) || runtimes.length > 256 || !Array.isArray(types) || types.length > 1024)
    throw Error('Invalid Simulator inventory');
  const available = runtimes.filter(item => item?.isAvailable === true &&
    typeof item.identifier === 'string' && typeof item.version === 'string' &&
    /^\d+(?:\.\d+){0,2}$/.test(item.version) &&
    item.identifier === `com.apple.CoreSimulator.SimRuntime.iOS-${item.version.replace(/\./g, '-')}`);
  if (new Set(available.map(item => item.identifier)).size !== available.length)
    throw Error('Ambiguous Simulator inventory');
  const runtime = requestedRuntime === undefined
    ? [...available].sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true })).at(-1)
    : available.find(item => item.identifier === requestedRuntime);
  const type = requestedType === undefined
    ? types.find(item => item?.identifier === 'com.apple.CoreSimulator.SimDeviceType.iPhone-17') ??
      types.find(item => typeof item?.identifier === 'string' && item.identifier.startsWith('com.apple.CoreSimulator.SimDeviceType.iPhone-'))
    : types.find(item => item?.identifier === requestedType && typeof requestedType === 'string' && requestedType.startsWith('com.apple.CoreSimulator.SimDeviceType.iPhone-'));
  if (!runtime || !type) throw Error('No installed selected iOS Simulator target');
  return Object.freeze({ runtime: Object.freeze({ identifier: runtime.identifier, version: runtime.version }),
    type: Object.freeze({ identifier: type.identifier }) });
}

module.exports = { qualificationMode, assertSimulatorRefusal, assertSimulatorTarget, selectSimulatorTarget, completedCryptoChecks, REFUSAL_STAGES, CHECKS, TIMED_CRYPTO_CASES };
