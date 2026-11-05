const { describeQualificationFailure } = require('./command-runner.cjs');
const { performance } = require('node:perf_hooks');
const { constants: { signals } } = require('node:os');
const { assertOwnedIosDevice, inspectIosServices } = require('./ios-runner-diagnostics.cjs');

const CONNECTION_TIMEOUT_MS = 30000;
const PROBE_TIMEOUT_MS = 10000;
const PACKAGE = 'com.paliwallet.qualification';
const IOS_CONTROL_PACKAGE = 'com.apple.Preferences';
const QUERY_ERROR_CODES = new Set(['EACCES', 'EAGAIN', 'EBADF', 'ECONNRESET', 'EFAULT', 'EINTR', 'EINVAL', 'EIO', 'EISDIR', 'EMFILE', 'ENFILE', 'ENOBUFS', 'ENOENT', 'ENOMEM', 'ENOTCONN', 'ENOTDIR', 'EPERM', 'EPIPE', 'ETIMEDOUT']);

/** Fixed host failure fields only: never error text, arguments, or process output. */
function iosLogQueryFailure(error, elapsed) {
  const failure = describeQualificationFailure(error);
  const typed = failure.kind === 'command';
  return Object.freeze({ kind: typed ? 'command' : 'unclassified',
    status: typed && Number.isSafeInteger(failure.status) ? failure.status : null,
    errorCode: typed && failure.errorCode !== null ? QUERY_ERROR_CODES.has(failure.errorCode) ? failure.errorCode : 'other' : null,
    signal: typed && failure.signal !== null ? Object.hasOwn(signals, failure.signal) ? failure.signal : 'other' : null,
    timedOut: typed ? failure.timedOut === true : null, timeoutMs: PROBE_TIMEOUT_MS,
    elapsedMs: Number.isFinite(elapsed) && elapsed >= 0 ? Math.min(600000, elapsed) : null,
    elapsedTruncated: Number.isFinite(elapsed) && elapsed > 600000 });
}

function closedRootTransport(error) {
  const failure = describeQualificationFailure(error);
  return failure.kind === 'command' && failure.command === 'adb' &&
    failure.args.length === 1 && failure.args[0] === 'root' &&
    failure.status === 1 && failure.timedOut === false &&
    failure.signal === null && failure.errorCode === null &&
    failure.stdoutTail === '' && failure.stderrTail.trim() === 'adb: unable to connect for root: closed';
}

/** Setup only: never retry root or any app action, and never infer uid from an ACK. */
function prepareAndroidRoot(run, record) {
  let rootFailure;
  let ready = false;
  let stage = 'connection';
  try {
    run('adb', ['wait-for-device'], false, CONNECTION_TIMEOUT_MS);
    stage = 'root';
    try { run('adb', ['root'], false, CONNECTION_TIMEOUT_MS); }
    catch (error) {
      if (!closedRootTransport(error)) throw error;
      rootFailure = describeQualificationFailure(error);
    }
    stage = 'reconnection';
    run('adb', ['wait-for-device'], false, CONNECTION_TIMEOUT_MS);
    stage = 'uid';
    if (run('adb', ['shell', 'id', '-u'], false, PROBE_TIMEOUT_MS) !== '0')
      throw Error('Android qualification requires confirmed root uid');
    ready = true;
  } finally {
    const evidence = Object.freeze({ version: 1, status: ready ? 'ready' : 'failed', stage,
      rootTransportRecovered: ready && Boolean(rootFailure), ...(rootFailure ? { rootFailure } : {}) });
    // Persist recovered failures before allowing the caller to install its app.
    // If setup already failed, diagnostic I/O cannot replace the primary failure.
    if (ready) record(evidence);
    else { try { record(evidence); } catch { /* preserve setup failure */ } }
  }
}

