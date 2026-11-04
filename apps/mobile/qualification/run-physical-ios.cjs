#!/usr/bin/env node
// Host-only runner. Importing this file never contacts a device.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Buffer } = require('node:buffer');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { PHYSICAL_BUNDLES } = require('./physical-contract.ts');
const {
  decodePhysicalReport,
  assertPhysicalRestart,
} = require('./report-validation.cjs');

const sha256 = (bytes) =>
  crypto.createHash('sha256').update(bytes).digest('hex');
const fail = (code) => {
  const error = new Error(code);
  error.code = code;
  throw error;
};
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
function plain(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}
function parseOptions(argv) {
  const flags = new Set([
    '--device',
    '--source-revision',
    '--import-app',
    '--generate-app',
    '--import-cdhash',
    '--generate-cdhash',
    '--output',
  ]);
  const values = {};
  let reset = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--reset-fixtures') {
      if (reset) fail('INVALID_ARGUMENTS');
      reset = true;
      continue;
    }
    if (
      !flags.has(flag) ||
      own(values, flag) ||
      typeof argv[i + 1] !== 'string' ||
      argv[i + 1].startsWith('--')
    )
      fail('INVALID_ARGUMENTS');
    values[flag] = argv[++i];
  }
  if (
    Object.keys(values).length !== flags.size ||
    !/^[a-f0-9-]{20,64}$/i.test(values['--device']) ||
    !/^[a-f0-9]{40}$/.test(values['--source-revision']) ||
    !/^[a-f0-9]{40}$/.test(values['--import-cdhash']) ||
    !/^[a-f0-9]{40}$/.test(values['--generate-cdhash'])
  )
    fail('INVALID_ARGUMENTS');
  return Object.freeze({
    device: values['--device'],
    sourceRevision: values['--source-revision'],
    output: path.resolve(values['--output']),
    reset,
    apps: Object.freeze({
      import: path.resolve(values['--import-app']),
      generate: path.resolve(values['--generate-app']),
    }),
    cdhashes: Object.freeze({
      import: values['--import-cdhash'],
      generate: values['--generate-cdhash'],
    }),
  });
}

/** No command diagnostics may serialize device IDs, account names or file contents. */
function executor(spawn) {
  return (command, args, { optional = false, input, bytes = false } = {}) => {
    let result;
    try {
      result = spawn(command, args, {
        encoding: bytes ? undefined : 'utf8',
        input,
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      });
    } catch {
      if (optional) return null;
      return fail('NATIVE_COMMAND_FAILED');
    }
    if (result.status !== 0 || result.error) {
      if (optional) return null;
      return fail(
        result.error?.code === 'ETIMEDOUT'
          ? 'NATIVE_COMMAND_TIMED_OUT'
          : 'NATIVE_COMMAND_FAILED'
      );
    }
    return result;
  };
}

function deviceSelection(document, requested) {
  const devices = document?.devices;
  if (!Array.isArray(devices) || devices.length > 256)
    fail('INVALID_DEVICE_LIST');
  const found = devices.filter(
    (d) =>
      plain(d) &&
      [d.identifier, d.hardwareProperties?.udid].some(
        (id) =>
          typeof id === 'string' && id.toLowerCase() === requested.toLowerCase()
      )
  );
  if (found.length !== 1) fail('PHYSICAL_DEVICE_NOT_FOUND');
  const device = found[0];
  const h = device.hardwareProperties;
  const c = device.connectionProperties;
  const p = device.deviceProperties;
  if (
    typeof device.identifier !== 'string' ||
    !/^[a-f0-9-]{20,64}$/i.test(device.identifier) ||
    h?.reality !== 'physical' ||
    h.platform !== 'iOS' ||
    h.deviceType !== 'iPhone' ||
    c?.pairingState !== 'paired' ||
    c.tunnelState !== 'connected' ||
    p?.bootState !== 'booted' ||
    p.ddiServicesAvailable !== true ||
    !/^\d+(?:\.\d+){0,2}$/.test(p.osVersionNumber || '')
  )
    fail('PHYSICAL_DEVICE_NOT_READY');
  return Object.freeze({
    identifier: device.identifier,
    osVersion: p.osVersionNumber,
  });
}

