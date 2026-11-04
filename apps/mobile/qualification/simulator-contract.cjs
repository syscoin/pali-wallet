const { CRYPTO_FULL_CASES, isCryptoDiagnostic } = require('../src/crypto/diagnostics.ts');

const MODE = '--ios-simulator-contract';
const SIMULATOR_RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-26-5';
const REFUSAL_STAGES = Object.freeze([
  'ios-policy-protection-missing',
  'ios-policy-protection-none',
  'ios-policy-protection-unless-open',
  'ios-policy-protection-until-auth',
]);
const CHECKS = Object.freeze([
  'native process compatibility',
  'Hermes text and string capabilities',
  'native crypto bridge and full vectors',
  'native factory handles reject direct construction',
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

/** This recognizes a refusal after real crypto checks; it never recognizes custody success. */
function assertSimulatorRefusal(report) {
  const valid = exactKeys(report, [
    'version', 'status', 'phase', 'scenario', 'platform', 'osVersion', 'sessionId',
    'checks', 'networkCalls', 'failedStage', 'cryptoEvidence', 'nativeBridgeExercised',
    'storageDiagnostic', 'cryptoDiagnostic',
  ]) && report.version === 1 && report.status === 'failed' && report.phase === 'create' &&
    report.scenario === 'import' && report.platform === 'ios' && report.osVersion === '26.5' &&
    typeof report.sessionId === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(report.sessionId) &&
    report.failedStage === 'open SQLCipher and device key' && report.networkCalls === 0 &&
    report.nativeBridgeExercised === true &&
    exactKeys(report.storageDiagnostic, ['stage', 'code']) &&
    report.storageDiagnostic.code === 'STORAGE_UNAVAILABLE' && REFUSAL_STAGES.includes(report.storageDiagnostic.stage) &&
    Array.isArray(report.checks) && report.checks.length === CHECKS.length &&
    report.checks.every((check, index) => exactKeys(check, ['name', 'durationMs']) &&
      check.name === CHECKS[index] && duration(check.durationMs)) &&
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

function assertSimulatorTarget(platformName, runtime) {
  if (platformName !== 'iphonesimulator' || runtime !== SIMULATOR_RUNTIME)
    throw Error('Simulator contract requires the pinned Simulator target');
}

module.exports = { qualificationMode, assertSimulatorRefusal, assertSimulatorTarget, REFUSAL_STAGES, CHECKS, TIMED_CRYPTO_CASES };
