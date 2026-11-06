/* global __dirname */
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { performance } = require('node:perf_hooks');
const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');
const { createInterface } = require('node:readline');
const { setTimeout: delay } = require('node:timers/promises');
const { isAmbiguousCommandFailure } = require('./command-runner.cjs');
const { reverseMappings } = require('./http-companion.cjs');
const { parseQualificationLaunch } = require('./launch-parameters.ts');
const { readPublicPoolCa } = require('./public-pool-ca.cjs');
const { PUBLIC_POOL_FAILURE_FILE, parsePublicPoolFailure } = require('./public-pool-contract.ts');
const { readFixtureBuild } = require('./run-public-pool-fixture.cjs');

const PUBLIC_POOL_REPORT_TIMEOUT = 300_000;
const runTimeout = (operation, milliseconds, code) => {
  let timer;
  return Promise.race([operation, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error(code)), milliseconds);
  })]).finally(() => clearTimeout(timer));
};

function readPublicPoolCiBuild(env, receiptPath) {
  if (env.CI !== 'true' || env.GITHUB_ACTIONS !== 'true' || env.PALI_NATIVE_QUALIFICATION !== '1' ||
      env.PALI_NATIVE_PUBLIC_POOL_QUALIFICATION !== '1' || env.PALI_NATIVE_HTTP_QUALIFICATION !== '0' ||
      env.PALI_PHYSICAL_QUALIFICATION !== undefined) throw Error('PUBLIC_POOL_REQUIRES_HOSTED_ISOLATION');
  const ca = env.PALI_PUBLIC_POOL_FIXTURE_CA, cert = env.PALI_PUBLIC_POOL_FIXTURE_CERT, key = env.PALI_PUBLIC_POOL_FIXTURE_KEY;
  const { build, caSha256 } = readFixtureBuild(receiptPath);
  if (build.sourceRevision !== env.GITHUB_SHA || readPublicPoolCa(ca).sha256 !== caSha256 || !cert || !key)
    throw Error('PUBLIC_POOL_CI_BUILD_MISMATCH');
  return { receiptPath, ca, cert, key, build, caSha256 };
}

function androidPublicPoolSerial(run) {
  const serial = run('adb', ['get-serialno']);
  const getProperty = (key) => run('adb', ['-s', serial, 'shell', 'getprop', key], false, 5000);
  if (!/^emulator-[0-9]+$/.test(serial) || !/^PaliQualification(?:\r?\nOK)?$/.test(
    run('adb', ['-s', serial, 'emu', 'avd', 'name'], false, 5000)) ||
      !['ro.boot.qemu', 'ro.kernel.qemu'].some((key) => getProperty(key) === '1') ||
      getProperty('ro.build.version.sdk') !== '35' || getProperty('sys.boot_completed') !== '1')
    throw Error('PUBLIC_POOL_REQUIRES_OWNED_CI_EMULATOR');
  return serial;
}

async function withPublicPoolAndroidRoutes(run, serial, ports, execute) {
  if (!/^emulator-[0-9]+$/.test(serial) || ports.length !== 2 || new Set(ports).size !== 2 ||
      ports.some((port) => !Number.isSafeInteger(port) || port < 1024 || port > 65535))
    throw Error('PUBLIC_POOL_REVERSE_SCOPE_INVALID');
  const owned = [];
  const rows = () => reverseMappings(run('adb', ['-s', serial, 'reverse', '--list'], false, 5000));
  const owns = (route) => {
    const matching = rows().filter((parts) => parts[1] === route);
    return matching.length === 1 && matching[0][2] === route;
  };
  let failure;
  try {
    for (const port of ports) {
      const route = `tcp:${port}`;
      if (rows().some((parts) => parts[1] === route)) throw Error('PUBLIC_POOL_REVERSE_COLLISION');
      const args = ['-s', serial, 'reverse', '--no-rebind', route, route];
      try { run('adb', args); }
      catch (error) {
        if (isAmbiguousCommandFailure(error, 'adb', args)) {
          try { if (owns(route)) owned.push(route); } catch { /* Uncertain ownership prevents removal. */ }
        }
        throw error;
      }
      owned.push(route);
      if (!owns(route)) throw Error('PUBLIC_POOL_REVERSE_UNVERIFIED');
    }
    return await execute();
  } catch (error) { failure = error; throw error; }
  finally {
    let cleanupFailure;
    for (const route of owned.reverse()) {
      try { if (owns(route)) run('adb', ['-s', serial, 'reverse', '--remove', route]); }
      catch (error) { cleanupFailure ??= error; }
    }
    if (!failure && cleanupFailure) throw cleanupFailure;
  }
}

