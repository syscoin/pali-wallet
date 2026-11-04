const EXPECTED_SDK_VERSION = require('../package.json').dependencies['@sidhujag/sysweb3-keyring'];
const { isImportedQualificationReport, matchesImportedRestartEvidence, IMPORTED_REPORT_FIELDS } = require('./imported-evm.ts');
const { isCryptoDiagnostic } = require('../src/crypto/diagnostics.ts');
const { Buffer } = require('node:buffer');
const {
  isStorageQualificationDiagnostic,
} = require('./storage-diagnostics.ts');
const {
  isHdQualificationReport,
  matchesHdRestartEvidence,
} = require('./hd-accounts.ts');
const {
  isErc20QualificationReport,
  matchesErc20RestartEvidence,
} = require('./erc20-transfer.ts');
const {
  isNevmQualificationReport,
  matchesNevmRestartEvidence,
} = require('./nevm-transfer.ts');
const { isZksysQualificationReport, matchesZksysRestartEvidence } = require('./zksys-transfer.ts');
const { isHdKeyRevealQualificationReport, matchesHdKeyRevealRestartEvidence } = require('./hd-key-reveal.ts');
const {
  assertSimulatorRefusal,
  TIMED_CRYPTO_CASES,
  CHECKS,
} = require('./simulator-contract.cjs');
const PUBLIC_PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PUBLIC_PASSWORD = 'PUBLIC native qualification password 2026!';
const FIELDS = new Set([
  ...IMPORTED_REPORT_FIELDS,
  'version',
  'status',
  'phase',
  'scenario',
  'platform',
  'osVersion',
  'sessionId',
  'address',
  'fingerprint',
  'checks',
  'networkCalls',
  'nativeBridgeExercised',
  'sdkVersion',
  'nativeSigningVerified',
  'transferHash',
  'pendingProcessTermination',
  'failedStage',
  'cryptoEvidence',
  'cryptoDiagnostic',
  'mnemonicEntropyVerified',
  'storageDiagnostic',
  'nativeHdAccountsVerified',
  'nativeHdKeyRevealVerified',
  'selectedAccountId',
  'selectedAccountIndex',
  'firstTransferHash',
  'journalContainerVersion',
  'nativeErc20Verified',
  'erc20AccountId',
  'erc20AccountIndex',
  'erc20Address',
  'erc20TransferHash',
  'erc20IntentHash',
  'erc20Signatures',
  'erc20Authorizations',
  'erc20InjectedBroadcasts',
  'erc20RestoredFromJournal',
  'nativeNevmVerified',
  'nevmAccountId',
  'nevmAccountIndex',
  'nevmAddress',
  'nevmTransferHash',
  'nevmEthereumTransferHash',
  'nevmChainId',
  'nevmJournalContainerVersion',
  'nevmRestoredFromJournal',
  'nativeZksysVerified',
  'zksysAccountId',
  'zksysAccountIndex',
  'zksysAddress',
  'zksysTransferHash',
  'zksysChainId',
  'zksysJournalContainerVersion',
  'zksysSignatures',
  'zksysAuthorizations',
  'zksysInjectedBroadcasts',
  'zksysFeeEstimates',
  'zksysRestoredFromJournal',
]);

/** Pure shared checks. File persistence remains owned by the platform runner. */
function decodeNativeReport(
  text,
  platform,
  phase,
  scenario,
  simulatorContract = false,
  simulatorVersion
) {
  if (
    typeof text !== 'string' ||
    !text ||
    text.length > 100000 ||
    text.includes(PUBLIC_PHRASE) ||
    text.includes(PUBLIC_PASSWORD)
  )
    throw Error('Invalid qualification report');
  const report = JSON.parse(text);
  if (
    !report ||
    typeof report !== 'object' ||
    Array.isArray(report) ||
    Object.keys(report).some((key) => !FIELDS.has(key)) ||
    !isHdQualificationReport(report) ||
    !isErc20QualificationReport(report) ||
    !isNevmQualificationReport(report) ||
    !isZksysQualificationReport(report) ||
    !isHdKeyRevealQualificationReport(report) ||
    !isImportedQualificationReport(report) ||
    (report.cryptoDiagnostic !== undefined &&
      !isCryptoDiagnostic(report.cryptoDiagnostic)) ||
    !isStorageQualificationDiagnostic(
      report.storageDiagnostic,
      report.status,
      report.failedStage
    ) ||
    report.phase !== phase ||
    report.scenario !== scenario ||
    report.platform !== platform ||
    report.version !== 1
  )
    throw Error('Unexpected qualification report schema');
  if (simulatorContract) assertSimulatorRefusal(report, simulatorVersion);
  return report;
}

