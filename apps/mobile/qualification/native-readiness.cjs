const { describeQualificationFailure } = require('./command-runner.cjs');

const CONNECTION_TIMEOUT_MS = 30000;
const PROBE_TIMEOUT_MS = 10000;
const PACKAGE = 'com.paliwallet.qualification';

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

function summarizeIosLaunch(services, logs) {
  const serviceLines = typeof services === 'string' ? services.slice(0, 65536).split('\n') : [];
  const app = serviceLines.filter((line) => line.includes(`UIKitApplication:${PACKAGE}[`));
  const springboard = serviceLines.filter((line) => /\tcom\.apple\.SpringBoard$/.test(line));
  const running = (lines) => lines.some((line) => /^[1-9][0-9]*\s/.test(line));
  const counts = { matched: 0, failure: 0, timeout: 0, termination: 0 };
  if (typeof logs === 'string') {
    for (const line of logs.slice(0, 65536).split('\n')) {
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (typeof entry?.eventMessage !== 'string' || !entry.eventMessage.includes(PACKAGE)) continue;
      counts.matched++;
      if (/fail|denied|refused|error/i.test(entry.eventMessage)) counts.failure++;
      if (/timeout|timed out|watchdog/i.test(entry.eventMessage)) counts.timeout++;
      if (/terminat|exited|crash/i.test(entry.eventMessage)) counts.termination++;
    }
  }
  return Object.freeze({ servicesAvailable: typeof services === 'string', appServiceListed: app.length > 0,
    appPidPresent: running(app), springboardPidPresent: running(springboard),
    logsAvailable: typeof logs === 'string', logCounts: Object.freeze(counts) });
}

/** The original launch is attempted exactly once; observations do not grant success. */
function launchIos(run, device, link, record, now = Date.now) {
  const started = now();
  try {
    return run('xcrun', ['simctl', 'launch', device, PACKAGE, '-PaliQualificationURL', link]);
  } catch (error) {
    const elapsedMs = Math.max(0, Math.min(600000, now() - started));
    // Only the freshly-created, caller-owned simulator is queried. No raw system
    // or app log messages enter the artifact, even if they contain secret text.
    let services = null, logs = null;
    try { services = run('xcrun', ['simctl', 'spawn', device, 'launchctl', 'list'], true, PROBE_TIMEOUT_MS); } catch { /* diagnostic only */ }
    try { logs = run('xcrun', ['simctl', 'spawn', device, 'log', 'show', '--style', 'ndjson', '--last', '2m',
      '--predicate', 'process == "SpringBoard" OR process == "runningboardd" OR process == "launchd"'], true, PROBE_TIMEOUT_MS); } catch { /* diagnostic only */ }
    try { record(Object.freeze({ version: 1, stage: 'launch', elapsedMs, ...summarizeIosLaunch(services, logs) })); }
    catch { /* preserve the original launch failure */ }
    throw error;
  }
}

module.exports = { prepareAndroidRoot, launchIos, summarizeIosLaunch };