async function waitPublicPoolReport(read, failed, now = () => performance.now(), pause = delay) {
  const deadline = now() + PUBLIC_POOL_REPORT_TIMEOUT;
  while (now() < deadline) {
    if (failed?.()) throw Error('PUBLIC_POOL_APP_FAILED');
    const value = read();
    if (value) return value;
    await pause(1000);
  }
  throw Error('PUBLIC_POOL_APP_REPORT_TIMEOUT');
}

async function runHostedPublicPool({ platform, config, output, execute, start = spawn }) {
  const reportFile = path.join(output, `${platform}-public-pool-app.json`);
  if (fs.existsSync(reportFile)) throw Error('PUBLIC_POOL_REPORT_ALREADY_EXISTS');
  const child = start(process.execPath, [path.join(__dirname, 'run-public-pool-fixture.cjs'),
    platform, config.receiptPath, config.ca, config.cert, config.key, reportFile], {
    env: { CI: 'true', PALI_NATIVE_PUBLIC_POOL_QUALIFICATION: '1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const closed = once(child, 'close');
  void closed.catch(() => undefined);
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  try {
    const first = await runTimeout(lines.next(), 5000, 'PUBLIC_POOL_HOST_START_TIMEOUT');
    if (first.done || typeof first.value !== 'string' || first.value.length > 2048) throw Error('PUBLIC_POOL_HOST_LAUNCH_INVALID');
    const { uri, report, snapshotPort, anchorPort, caSha256 } = JSON.parse(first.value);
    const launch = parseQualificationLaunch(uri).publicPool;
    if (!launch || launch.snapshotPort !== snapshotPort || launch.anchorPort !== anchorPort ||
        caSha256 !== config.caSha256 || report !== `pali-native-public-pool-${launch.token}.json`)
      throw Error('PUBLIC_POOL_HOST_LAUNCH_INVALID');
    const captureFailure = (read) => {
      let raw;
      try { raw = read(PUBLIC_POOL_FAILURE_FILE); }
      catch { throw Error('PUBLIC_POOL_FAILURE_REPORT_INVALID'); }
      if (raw === undefined) return false;
      const failure = parsePublicPoolFailure(raw);
      try { fs.writeFileSync(path.join(output, `${platform}-public-pool-app-failure.json`), `${JSON.stringify(failure)}\n`, { flag: 'wx' }); }
      catch { throw Error('PUBLIC_POOL_FAILURE_REPORT_WRITE_FAILED'); }
      return true;
    };
    const appReport = await execute({ uri, report, captureFailure, ports: [snapshotPort, anchorPort] });
    if (typeof appReport !== 'string' || !appReport || appReport.length > 8192) throw Error('PUBLIC_POOL_APP_REPORT_INVALID');
    fs.writeFileSync(reportFile + '.tmp', appReport, { flag: 'wx' });
    fs.renameSync(reportFile + '.tmp', reportFile);
    const [code] = await runTimeout(closed, 5000, 'PUBLIC_POOL_HOST_VERIFY_TIMEOUT');
    const result = await lines.next();
    if (code !== 0 || result.done || typeof result.value !== 'string' || result.value.length > 8192)
      throw Error('PUBLIC_POOL_HOST_VERIFY_FAILED');
    const verified = JSON.parse(result.value);
    if (verified.passed !== true || verified.platform !== platform || verified.caSha256 !== config.caSha256 ||
        Object.entries(config.build).some(([key, value]) => verified[key] !== value))
      throw Error('PUBLIC_POOL_HOST_VERIFY_FAILED');
    return verified;
  } finally {
    child.kill();
    await runTimeout(closed, 5000, 'PUBLIC_POOL_HOST_STOP_TIMEOUT').catch(() => child.kill('SIGKILL'));
  }
}

module.exports = { androidPublicPoolSerial, readPublicPoolCiBuild, runHostedPublicPool, waitPublicPoolReport, withPublicPoolAndroidRoutes };
