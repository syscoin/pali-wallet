const { readQualificationSdkPin } = require('../scripts/qualification-sdk.cjs');
const EXPECTED_SDK = readQualificationSdkPin(
  require('node:path').dirname(require.resolve('../package.json'))
);
const EXPECTED_SDK_VERSION = EXPECTED_SDK.identity;
const EXPECTED_QUICK_CRYPTO_IDENTITY = EXPECTED_SDK.quickCryptoIdentity;
const { isImportedQualificationReport, matchesImportedRestartEvidence, IMPORTED_REPORT_FIELDS } = require('./imported-evm.ts');
const { isCryptoDiagnostic } = require('../src/crypto/diagnostics.ts');
const { Buffer } = require('node:buffer');
const { isWalletConnectQualificationDiagnostic } = require('./walletconnect-native.ts');
const { readPrivateProofDiagnostic, PRIVATE_PROOF_CHECK } = require('./private-proof-diagnostics.ts');
const { readSentryIsolatedDiagnostic } = require('./sentry-isolated-diagnostics.ts');
const { SENTRY_ISOLATED_CHECK } = require('./native-sentry-isolated.ts');
const { fullSlhBuild, readFullSlhEvidence, readFullSlhDiagnostic, matchesFullSlhRestart, FULL_SLH_CHECK, FULL_SLH_PHASE_TIMEOUT_MS } = require('./native-slh-full.ts');
const { PHYSICAL_BUNDLES } = require('./physical-contract.ts');
const { readSlhResourceEvidence } = require('./slh-resource-evidence.ts');
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
  completedCryptoChecks,
} = require('./simulator-contract.cjs');
const PUBLIC_PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PUBLIC_PASSWORD = 'PUBLIC native qualification password 2026!';
const FIELDS = new Set([
  ...IMPORTED_REPORT_FIELDS,
  'version',
  'status',
  'authorizationMode',
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
  'quickCryptoIdentity',
  'nativeSigningVerified',
  'transferHash',
  'pendingProcessTermination',
  'failedStage',
  'cryptoEvidence',
  'cryptoDiagnostic',
  'walletConnectDiagnostic',
  'privateProofDiagnostic',
  'sentryIsolatedDiagnostic',
  'fullSlh',
  'fullSlhDiagnostic',
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
  if (report?.fullSlh !== undefined) {
    if (report.status !== 'passed' || report.scenario !== 'import' || !['create', 'restart'].includes(report.phase))
      throw Error('Unexpected qualification report schema');
    readFullSlhEvidence(report.fullSlh, report.phase, fullSlhBuild({ version: report.fullSlh.version,
      sourceRevision: report.fullSlh.sourceRevision, lockfileSha256: report.fullSlh.lockfileSha256 }));
  }
  if (report?.fullSlhDiagnostic !== undefined) {
    if (report.status !== 'failed' || report.failedStage !== FULL_SLH_CHECK)
      throw Error('Unexpected qualification report schema');
    readFullSlhDiagnostic(report.fullSlhDiagnostic);
  }
  if (report?.privateProofDiagnostic !== undefined) {
    if (report.status !== 'failed' || report.failedStage !== PRIVATE_PROOF_CHECK)
      throw Error('Unexpected qualification report schema');
    readPrivateProofDiagnostic(report.privateProofDiagnostic);
  }
  if (report?.sentryIsolatedDiagnostic !== undefined) {
    if (report.status !== 'failed' || report.failedStage !== SENTRY_ISOLATED_CHECK)
      throw Error('Unexpected qualification report schema');
    readSentryIsolatedDiagnostic(report.sentryIsolatedDiagnostic);
  }
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
    (report.walletConnectDiagnostic !== undefined &&
      (report.status !== 'failed' || report.failedStage !== 'native WalletConnect lifecycle' ||
        !isWalletConnectQualificationDiagnostic(report.walletConnectDiagnostic))) ||
    !isStorageQualificationDiagnostic(
      report.storageDiagnostic,
      report.status,
      report.failedStage
    ) ||
    report.phase !== phase ||
    report.scenario !== scenario ||
    report.platform !== platform ||
    report.version !== 1 ||
    (report.status === 'passed' && report.authorizationMode !== 'test-only-fixture') ||
    (report.authorizationMode !== undefined && report.authorizationMode !== 'test-only-fixture')
  )
    throw Error('Unexpected qualification report schema');
  if (simulatorContract) assertSimulatorRefusal(report, simulatorVersion, EXPECTED_QUICK_CRYPTO_IDENTITY);
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
    (EXPECTED_QUICK_CRYPTO_IDENTITY && (report.quickCryptoIdentity !== EXPECTED_QUICK_CRYPTO_IDENTITY ||
      !completedCryptoChecks(report.checks))) ||
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
      )}; storage ${JSON.stringify(report.storageDiagnostic)}${
        report.walletConnectDiagnostic ? `; walletConnect ${JSON.stringify(report.walletConnectDiagnostic)}` : ''
      })`
    );
  return report;
}

function decodePhysicalReport(text, expected) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 100000)
    throw Error('Invalid physical report');
  const report = JSON.parse(text);
  const fullSlh = expected.scenario === 'full_slh';
  if (
    !report ||
    typeof report !== 'object' ||
    Array.isArray(report) ||
    report.physicalRunId !== expected.runId ||
    report.physicalSourceRevision !== expected.sourceRevision ||
    report.physicalBundleIdentifier !== expected.bundleIdentifier ||
    expected.bundleIdentifier !== PHYSICAL_BUNDLES[expected.scenario] ||
    (report.fullSlh !== undefined) !== fullSlh ||
    (report.fullSlhResources !== undefined) !== fullSlh
  )
    throw Error('Physical report identity mismatch');
  const {
    physicalRunId,
    physicalSourceRevision,
    physicalBundleIdentifier,
    fullSlhResources,
    ...common
  } = report;
  const checked = decodeNativeReport(
    JSON.stringify(common),
    'ios',
    expected.phase,
    fullSlh ? 'import' : expected.scenario
  );
  assertFullNativeReport(checked);
  if (fullSlh) {
    const evidence = readFullSlhEvidence(checked.fullSlh, expected.phase, fullSlhBuild({
      version: 1, sourceRevision: expected.sourceRevision, lockfileSha256: expected.lockfileSha256,
    }));
    const resources = readSlhResourceEvidence(fullSlhResources);
    if (resources.elapsedMs < (evidence.timings.prepareFreshMs ?? 0) + evidence.timings.hydrateInstalledMs +
      evidence.healthy.signMs + (evidence.fallback?.signMs ?? 0)) throw Error('FULL_SLH_RESOURCE_EVIDENCE_INVALID');
  }
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
        !(fullSlh && item.name === FULL_SLH_CHECK
          ? Number.isFinite(item.durationMs) && item.durationMs >= 0 && item.durationMs <= FULL_SLH_PHASE_TIMEOUT_MS
          : duration(item.durationMs))
    ) ||
    checked.checks.filter(item => item.name === FULL_SLH_CHECK).length !== (fullSlh ? 1 : 0) ||
    CHECKS.some((name, index) => checked.checks[index]?.name !== name) ||
    !checked.checks.some(
      (item) => item.name === 'synchronous lock and OS authorization refusal'
    ) ||
    !checked.checks.some(
      (item) =>
        item.name ===
        (expected.phase === 'create'
          ? 'public-fixture authorized seed confirmation'
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
  const fullSlh = created.physicalBundleIdentifier === PHYSICAL_BUNDLES.full_slh;
  if (fullSlh) { readSlhResourceEvidence(created.fullSlhResources); readSlhResourceEvidence(restored.fullSlhResources); }
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
    !matchesImportedRestartEvidence(created, restored) ||
    (fullSlh ? !matchesFullSlhRestart(created.fullSlh, restored.fullSlh, fullSlhBuild({
      version: 1, sourceRevision: created.physicalSourceRevision, lockfileSha256: created.fullSlh?.lockfileSha256,
    })) : created.fullSlh !== undefined || restored.fullSlh !== undefined || created.fullSlhResources !== undefined || restored.fullSlhResources !== undefined)
  )
    throw Error('Physical cold restart identity mismatch');
}

module.exports = {
  expectedQualificationSdkVersion: EXPECTED_SDK_VERSION,
  expectedQuickCryptoIdentity: EXPECTED_QUICK_CRYPTO_IDENTITY,
  decodeNativeReport,
  assertFullNativeReport,
  decodePhysicalReport,
  assertPhysicalRestart,
};
