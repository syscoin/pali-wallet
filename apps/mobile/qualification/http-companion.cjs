/* global __dirname */
const { fork } = require('node:child_process');
const { Buffer } = require('node:buffer');
const { randomBytes, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { assertHttpReport, httpDiagnosticCase } = require('./http-contract.ts');
const { assertPostReport, postDiagnosticCase } = require('./post-contract.ts');
const { assertPostAudit, partialPostAudit } = require('./post-server.cjs');
const { isAmbiguousCommandFailure } = require('./command-runner.cjs');
const { ROUTES } = require('./http-server.cjs');

function assertAudit(value, token, port) {
  if (!value || Object.keys(value).sort().join(',') !== 'closed,counts,invalid,port,token' ||
      value.token !== token || value.port !== port || value.invalid !== 0 ||
      !value.counts || Object.keys(value.counts).length !== ROUTES.length ||
      ROUTES.some((route) => value.counts[route] !== (route === 'target' ? 0 : 1)) ||
      !value.closed || Object.keys(value.closed).sort().join(',') !== 'before,body,oversize' ||
      Object.values(value.closed).some((closed) => closed !== true)) throw Error('HTTP_FIXTURE_AUDIT_FAILED');
}

function reverseMappings(text) {
  if (typeof text !== 'string' || text.length > 32768) throw Error('HTTP_FIXTURE_REVERSE_LIST_INVALID');
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line) => {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 3 || parts.some((part) => part.length > 256) || parts.slice(1).some((part) =>
      !/^(?:tcp:[0-9]{1,5}|local(?:abstract|reserved|filesystem):\S+)$/.test(part) ||
      part.startsWith('tcp:') && Number(part.slice(4)) > 65535)) throw Error('HTTP_FIXTURE_REVERSE_LIST_INVALID');
    return parts;
  });
}

function partialAudit(value, token, port) {
  if (!value || Object.keys(value).sort().join(',') !== 'closed,counts,invalid,port,token' || value.token !== token || value.port !== port ||
      !Number.isSafeInteger(value.invalid) || value.invalid < 0 || value.invalid > 100000 ||
      !value.counts || Object.keys(value.counts).length !== ROUTES.length ||
      ROUTES.some((route) => !Number.isSafeInteger(value.counts[route]) || value.counts[route] < 0 || value.counts[route] > 100000) ||
      !value.closed || Object.keys(value.closed).sort().join(',') !== 'before,body,oversize' ||
      Object.values(value.closed).some((closed) => typeof closed !== 'boolean')) return null;
  return { counts: { ...value.counts }, invalid: value.invalid, closed: { ...value.closed } };
}

