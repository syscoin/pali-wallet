/* global __dirname */
const { fork } = require('node:child_process');
const { Buffer } = require('node:buffer');
const { randomBytes, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { assertHttpReport } = require('./http-contract.ts');
const { ROUTES } = require('./http-server.cjs');

function assertAudit(value, token, port) {
  if (!value || Object.keys(value).sort().join(',') !== 'closed,counts,invalid,port,token' ||
      value.token !== token || value.port !== port || value.invalid !== 0 ||
      !value.counts || Object.keys(value.counts).length !== ROUTES.length ||
      ROUTES.some((route) => value.counts[route] !== (route === 'target' ? 0 : 1)) ||
      !value.closed || Object.keys(value.closed).sort().join(',') !== 'before,body,oversize' ||
      Object.values(value.closed).some((closed) => closed !== true)) throw Error('HTTP_FIXTURE_AUDIT_FAILED');
}

async function startHttpCompanion({ platform, sourceRevision, run, spawn = fork }) {
  if (!['ios', 'android'].includes(platform) || !/^[0-9a-f]{40}$/.test(sourceRevision || ''))
    throw Error('HTTP_FIXTURE_SOURCE_REQUIRED');
  const lockfileSha256 = createHash('sha256').update(readFileSync(path.join(__dirname, '../package-lock.json'))).digest('hex');
  const child = spawn(path.join(__dirname, 'http-server.cjs'), [], {
    execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { PALI_HTTP_FIXTURE: '1' },
  });
  const pending = new Map();
  let nextId = 0, port, mapped = false, active, stopped = false, serial;
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
  const rpc = (kind, token) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(Error('HTTP_FIXTURE_COMMAND_TIMEOUT')); }, 5000);
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
      const existing = run('adb', ['-s', serial, 'reverse', '--list']);
      if (existing.split(/\r?\n/).some((line) => line.split(/\s+/).slice(1).includes(`tcp:${port}`)))
        throw Error('HTTP_FIXTURE_REVERSE_COLLISION');
      run('adb', ['-s', serial, 'reverse', '--no-rebind', `tcp:${port}`, `tcp:${port}`]);
      mapped = true;
      if (!run('adb', ['-s', serial, 'reverse', '--list']).split(/\r?\n/).some((line) => {
        const parts = line.trim().split(/\s+/); return parts.length === 3 && parts[1] === `tcp:${port}` && parts[2] === `tcp:${port}`;
      })) throw Error('HTTP_FIXTURE_REVERSE_UNVERIFIED');
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
      return `&httpPort=${port}&httpToken=${token}`;
    },
    async verify(read, sessionId) {
      if (!active) throw Error('HTTP_FIXTURE_PHASE_REQUIRED');
      const text = read(`pali-native-http-${active.token}.json`);
      if (typeof text !== 'string' || Buffer.byteLength(text) > 8192) throw Error('HTTP_QUALIFICATION_REPORT_INVALID');
      const report = JSON.parse(text);
      assertHttpReport(report, active);
      if (report.sessionId !== sessionId) throw Error('HTTP_FIXTURE_SESSION_MISMATCH');
      const audit = await rpc('snapshot', active.token);
      assertAudit(audit, active.token, port);
      records.push({ nativeHttpQualified: true, report, audit });
      active = undefined;
      return records.at(-1);
    },
    assertComplete(expected) {
      const phases = expected === 1 ? ['import:create'] : expected === 4
        ? ['generate:create', 'generate:restart', 'import:create', 'import:restart'] : [];
      if (!phases.length || active || records.length !== expected || new Set(records.map(({ report }) => report.token)).size !== expected ||
          records.map(({ report }) => `${report.scenario}:${report.phase}`).sort().join(',') !== phases.join(','))
        throw Error('HTTP_QUALIFICATION_INCOMPLETE');
    },
    close,
  };
}
module.exports = { startHttpCompanion, assertAudit };