function summarizeIosLaunch(services, logs, fullAttemptRequested = false) {
  const limit = 262144;
  const logsAvailable = typeof logs === 'string';
  const logsTruncated = logsAvailable && logs.length > limit;
  let logParseErrors = 0;
  const counts = { matched: 0, failure: 0, timeout: 0, termination: 0 };
  if (logsAvailable) {
    for (const line of logs.slice(0, limit).split('\n')) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { logParseErrors++; continue; }
      if (typeof entry?.eventMessage !== 'string' || !entry.eventMessage.includes(PACKAGE)) continue;
      counts.matched++;
      if (/fail|denied|refused|error/i.test(entry.eventMessage)) counts.failure++;
      if (/timeout|timed out|watchdog/i.test(entry.eventMessage)) counts.timeout++;
      if (/terminat|exited|crash/i.test(entry.eventMessage)) counts.termination++;
    }
  }
  return Object.freeze({ ...inspectIosServices(services), logsAvailable, logsTruncated, logParseErrors,
    fullAttemptRequested, logCounts: Object.freeze(counts),
    logCountConfidence: !logsAvailable ? 'unavailable' : fullAttemptRequested && !logsTruncated && logParseErrors === 0 ? 'complete-for-query' : 'lower-bound',
    logCountScope: 'selected-system-processes-with-package-marker' });
}

/** The original launch is attempted exactly once; observations do not grant success. */
function launchIos(run, device, link, record, now = () => performance.now()) {
  const started = now();
  try {
    return run('xcrun', ['simctl', 'launch', device, PACKAGE, '-PaliQualificationURL', link]);
  } catch (error) {
    const failedAt = now();
    const duration = failedAt - started;
    const elapsedMs = Math.max(0, Math.min(600000, duration));
    // Only the freshly-created, caller-owned simulator is queried. No raw system
    // or app log messages enter the artifact, even if they contain secret text.
    let services = null, logs = null;
    try { services = run('xcrun', ['simctl', 'spawn', device, 'launchctl', 'list'], true, PROBE_TIMEOUT_MS); } catch { /* diagnostic only */ }
    const untilQuery = now() - started;
    // Minute units are supported by the pinned log tool. Include the whole wait
    // plus a minute of margin, bounded even if the clock or host misbehaves.
    const validClock = Number.isFinite(untilQuery) && untilQuery >= duration && duration >= 0;
    const lookbackMinutes = validClock ? Math.min(15, Math.max(1, Math.ceil((untilQuery + 60000) / 60000))) : 15;
    const fullAttemptRequested = validClock && lookbackMinutes * 60000 >= untilQuery + 60000;
    let logQueryFailure;
    const queryStarted = now();
    try { logs = run('xcrun', ['simctl', 'spawn', device, 'log', 'show', '--style', 'ndjson', '--last', `${lookbackMinutes}m`,
      '--predicate', `(process == "SpringBoard" OR process == "runningboardd" OR process == "launchd") AND eventMessage CONTAINS "${PACKAGE}"`], false, PROBE_TIMEOUT_MS); }
    catch (queryError) { logQueryFailure = iosLogQueryFailure(queryError, now() - queryStarted); }
    try { record(Object.freeze({ version: 3, stage: 'launch', elapsedMs, lookbackMinutes,
      ...(logQueryFailure ? { logQueryFailure } : {}),
      ...summarizeIosLaunch(services, logs, fullAttemptRequested) }), failedAt); }
    catch { /* preserve the original launch failure */ }
    throw error;
  }
}

/** Diagnostic only, after retaining the target app's failure observations. */
function probeIosSystemLaunch(run, device, runtime, failedAt, now = () => performance.now()) {
  assertOwnedIosDevice(device, runtime);
  const started = now();
  const elapsed = started - failedAt;
  // Share the original service/log probe allowance rather than adding a retry budget.
  const timeoutMs = Math.min(PROBE_TIMEOUT_MS, Math.floor(2 * PROBE_TIMEOUT_MS - elapsed));
  if (!Number.isFinite(elapsed) || elapsed < 0 || timeoutMs < 1)
    return Object.freeze({ status: 'budget-unavailable', pidPresent: false, elapsedMs: 0 });
  let status, pidPresent = false;
  try {
    const result = run('xcrun', ['simctl', 'launch', '--terminate-running-process', device, IOS_CONTROL_PACKAGE],
      false, timeoutMs);
    pidPresent = /^com\.apple\.Preferences: [1-9][0-9]*$/.test(result);
    status = pidPresent ? 'launched' : 'unconfirmed';
  } catch (error) {
    const failure = describeQualificationFailure(error);
    status = failure.kind === 'command' && failure.timedOut ? 'timed-out' : 'failed';
  }
  const duration = now() - started;
  return Object.freeze({ status, pidPresent, timeoutMs,
    elapsedMs: Number.isFinite(duration) && duration >= 0 ? Math.min(600000, duration) : null });
}

module.exports = { prepareAndroidRoot, launchIos, summarizeIosLaunch, probeIosSystemLaunch };