async function startHttpCompanion({ platform, sourceRevision, run, spawn = fork }) {
  if (!['ios', 'android'].includes(platform) || !/^[0-9a-f]{40}$/.test(sourceRevision || ''))
    throw Error('HTTP_FIXTURE_SOURCE_REQUIRED');
  const lockfileSha256 = createHash('sha256').update(readFileSync(path.join(__dirname, '../package-lock.json'))).digest('hex');
  const child = spawn(path.join(__dirname, 'http-server.cjs'), [], {
    execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { PALI_HTTP_FIXTURE: '1' },
  });
  const pending = new Map();
  let nextId = 0, port, mapped = false, active, stopped = false, serial, finalAudit, finalPostAudit, failedCase = 'unavailable';
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  child.on('message', (message) => {
    if (message?.kind === 'ready') {
      if (!Number.isSafeInteger(message.port) || message.port < 1024 || message.port > 65535 || port !== undefined) {
        readyReject(Error('HTTP_FIXTURE_PORT_INVALID')); return;
      }
      port = message.port; readyResolve(); return;
    }
    const entry = pending.get(message?.id);
    if (entry) {
      pending.delete(message.id); clearTimeout(entry.timer);
      if (message.ok === true) entry.resolve(message.value);
      else entry.reject(Error('HTTP_FIXTURE_COMMAND_FAILED'));
    }
  });
  const lost = () => {
    readyReject(Error('HTTP_FIXTURE_EXITED'));
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(Error('HTTP_FIXTURE_EXITED')); }
    pending.clear();
  };
  child.on('error', lost); child.on('exit', lost);
  const rpc = (kind, token, timeout = 5000) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(Error('HTTP_FIXTURE_COMMAND_TIMEOUT')); }, timeout);
    pending.set(id, { resolve, reject, timer });
    child.send({ id, kind, token }, (error) => { if (error) { clearTimeout(timer); pending.delete(id); reject(Error('HTTP_FIXTURE_COMMAND_FAILED')); } });
  });
  const stopChild = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise((resolve) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.kill('SIGTERM');
    });
  };
  const close = async () => {
    if (stopped) return;
    stopped = true;
    try { if (mapped) run('adb', ['-s', serial, 'reverse', '--remove', `tcp:${port}`]); }
    finally { mapped = false; await stopChild(); }
  };
  const timer = setTimeout(() => readyReject(Error('HTTP_FIXTURE_START_TIMEOUT')), 5000);
  try {
    await ready;
    if (platform === 'android') {
      serial = run('adb', ['get-serialno']);
      if (!/^emulator-[0-9]+$/.test(serial) || run('adb', ['-s', serial, 'shell', 'getprop', 'ro.kernel.qemu']) !== '1')
        throw Error('HTTP_FIXTURE_REQUIRES_CI_EMULATOR');
      // Never overwrite another owner's mapping and never use --remove-all.
      const existing = reverseMappings(run('adb', ['-s', serial, 'reverse', '--list']));
      if (existing.some((parts) => parts[1] === `tcp:${port}`))
        throw Error('HTTP_FIXTURE_REVERSE_COLLISION');
      const installArgs = ['-s', serial, 'reverse', '--no-rebind', `tcp:${port}`, `tcp:${port}`];
      try { run('adb', installArgs); }
      catch (error) {
        if (isAmbiguousCommandFailure(error, 'adb', installArgs)) {
          try {
            const rows = reverseMappings(run('adb', ['-s', serial, 'reverse', '--list'], false, 5000));
            const samePort = rows.filter((parts) => parts[1] === `tcp:${port}`);
            // Prior absence + typed lost acknowledgement + exact readback only.
            // The -s argument binds the device; column zero may be '(reverse)'.
            mapped = samePort.length === 1 && samePort[0][2] === `tcp:${port}`;
          } catch { /* Unknown mapping ownership never permits removal. */ }
        }
        throw error;
      }
      mapped = true;
      if (!reverseMappings(run('adb', ['-s', serial, 'reverse', '--list'])).some((parts) =>
        parts[1] === `tcp:${port}` && parts[2] === `tcp:${port}`)) throw Error('HTTP_FIXTURE_REVERSE_UNVERIFIED');
    }
  } catch (error) { await close().catch(() => undefined); throw error; }
  finally { clearTimeout(timer); }
  const records = [];
  return {
    records,
    async begin(phase, scenario) {
      if (active || !['create', 'restart'].includes(phase) || !['import', 'generate'].includes(scenario)) throw Error('HTTP_FIXTURE_PHASE_INVALID');
      const token = randomBytes(16).toString('hex');
      await rpc('begin', token);
      active = { sourceRevision, lockfileSha256, token, phase, scenario, platform };
      finalAudit = undefined;
      finalPostAudit = undefined;
      failedCase = 'unavailable';
      return `&httpPort=${port}&httpToken=${token}`;
    },
    async verify(read, sessionId) {
      if (!active) throw Error('HTTP_FIXTURE_PHASE_REQUIRED');
      const text = read(`pali-native-http-${active.token}.json`);
      if (typeof text !== 'string' || Buffer.byteLength(text) > 8192) throw Error('HTTP_QUALIFICATION_REPORT_INVALID');
      const report = JSON.parse(text);
      assertHttpReport(report, active);
      if (report.sessionId !== sessionId) throw Error('HTTP_FIXTURE_SESSION_MISMATCH');
      const postText = read(`pali-native-post-${active.token}.json`);
      if (typeof postText !== 'string' || Buffer.byteLength(postText) > 8192) throw Error('POST_QUALIFICATION_REPORT_INVALID');
      const postReport = JSON.parse(postText);
      assertPostReport(postReport, active);
      if (postReport.sessionId !== sessionId) throw Error('POST_FIXTURE_SESSION_MISMATCH');
      failedCase = 'host-verification';
      const snapshot = await rpc('snapshotAll', active.token);
      if (!snapshot || Object.keys(snapshot).sort().join(',') !== 'get,post') throw Error('HTTP_FIXTURE_AUDIT_FAILED');
      const audit = finalAudit = snapshot.get;
      finalPostAudit = snapshot.post;
      assertAudit(audit, active.token, port);
      assertPostAudit(finalPostAudit, active.token, port);
      records.push({ nativeHttpQualified: true, report, audit,
        post: { nativePostQualified: true, report: postReport, audit: finalPostAudit } });
      active = undefined;
      return records.at(-1);
    },
    async diagnostic(read = () => undefined) {
      if (!active) return undefined;
      try {
        const text = read(`pali-native-http-${active.token}.json`);
        if (typeof text === 'string' && Buffer.byteLength(text) <= 8192)
          failedCase = httpDiagnosticCase(JSON.parse(text), active) ?? failedCase;
      } catch { /* Missing or malformed native evidence remains unavailable. */ }
      let server = partialAudit(finalAudit, active.token, port);
      if (!server) {
        try {
          const snapshot = await rpc('inspectAll', active.token, 1000);
          server = partialAudit(snapshot?.get, active.token, port);
        }
        catch { /* Diagnostic loss must not replace the original failure. */ }
      }
      return { version: 1, kind: 'native-http-diagnostic', status: 'failed', diagnosticOnly: true,
        ...active, failedCase, server };
    },
    async postDiagnostic(read = () => undefined) {
      if (!active) return undefined;
      let failedPostCase = 'unavailable', failureDetail = null;
      try {
        const text = read(`pali-native-post-${active.token}.json`);
        if (typeof text === 'string' && Buffer.byteLength(text) <= 8192) {
          const value = JSON.parse(text), validCase = postDiagnosticCase(value, active);
          if (validCase) { failedPostCase = validCase; failureDetail = { ...value.failureDetail }; }
        }
      } catch { /* Missing sidecar remains unavailable. */ }
      let server = partialPostAudit(finalPostAudit, active.token, port);
      if (!server) {
        try { server = partialPostAudit((await rpc('inspectAll', active.token, 1000))?.post, active.token, port); }
        catch { /* Diagnostics never replace the primary failure. */ }
      }
      return { version: 1, kind: 'native-post-diagnostic', status: 'failed', diagnosticOnly: true,
        ...active, failedCase: failedPostCase, failureDetail, server };
    },
    assertComplete(expected) {
      const phases = expected === 1 ? ['import:create'] : expected === 4
        ? ['generate:create', 'generate:restart', 'import:create', 'import:restart'] : [];
      if (!phases.length || active || records.length !== expected || records.some(record => record.nativeHttpQualified !== true || record.post?.nativePostQualified !== true) ||
          new Set(records.map(({ report }) => report.token)).size !== expected ||
          records.map(({ report }) => `${report.scenario}:${report.phase}`).sort().join(',') !== phases.join(','))
        throw Error('HTTP_QUALIFICATION_INCOMPLETE');
    },
    close,
  };
}
module.exports = { startHttpCompanion, assertAudit };
