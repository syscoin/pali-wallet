const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Buffer } = require('node:buffer');
const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const { httpBuild } = require('./http-contract.ts');
const { parsePrivateProofReport, privateProofReportName, PRIVATE_PROOF_REPORT_TIMEOUT } = require('./private-proof-contract.ts');
const { readQualificationSdkPin, verifyInstalledQualificationSdk } = require('../scripts/qualification-sdk.cjs');
const { decodeNativeReport } = require('./report-validation.cjs');
const { CHECKS } = require('./simulator-contract.cjs');
const { SENTRY_ISOLATED_CHECK } = require('./native-sentry-isolated.ts');
const { PRIVATE_PROOF_CHECK, readPrivateProofDiagnostic } = require('./private-proof-diagnostics.ts');
const { readSentryIsolatedDiagnostic } = require('./sentry-isolated-diagnostics.ts');
const FAILURE_INPUT_BYTES = 100000;
const FAILURE_OUTPUT_BYTES = 8192;
const FAILURE_STAGES = new Set(['parameters', 'private proof host', ...CHECKS, SENTRY_ISOLATED_CHECK, PRIVATE_PROOF_CHECK]);

function readJson(file) {
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 16384) throw Error('PRIVATE_PROOF_BUILD_INVALID');
    const bytes = Buffer.alloc(16385);
    let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(descriptor, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > 16384) throw Error('PRIVATE_PROOF_BUILD_INVALID');
    return JSON.parse(bytes.subarray(0, length).toString('utf8'));
  } finally { fs.closeSync(descriptor); }
}

function readPrivateProofCiBuild(env, root, run) {
  if (env.CI !== 'true' || env.GITHUB_ACTIONS !== 'true' || env.PALI_NATIVE_QUALIFICATION !== '1' ||
      env.PALI_NATIVE_PRIVATE_PROOF_QUALIFICATION !== '1' || env.PALI_NATIVE_HTTP_QUALIFICATION !== '0' ||
      env.PALI_NATIVE_PUBLIC_POOL_QUALIFICATION !== '0' || env.PALI_PHYSICAL_QUALIFICATION !== undefined)
    throw Error('PRIVATE_PROOF_REQUIRES_HOSTED_ISOLATION');
  const receipt = readJson(path.join(root, '.native-qualification.json'));
  const app = readJson(path.join(root, 'app.json')).expo;
  const build = httpBuild(receipt.privateProof);
  const pin = readQualificationSdkPin(root);
  verifyInstalledQualificationSdk(root, pin);
  if (receipt.identifier !== 'com.paliwallet.qualification' || receipt.qualificationEntry !== 'qualification/index.tsx' ||
      receipt.http || receipt.publicPool || receipt.physical || receipt.keyringVersion !== pin.version ||
      app?.ios?.bundleIdentifier !== receipt.identifier || app?.android?.package !== receipt.identifier ||
      JSON.stringify(httpBuild(app?.extra?.paliPrivateProofQualification)) !== JSON.stringify(build) ||
      app.extra.paliQualificationSdkVersion !== pin.version || app.extra.paliQualificationSdkIdentity !== pin.identity ||
      build.sourceRevision !== env.GITHUB_SHA || run('git', ['rev-parse', 'HEAD']) !== env.GITHUB_SHA ||
      build.lockfileSha256 !== crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'package-lock.json'))).digest('hex'))
    throw Error('PRIVATE_PROOF_BUILD_MISMATCH');
  return Object.freeze({ ...build, sdkVersion: pin.identity, sdkPackageVersion: pin.version });
}

function reportInventory(names) {
  if (!Array.isArray(names) || names.length > 256 || new Set(names).size !== names.length || names.some((name) => typeof name !== 'string' || name.length > 256 || name.includes('/')))
    throw Error('PRIVATE_PROOF_REPORT_INVENTORY_INVALID');
  return names.filter((name) => name.startsWith('pali-native-'));
}

