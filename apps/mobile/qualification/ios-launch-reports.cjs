const { Buffer } = require('node:buffer');
const { constants } = require('node:fs');
const path = require('node:path');
const { decodeNativeReport } = require('./report-validation.cjs');

const INPUT_LIMIT = 100000;
const OUTPUT_LIMIT = 8192;
const STAGES = new Set(['parameters', 'Hermes text and string capabilities', 'native crypto bridge and full vectors',
  'native factory handles reject direct construction', 'native public Merkle and HMAC vectors', 'open SQLCipher and device key', 'load software SDK',
  'initialize native custody', 'create or import real SDK wallet', 'fresh password-backed seed confirmation',
  'unlock wallet after process restart', 'synchronous lock and wrong password refusal',
  'seed reauthentication after cold restart', 'lock and drain native database close']);

/** This projection cannot authorize success or copy arbitrary app-provided strings. */
function summarizeReport(text, filePhase, scenario) {
  const report = decodeNativeReport(text, 'ios', filePhase === 'startup' ? 'unknown' : 'create', filePhase === 'startup' ? 'unknown' : scenario);
  if (!['passed', 'failed'].includes(report.status) || !Array.isArray(report.checks) || report.checks.length > 64 ||
      report.checks.some((check) => !check || typeof check !== 'object' || Array.isArray(check) ||
        Object.keys(check).sort().join(',') !== 'durationMs,name' || typeof check.name !== 'string' || check.name.length > 160 ||
        !Number.isFinite(check.durationMs) || check.durationMs < 0 || check.durationMs > 300000))
    throw Error('Invalid diagnostic report');
  return { filePhase, availability: 'available', reportedStatus: report.status,
    reportedPhase: report.phase, reportedScenario: report.scenario, completedCheckCount: report.checks.length,
    ...(report.status === 'failed' ? { failedStage: STAGES.has(report.failedStage) ? report.failedStage : 'unrecognized' } : {}),
    ...(report.cryptoDiagnostic ? { cryptoDiagnostic: report.cryptoDiagnostic } : {}),
    storageDiagnostic: report.storageDiagnostic };
}

/** Bound the actual read even if a regular file grows after opening. */
function readReport(fs, file) {
  let descriptor;
  try {
    // A malformed FIFO must not block before fstat, and a report symlink must
    // not redirect diagnostic reads outside this app-owned report directory.
    descriptor = fs.openSync(file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) return { availability: 'unavailable' };
    if (stat.size > INPUT_LIMIT) return { availability: 'oversized' };
    const bytes = Buffer.alloc(INPUT_LIMIT + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(descriptor, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > INPUT_LIMIT) return { availability: 'oversized' };
    return { text: bytes.subarray(0, length).toString('utf8') };
  } catch { return { availability: 'unavailable' }; }
  finally { if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch { /* diagnostic only */ } } }
}

/** Only called after a failed first launch, before the owned container is removed. */
function captureIosLaunchReports(fs, container, scenario, record) {
  if (!['import', 'generate'].includes(scenario)) throw Error('Invalid diagnostic scenario');
  const reports = ['startup', 'create'].map((filePhase) => {
    const value = readReport(fs, path.join(container, 'Documents', `pali-native-qualification-${filePhase}.json`));
    if (value.availability) return { filePhase, availability: value.availability };
    try { return summarizeReport(value.text, filePhase, scenario); }
    catch { return { filePhase, availability: 'invalid' }; }
  });
  const evidence = { version: 1, kind: 'ios-launch-failure-reports', diagnosticOnly: true, reports };
  if (Buffer.byteLength(`${JSON.stringify(evidence, null, 2)}\n`) > OUTPUT_LIMIT) throw Error('Diagnostic output bound exceeded');
  record(evidence);
}

module.exports = { captureIosLaunchReports };