function inspectArtifact(app, scenario, options, execute, lockfileSha256) {
  if (
    !app.endsWith('.app') ||
    !fs.lstatSync(app).isDirectory() ||
    fs.lstatSync(app).isSymbolicLink()
  )
    fail('INVALID_APP_ARTIFACT');
  const infoFile = path.join(app, 'Info.plist');
  if (
    !fs.lstatSync(infoFile).isFile() ||
    fs.lstatSync(infoFile).isSymbolicLink()
  )
    fail('INVALID_APP_INFO');
  const info = JSON.parse(
    execute('plutil', ['-convert', 'json', '-o', '-', infoFile]).stdout
  );
  const bundle = PHYSICAL_BUNDLES[scenario];
  if (
    !plain(info) ||
    info.CFBundleIdentifier !== bundle ||
    info.DTPlatformName !== 'iphoneos' ||
    info.PaliQualificationMode !== 'physical' ||
    info.PaliQualificationScenario !== scenario ||
    info.PaliQualificationSourceRevision !== options.sourceRevision ||
    info.PaliQualificationLockfileSHA256 !== lockfileSha256 ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(info.CFBundleExecutable || '')
  )
    fail('APP_IDENTITY_MISMATCH');
  const executable = path.join(app, info.CFBundleExecutable);
  if (
    !fs.lstatSync(executable).isFile() ||
    fs.lstatSync(executable).isSymbolicLink() ||
    fs.lstatSync(executable).size > 256 * 1024 * 1024
  )
    fail('INVALID_APP_EXECUTABLE');
  const arch = execute('lipo', ['-archs', executable])
    .stdout.trim()
    .split(/\s+/);
  if (
    !arch.includes('arm64') ||
    arch.some((value) => !['arm64', 'arm64e'].includes(value))
  )
    fail('PHYSICAL_ARCHITECTURE_REQUIRED');
  execute('codesign', ['--verify', '--deep', '--strict', app]);
  const signature = execute('codesign', [
    '--display',
    '--verbose=4',
    '--entitlements',
    ':-',
    app,
  ]);
  const details = String(signature.stderr || '');
  const cdhash = /^CDHash=([0-9a-f]{40})$/im.exec(details)?.[1].toLowerCase();
  const team = /^TeamIdentifier=([A-Z0-9]{10})$/m.exec(details)?.[1];
  if (cdhash !== options.cdhashes[scenario] || !team || /adhoc/i.test(details))
    fail('SIGNED_APP_REQUIRED');
  const entitlements = JSON.parse(
    execute('plutil', ['-convert', 'json', '-o', '-', '-'], {
      input: signature.stdout,
    }).stdout
  );
  if (
    !plain(entitlements) ||
    entitlements['application-identifier'] !== `${team}.${bundle}` ||
    entitlements['com.apple.developer.team-identifier'] !== team ||
    entitlements['get-task-allow'] !== true ||
    (own(entitlements, 'com.apple.security.application-groups') &&
      (!Array.isArray(entitlements['com.apple.security.application-groups']) ||
        entitlements['com.apple.security.application-groups'].length !== 0)) ||
    (own(entitlements, 'keychain-access-groups') &&
      (!Array.isArray(entitlements['keychain-access-groups']) ||
        entitlements['keychain-access-groups'].some(
          (group) => group !== `${team}.${bundle}`
        )))
  )
    fail('ISOLATED_DEVELOPMENT_ENTITLEMENTS_REQUIRED');
  const bundleFile = path.join(app, 'main.jsbundle');
  if (
    !fs.lstatSync(bundleFile).isFile() ||
    fs.lstatSync(bundleFile).isSymbolicLink() ||
    fs.lstatSync(bundleFile).size > 64 * 1024 * 1024
  )
    fail('BUNDLED_JAVASCRIPT_REQUIRED');
  return Object.freeze({
    app,
    scenario,
    bundle,
    executableName: info.CFBundleExecutable,
    cdhash,
    executableSha256: sha256(fs.readFileSync(executable)),
    bundleSha256: sha256(fs.readFileSync(bundleFile)),
    signingTeamSha256: sha256(team),
  });
}