function preserveUnexpectedFailure(platform, output, names, readFailure) {
  const reports = ['startup', 'create'].filter(phase => names.includes(`pali-native-qualification-${phase}.json`)).map(filePhase => {
    let text;
    try { text = readFailure(filePhase); }
    catch { return { filePhase, availability: 'unavailable' }; }
    try {
      if (typeof text !== 'string' || Buffer.byteLength(text) > FAILURE_INPUT_BYTES) throw Error();
      const report = decodeNativeReport(text, platform, filePhase === 'startup' ? 'unknown' : 'create', filePhase === 'startup' ? 'unknown' : 'import');
      if (report.status !== 'failed' || !Number.isSafeInteger(report.networkCalls) || report.networkCalls < 0 || !Array.isArray(report.checks) || report.checks.length > 64 ||
          report.checks.some(check => !check || typeof check !== 'object' || Array.isArray(check) ||
            Object.keys(check).sort().join(',') !== 'durationMs,name' || typeof check.name !== 'string' || check.name.length > 160 ||
            !Number.isFinite(check.durationMs) || check.durationMs < 0 || check.durationMs > 300000)) throw Error();
      const completedChecks = report.checks.filter(check => CHECKS.includes(check.name) || check.name === SENTRY_ISOLATED_CHECK)
        .map(({ name, durationMs }) => ({ name, durationMs }));
      return { filePhase, availability: 'available', reportedStatus: 'failed', reportedPhase: report.phase, reportedScenario: report.scenario,
        failedStage: FAILURE_STAGES.has(report.failedStage) ? report.failedStage : 'unrecognized', completedCheckCount: report.checks.length, completedChecks,
        isolatedSentryQualified: completedChecks.some(check => check.name === SENTRY_ISOLATED_CHECK), networkCalls: report.networkCalls,
        nativeBridgeExercised: report.nativeBridgeExercised === true,
        ...(report.privateProofDiagnostic ? { privateProofDiagnostic: readPrivateProofDiagnostic(report.privateProofDiagnostic) } : {}),
        ...(report.sentryIsolatedDiagnostic ? { sentryIsolatedDiagnostic: readSentryIsolatedDiagnostic(report.sentryIsolatedDiagnostic) } : {}),
        ...(report.cryptoDiagnostic ? { cryptoDiagnostic: report.cryptoDiagnostic } : {}), storageDiagnostic: report.storageDiagnostic };
    } catch { return { filePhase, availability: 'invalid' }; }
  });
  const evidence = { version: 1, kind: 'native-private-proof-diagnostic', diagnosticOnly: true, status: 'failed', reason: 'unexpected-report', reports };
  const text = `${JSON.stringify(evidence, null, 2)}\n`;
  if (Buffer.byteLength(text) > FAILURE_OUTPUT_BYTES) throw Error('PRIVATE_PROOF_DIAGNOSTIC_INVALID');
  fs.writeFileSync(path.join(output, `${platform}-private-proof-diagnostic.json`), text, { flag: 'wx' });
}

async function runPrivateProofQualification({ platform, config, output, launch, read, readFailure, list,
  now = () => performance.now(), pause = delay, randomBytes = crypto.randomBytes }) {
  if (!['ios', 'android'].includes(platform)) throw Error('PRIVATE_PROOF_PLATFORM_INVALID');
  if (typeof readFailure !== 'function') throw Error('PRIVATE_PROOF_FAILURE_READER_REQUIRED');
  const token = randomBytes(16).toString('hex');
  const name = privateProofReportName(token);
  const target = path.join(output, `${platform}-private-proof-app.json`);
  if (fs.existsSync(target) || fs.existsSync(`${target}.tmp`) ||
      fs.existsSync(path.join(output, `${platform}-private-proof.json`)) || reportInventory(list()).length)
    throw Error('PRIVATE_PROOF_REPORT_ALREADY_EXISTS');
  const expected = { ...config, platform, token };
  const uri = `pali-wallet-qualification://run?phase=create&scenario=import&proofToken=${token}`;
  await launch(uri);
  const deadline = now() + PRIVATE_PROOF_REPORT_TIMEOUT;
  while (now() < deadline) {
    const names = reportInventory(list());
    if (names.some((entry) => entry !== name && entry !== `${name}.tmp`) ||
        (names.includes(name) && names.includes(`${name}.tmp`))) {
      try { preserveUnexpectedFailure(platform, output, names, readFailure); }
      catch { /* Diagnostic persistence cannot replace the primary report rejection. */ }
      throw Error('PRIVATE_PROOF_EXTRA_REPORT');
    }
    if (names.includes(name)) {
      const report = parsePrivateProofReport(read(name), expected);
      const text = `${JSON.stringify(report, null, 2)}\n`;
      fs.writeFileSync(`${target}.tmp`, text, { flag: 'wx' });
      try { fs.linkSync(`${target}.tmp`, target); }
      finally { fs.unlinkSync(`${target}.tmp`); }
      return report;
    }
    await pause(1000);
  }
  throw Error('PRIVATE_PROOF_REPORT_TIMEOUT');
}

module.exports = { readPrivateProofCiBuild, runPrivateProofQualification };