function assertFullNativeReport(report) {
  if (
    report.status !== 'passed' ||
    report.networkCalls !== 0 ||
    report.nativeBridgeExercised !== true ||
    report.nativeSigningVerified !== true ||
    !isHdKeyRevealQualificationReport(report) ||
    !isImportedQualificationReport(report) ||
    report.sdkVersion !== EXPECTED_SDK_VERSION ||
    !/^0x[0-9a-f]{64}$/.test(report.transferHash || '') ||
    report.mnemonicEntropyVerified !==
      (report.phase === 'create' && report.scenario === 'generate') ||
    !/^[0-9a-f]{64}$/.test(report.fingerprint || '') ||
    report.cryptoEvidence?.passed !== true ||
    report.cryptoEvidence?.productionIterations !== 900000
  )
    throw Error(
      `Native qualification failed at ${
        report.failedStage || report.phase
      } (${JSON.stringify(
        report.cryptoDiagnostic || {}
      )}; storage ${JSON.stringify(report.storageDiagnostic)})`
    );
  return report;
}

function decodePhysicalReport(text, expected) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 100000)
    throw Error('Invalid physical report');
  const report = JSON.parse(text);
  if (
    !report ||
    typeof report !== 'object' ||
    Array.isArray(report) ||
    report.physicalRunId !== expected.runId ||
    report.physicalSourceRevision !== expected.sourceRevision ||
    report.physicalBundleIdentifier !== expected.bundleIdentifier
  )
    throw Error('Physical report identity mismatch');
  const {
    physicalRunId,
    physicalSourceRevision,
    physicalBundleIdentifier,
    ...common
  } = report;
  const checked = decodeNativeReport(
    JSON.stringify(common),
    'ios',
    expected.phase,
    expected.scenario
  );
  assertFullNativeReport(checked);
  const duration = (value) =>
    Number.isFinite(value) && value >= 0 && value <= 300000;
  if (
    !Array.isArray(checked.cryptoEvidence.cases) ||
    checked.cryptoEvidence.cases.length !== TIMED_CRYPTO_CASES.length ||
    checked.cryptoEvidence.cases.some(
      (item, index) =>
        !item ||
        Object.keys(item).sort().join(',') !== 'milliseconds,name' ||
        item.name !== TIMED_CRYPTO_CASES[index] ||
        !duration(item.milliseconds)
    ) ||
    !Array.isArray(checked.checks) ||
    checked.checks.some(
      (item) =>
        !item ||
        Object.keys(item).sort().join(',') !== 'durationMs,name' ||
        typeof item.name !== 'string' ||
        !duration(item.durationMs)
    ) ||
    CHECKS.some((name, index) => checked.checks[index]?.name !== name) ||
    !checked.checks.some(
      (item) => item.name === 'synchronous lock and wrong password refusal'
    ) ||
    !checked.checks.some(
      (item) =>
        item.name ===
        (expected.phase === 'create'
          ? 'fresh password-backed seed confirmation'
          : 'seed reauthentication after cold restart')
    )
  )
    throw Error('Physical native checks incomplete');
  if (
    typeof checked.sessionId !== 'string' ||
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(checked.sessionId) ||
    typeof checked.osVersion !== 'string' ||
    !/^\d+(?:\.\d+){0,2}$/.test(checked.osVersion)
  )
    throw Error('Physical process identity invalid');
  return report;
}

function assertPhysicalRestart(created, restored) {
  if (
    created.sessionId === restored.sessionId ||
    created.address !== restored.address ||
    created.fingerprint !== restored.fingerprint ||
    created.physicalRunId !== restored.physicalRunId ||
    created.physicalBundleIdentifier !== restored.physicalBundleIdentifier ||
    created.physicalSourceRevision !== restored.physicalSourceRevision ||
    !matchesHdRestartEvidence(created, restored) ||
    !matchesErc20RestartEvidence(created, restored) ||
    !matchesNevmRestartEvidence(created, restored) ||
    !matchesZksysRestartEvidence(created, restored) ||
    !matchesHdKeyRevealRestartEvidence(created, restored) ||
    !matchesImportedRestartEvidence(created, restored)
  )
    throw Error('Physical cold restart identity mismatch');
}

module.exports = {
  decodeNativeReport,
  assertFullNativeReport,
  decodePhysicalReport,
  assertPhysicalRestart,
};
