const { performance } = require('node:perf_hooks');

const READINESS_DEADLINE_MS = 30000;
const PROBE_TIMEOUT_MS = 10000;
const SERVICE_LIMIT = 65536;
const RUNTIME = /^com\.apple\.CoreSimulator\.SimRuntime\.iOS-\d+-\d+(?:-\d+)?$/;
const DEVICE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertOwnedIosDevice(device, runtime) {
  if (typeof device !== 'string' || typeof runtime !== 'string' || !DEVICE.test(device) || !RUNTIME.test(runtime))
    throw Error('Invalid owned iOS simulator identity');
}

function inspectIosServices(text) {
  const available = typeof text === 'string';
  const lines = available ? text.slice(0, SERVICE_LIMIT).split('\n') : [];
  const app = lines.filter((line) => line.includes('UIKitApplication:com.paliwallet.qualification['));
  const springboard = lines.filter((line) => /\tcom\.apple\.SpringBoard$/.test(line));
  const running = (values) => values.some((line) => /^[1-9][0-9]*\s/.test(line));
  return Object.freeze({ servicesAvailable: available, servicesTruncated: available && text.length > SERVICE_LIMIT,
    appServiceListed: app.length > 0, appPidPresent: running(app), springboardPidPresent: running(springboard) });
}

/** Readiness is evidence about the newly created simulator, never app success. */
async function prepareIosSimulator(run, device, runtime, record, options = {}) {
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  assertOwnedIosDevice(device, runtime);
  const started = now(), deadline = started + READINESS_DEADLINE_MS;
  let status = 'failed', stage = 'inventory', probes = 0, deviceState = null, springboardPidPresent = false;
  const remaining = () => {
    const value = Math.floor(deadline - now());
    if (!Number.isFinite(value) || value <= 0 || value > READINESS_DEADLINE_MS) throw Error('iOS simulator readiness deadline exceeded');
    return value;
  };
  try {
    while (true) {
      stage = 'inventory'; probes++;
      const raw = run('xcrun', ['simctl', 'list', 'devices', '-j'], false, Math.min(PROBE_TIMEOUT_MS, remaining()));
      let inventory;
      try { inventory = JSON.parse(raw); } catch { throw Error('Invalid iOS simulator inventory'); }
      if (!inventory?.devices || typeof inventory.devices !== 'object' || Array.isArray(inventory.devices)) throw Error('Invalid iOS simulator inventory');
      const matches = [];
      for (const [registeredRuntime, devices] of Object.entries(inventory.devices)) {
        if (!Array.isArray(devices)) throw Error('Invalid iOS simulator inventory');
        for (const item of devices) if (item?.udid === device) matches.push({ registeredRuntime, item });
      }
      if (matches.length !== 1 || matches[0].registeredRuntime !== runtime || matches[0].item.isAvailable !== true)
        throw Error('Owned iOS simulator is unavailable or has a different runtime');
      const state = matches[0].item.state;
      deviceState = ['Booted', 'Booting', 'Shutdown', 'Creating'].includes(state) ? state : 'unknown';
      if (deviceState === 'unknown') throw Error('Invalid iOS simulator state');
      if (deviceState === 'Booted') {
        stage = 'springboard';
        const services = inspectIosServices(run('xcrun', ['simctl', 'spawn', device, 'launchctl', 'list'], false, Math.min(PROBE_TIMEOUT_MS, remaining())));
        if (services.servicesTruncated) throw Error('Incomplete iOS simulator service inventory');
        if (services.appPidPresent) throw Error('Qualification app is already running before launch');
        springboardPidPresent = services.springboardPidPresent;
        if (springboardPidPresent) { remaining(); status = 'ready'; stage = 'ready'; return; }
      }
      await sleep(Math.min(500, remaining()));
    }
  } finally {
    const observedElapsedMs = now() - started;
    const elapsedMs = Math.max(0, Math.min(600000, observedElapsedMs));
    const evidence = Object.freeze({ version: 1, status, stage, device, runtime, deviceState,
      springboardPidPresent, probes, elapsedMs, deadlineMs: READINESS_DEADLINE_MS,
      deadlineExceeded: observedElapsedMs >= READINESS_DEADLINE_MS, elapsedTruncated: observedElapsedMs > 600000 });
    if (status === 'ready') record(evidence);
    else { try { record(evidence); } catch { /* Preserve the original readiness failure. */ } }
  }
}

/** Persist running/completed stages without collecting command output or app data. */
function createIosStageRecorder(record, now = () => performance.now()) {
  const stages = [];
  const publish = () => record(Object.freeze({ version: 1, stages: Object.freeze(stages.map((row) => Object.freeze({ ...row }))) }));
  return async (stage, action) => {
    if (!/^(create|boot|bootstatus|install|container|terminate|(?:readiness|launch|report)-(?:create|restart))$/.test(stage) || stages.length >= 16)
      throw Error('Invalid iOS qualification stage');
    const row = { stage, status: 'running', elapsedMs: null };
    stages.push(row); publish();
    const started = now();
    try { const result = await action(); row.status = 'complete'; return result; }
    catch (error) { row.status = 'failed'; throw error; }
    finally {
      row.elapsedMs = Math.max(0, Math.min(600000, now() - started));
      if (row.status === 'failed') { try { publish(); } catch { /* Preserve the original stage failure. */ } }
      else publish();
    }
  };
}

module.exports = { prepareIosSimulator, createIosStageRecorder, inspectIosServices, assertOwnedIosDevice };