async function runPhysical(options, dependencies = {}) {
  const execute = executor(dependencies.spawnSync || spawnSync);
  const now = dependencies.now || (() => performance.now());
  const sleep =
    dependencies.sleep ||
    ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const random = dependencies.randomBytes || crypto.randomBytes;
  const mobile = path.resolve(
    path.dirname(require.resolve('./run-physical-ios.cjs')),
    '..'
  );
  const repository = path.resolve(mobile, '../..');
  let stage = 'source';
  let owned = null;
  let device;
  const persist = (name, value) =>
    fs.writeFileSync(
      path.join(options.output, name),
      `${JSON.stringify(value, null, 2)}\n`,
      { flag: 'wx', mode: 0o600 }
    );
  const dc = (args, optional = false) => {
    const result = execute(
      'xcrun',
      ['devicectl', '--json-output', '-', '--timeout', '30', ...args],
      { optional }
    );
    if (!result) return null;
    const text = String(result.stdout);
    if (Buffer.byteLength(text) > 1024 * 1024)
      fail('DEVICE_RESPONSE_TOO_LARGE');
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      return fail('INVALID_DEVICE_RESPONSE');
    }
    if (
      !plain(value) ||
      !plain(value.result) ||
      own(value, 'error') ||
      value.info?.outcome !== 'success'
    )
      fail('INVALID_DEVICE_RESPONSE');
    return value.result;
  };
  const checkDevice = () => {
    const value = deviceSelection(dc(['list', 'devices']), options.device);
    if (
      device &&
      (device.identifier !== value.identifier ||
        device.osVersion !== value.osVersion)
    )
      fail('DEVICE_CONTEXT_CHANGED');
    device = value;
    return value;
  };
  const processes = () => {
    const value = dc([
      'device',
      'info',
      'processes',
      '--device',
      device.identifier,
    ]);
    if (
      !Array.isArray(value.runningProcesses) ||
      value.runningProcesses.length > 4096
    )
      fail('INVALID_PROCESS_LIST');
    return value.runningProcesses;
  };
  const stopOwned = () => {
    if (!owned) return;
    checkDevice();
    const matches = processes().filter(
      (row) => row.processIdentifier === owned.pid
    );
    if (
      matches.length > 1 ||
      (matches.length === 1 && matches[0].executable !== owned.executable)
    )
      fail('OWNED_PROCESS_CHANGED');
    if (matches.length)
      dc([
        'device',
        'process',
        'terminate',
        '--device',
        device.identifier,
        '--pid',
        String(owned.pid),
        '--kill',
      ]);
    owned = null;
  };
  const launch = (artifact, phase, runId, address) => {
    if (owned) fail('PROCESS_ALREADY_OWNED');
    checkDevice();
    const before = processes();
    if (
      before.some(
        (row) =>
          typeof row.executable === 'string' &&
          row.executable.endsWith(`/${artifact.executableName}`)
      )
    )
      fail('FIXTURE_PROCESS_ALREADY_RUNNING');
    const url = new URL('pali-wallet-qualification://physical');
    url.searchParams.set('phase', phase);
    url.searchParams.set('scenario', artifact.scenario);
    url.searchParams.set('runId', runId);
    if (address) url.searchParams.set('address', address);
    const value = dc([
      'device',
      'process',
      'launch',
      '--device',
      device.identifier,
      artifact.bundle,
      '--',
      '-PaliQualificationURL',
      url.href,
    ]);
    const pid = value.processIdentifier ?? value.process?.processIdentifier;
    const executable = value.executable ?? value.process?.executable;
    if (
      own(value, 'processIdentifier') &&
      value.process?.processIdentifier !== undefined &&
      value.processIdentifier !== value.process.processIdentifier
    )
      fail('INVALID_LAUNCH_RECEIPT');
    if (!Number.isSafeInteger(pid) || pid < 1 || typeof executable !== 'string')
      fail('INVALID_LAUNCH_RECEIPT');
    if (before.some((row) => row.processIdentifier === pid))
      fail('LAUNCH_DID_NOT_CREATE_PROCESS');
    let file;
    try {
      file = new URL(executable);
    } catch {
      return fail('INVALID_LAUNCH_RECEIPT');
    }
    if (
      file.protocol !== 'file:' ||
      file.host ||
      !file.pathname.startsWith(
        '/private/var/containers/Bundle/Application/'
      ) ||
      path.basename(file.pathname) !== artifact.executableName
    )
      fail('INVALID_LAUNCH_RECEIPT');
    owned = Object.freeze({ pid, executable });
  };
  const readFile = (
    artifact,
    source,
    destination,
    optional = false,
    maximum = 100000
  ) => {
    checkDevice();
    const value = dc(
      [
        'device',
        'copy',
        'from',
        '--device',
        device.identifier,
        '--domain-type',
        'appDataContainer',
        '--domain-identifier',
        artifact.bundle,
        '--source',
        source,
        '--destination',
        destination,
      ],
      optional
    );
    if (!value) return null;
    const stat = fs.lstatSync(destination);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum)
      fail('INVALID_COPIED_FILE');
    const bytes = fs.readFileSync(destination);
    fs.unlinkSync(destination);
    return bytes;
  };
  const awaitReport = async (artifact, phase, runId) => {
    const deadline = now() + 300000;
    let attempt = 0;
    while (now() < deadline && attempt < 301) {
      const name = `pali-native-qualification-${phase}-${runId}.json`;
      const bytes = readFile(
        artifact,
        `Documents/${name}`,
        path.join(options.output, `.read-${attempt++}.json`),
        true
      );
      if (bytes) {
        let value;
        if (phase === 'reset') {
          value = JSON.parse(bytes.toString('utf8'));
          const keys = [
            'keyDeleted',
            'physicalBundleIdentifier',
            'physicalRunId',
            'physicalSourceRevision',
            'status',
            'version',
          ];
          if (
            !plain(value) ||
            Object.keys(value).sort().join(',') !== keys.join(',') ||
            value.version !== 1 ||
            value.status !== 'reset' ||
            value.keyDeleted !== true ||
            value.physicalRunId !== runId ||
            value.physicalBundleIdentifier !== artifact.bundle ||
            value.physicalSourceRevision !== options.sourceRevision
          )
            fail('INVALID_RESET_ACKNOWLEDGEMENT');
        } else {
          value = decodePhysicalReport(bytes.toString('utf8'), {
            phase,
            scenario: artifact.scenario,
            runId,
            bundleIdentifier: artifact.bundle,
            sourceRevision: options.sourceRevision,
          });
          if (value.osVersion !== device.osVersion)
            fail('PHYSICAL_OS_VERSION_CHANGED');
        }
        return value;
      }
      if (
        !owned ||
        !processes().some(
          (row) =>
            row.processIdentifier === owned.pid &&
            row.executable === owned.executable
        )
      )
        fail('QUALIFICATION_PROCESS_EXITED');
      await sleep(1000);
    }
    fail('QUALIFICATION_REPORT_TIMED_OUT');
  };

  if (
    process.env.CI !== 'true' ||
    process.env.PALI_NATIVE_QUALIFICATION !== '1'
  )
    fail('EXPLICIT_QUALIFICATION_REQUIRED');
  if (
    execute('git', ['-C', repository, 'rev-parse', 'HEAD']).stdout.trim() !==
      options.sourceRevision ||
    execute('git', [
      '-C',
      repository,
      'status',
      '--porcelain',
      '--untracked-files=normal',
    ]).stdout.trim()
  )
    fail('CLEAN_APPROVED_SOURCE_REQUIRED');
  const lockfileSha256 = sha256(
    fs.readFileSync(path.join(mobile, 'package-lock.json'))
  );
  const artifacts = ['import', 'generate'].map((scenario) =>
    inspectArtifact(
      options.apps[scenario],
      scenario,
      options,
      execute,
      lockfileSha256
    )
  );
  if (artifacts[0].signingTeamSha256 !== artifacts[1].signingTeamSha256)
    fail('SIGNING_TEAM_CHANGED');
  if (
    artifacts.some(
      (a) =>
        options.output === a.app ||
        options.output.startsWith(`${a.app}${path.sep}`)
    )
  )
    fail('INVALID_OUTPUT_DIRECTORY');
  fs.mkdirSync(options.output, { mode: 0o700 });
  // Resolve aliases before claiming the one-owner host lease.
  let leaseFile;
  let leaseToken;
  let lease;
  try {
    stage = 'physical-device';
    checkDevice();
    leaseFile = path.join(
      os.tmpdir(),
      `pali-physical-${sha256(device.identifier.toLowerCase())}.lock`
    );
    leaseToken = crypto.randomBytes(16).toString('hex');
    try {
      lease = fs.openSync(leaseFile, 'wx', 0o600);
      fs.writeFileSync(
        lease,
        JSON.stringify({ pid: process.pid, token: leaseToken })
      );
    } catch {
      if (lease !== undefined) {
        fs.closeSync(lease);
        lease = undefined;
      }
      fail('PHYSICAL_HOST_LEASE_BUSY');
    }
    const summaries = [];
    for (const artifact of artifacts) {
      const runId = random(16).toString('hex');
      if (!/^[0-9a-f]{32}$/.test(runId)) fail('INVALID_RUN_ID');
      stage = `${artifact.scenario}-admission`;
      const installed = dc([
        'device',
        'info',
        'apps',
        '--device',
        device.identifier,
        '--bundle-id',
        artifact.bundle,
      ]);
      if (
        !Array.isArray(installed.apps) ||
        installed.apps.some((app) => app.bundleIdentifier !== artifact.bundle)
      )
        fail('INVALID_APP_LIST');
      if (installed.apps.length && !options.reset)
        fail('FIXTURE_ALREADY_INSTALLED_USE_EXPLICIT_RESET');
      if (
        processes().some(
          (row) =>
            typeof row.executable === 'string' &&
            row.executable.endsWith(`/${artifact.executableName}`)
        )
      )
        fail('FIXTURE_PROCESS_ALREADY_RUNNING');
      checkDevice();
      dc([
        'device',
        'install',
        'app',
        '--device',
        device.identifier,
        artifact.app,
      ]);
      if (options.reset) {
        stage = `${artifact.scenario}-explicit-reset`;
        launch(artifact, 'reset', runId);
        const ack = await awaitReport(artifact, 'reset', runId);
        persist(`${artifact.scenario}-explicit-reset.json`, ack);
        stopOwned();
        // Only these two literal fixture bundles can reach this operation.
        if (artifact.bundle !== PHYSICAL_BUNDLES[artifact.scenario])
          fail('INVALID_RESET_TARGET');
        checkDevice();
        dc([
          'device',
          'uninstall',
          'app',
          '--device',
          device.identifier,
          artifact.bundle,
        ]);
        checkDevice();
        dc([
          'device',
          'install',
          'app',
          '--device',
          device.identifier,
          artifact.app,
        ]);
      }
      stage = `${artifact.scenario}-create`;
      launch(artifact, 'create', runId);
      const created = await awaitReport(artifact, 'create', runId);
      persist(`${artifact.scenario}-create.json`, created);
      stopOwned();
      const database = readFile(
        artifact,
        'Library/Application Support/PaliWallet/wallet.sqlite',
        path.join(options.output, '.database'),
        false,
        64 * 1024 * 1024
      );
      if (
        database.length < 4096 ||
        database.subarray(0, 16).toString() === 'SQLite format 3\0' ||
        database.includes(
          Buffer.from(
            'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
          )
        ) ||
        database.includes(
          Buffer.from('PUBLIC native qualification password 2026')
        )
      )
        fail('INVALID_ENCRYPTED_DATABASE');
      const databaseEvidence = {
        bytes: database.length,
        sha256: sha256(database),
        plaintextHeader: false,
        fixtureCredentialsPresent: false,
      };
      database.fill(0);
      stage = `${artifact.scenario}-restart`;
      launch(artifact, 'restart', runId, created.address);
      const restored = await awaitReport(artifact, 'restart', runId);
      assertPhysicalRestart(created, restored);
      persist(`${artifact.scenario}-restart.json`, restored);
      stopOwned();
      summaries.push({
        scenario: artifact.scenario,
        bundleIdentifier: artifact.bundle,
        cdhash: artifact.cdhash,
        executableSha256: artifact.executableSha256,
        bundleSha256: artifact.bundleSha256,
        database: databaseEvidence,
        processRestartVerified: true,
        hdAccountsRestored: true,
        erc20TransferRestored: true,
      });
    }
    const report = {
      version: 1,
      status: 'passed',
      sourceRevision: options.sourceRevision,
      lockfileSha256,
      physicalDevice: true,
      deviceIdentifierSha256: sha256(device.identifier),
      osVersion: device.osVersion,
      fixtureCustodyQualified: true,
      uiQualified: false,
      liveNetworkQualified: false,
      physicalPrivacyQualified: false,
      summaries,
    };
    persist('physical-ios-qualification.json', report);
    return report;
  } catch (error) {
    try {
      stopOwned();
    } catch {
      /* Never terminate a process whose ownership cannot be proved. */
    }
    persist('physical-ios-failure.json', {
      version: 1,
      status: 'failed',
      sourceRevision: options.sourceRevision,
      stage,
      code: /^[A-Z0-9_]+$/.test(error.code || '')
        ? error.code
        : 'QUALIFICATION_FAILED',
    });
    throw error;
  } finally {
    if (lease !== undefined) {
      fs.closeSync(lease);
      try {
        const held = JSON.parse(fs.readFileSync(leaseFile, 'utf8'));
        if (held.token === leaseToken && held.pid === process.pid)
          fs.unlinkSync(leaseFile);
      } catch {
        /* Do not remove another owner's lease or hide the original failure. */
      }
    }
  }
}

if (require.main === module) {
  Promise.resolve()
    .then(() => runPhysical(parseOptions(process.argv.slice(2))))
    .then(() => console.log('Physical iPhone fixture qualification passed.'))
    .catch((error) => {
      console.error(
        /^[A-Z0-9_]+$/.test(error.code || '')
          ? error.code
          : 'PHYSICAL_QUALIFICATION_FAILED'
      );
      process.exitCode = 1;
    });
}
module.exports = {
  parseOptions,
  deviceSelection,
  inspectArtifact,
  runPhysical,
};
