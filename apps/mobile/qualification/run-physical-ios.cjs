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
const { FULL_SLH_PHASE_TIMEOUT_MS } = require('./native-slh-full.ts');
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
const MAX_ARTIFACT_BYTES = 1024 * 1024 * 1024;
const MAX_ARTIFACT_FILE_BYTES = 256 * 1024 * 1024;
const MAX_ARTIFACT_ENTRIES = 20000;
const XCODE_REQUIREMENT =
  'Physical iOS qualification requires Xcode 27 or newer. Select it with xcode-select or DEVELOPER_DIR, then retry.';
function plain(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

/** Copy/read only bounded regular bundle entries; never follow a resource link. */
function artifactTree(app, destination) {
  const digest = crypto.createHash('sha256');
  const files = new Map();
  let entries = 0;
  let bytes = 0;
  const visit = (relative, depth) => {
    if (++entries > MAX_ARTIFACT_ENTRIES || depth > 32)
      fail('ARTIFACT_RESOURCE_LIMIT');
    const source = path.join(app, relative);
    const stat = fs.lstatSync(source);
    const target = destination && path.join(destination, relative);
    if (stat.isSymbolicLink()) fail('ARTIFACT_RESOURCE_UNSUPPORTED');
    if (stat.isDirectory()) {
      digest.update(`directory\0${relative}\0`);
      if (target) fs.mkdirSync(target, { mode: 0o700 });
      const directory = fs.opendirSync(source);
      const names = [];
      try {
        let entry;
        while ((entry = directory.readSync()) !== null) {
          if (names.length + entries >= MAX_ARTIFACT_ENTRIES)
            fail('ARTIFACT_RESOURCE_LIMIT');
          names.push(entry.name);
        }
      } finally {
        directory.closeSync();
      }
      for (const name of names.sort())
        visit(path.join(relative, name), depth + 1);
      return;
    }
    if (!stat.isFile()) fail('ARTIFACT_RESOURCE_UNSUPPORTED');
    bytes += stat.size;
    if (stat.size > MAX_ARTIFACT_FILE_BYTES || bytes > MAX_ARTIFACT_BYTES)
      fail('ARTIFACT_RESOURCE_LIMIT');
    const fileDigest = crypto.createHash('sha256');
    digest.update(
      `file\0${relative}\0${stat.mode & 0o111 ? 1 : 0}\0${stat.size}\0`
    );
    let input;
    let output;
    const chunk = Buffer.alloc(64 * 1024);
    try {
      input = fs.openSync(
        source,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
      );
      const opened = fs.fstatSync(input);
      if (
        !opened.isFile() ||
        opened.dev !== stat.dev ||
        opened.ino !== stat.ino ||
        opened.size !== stat.size
      )
        fail('ARTIFACT_CHANGED');
      if (target) output = fs.openSync(target, 'wx', 0o600);
      let read = 0;
      for (;;) {
        const length = fs.readSync(input, chunk, 0, chunk.length, null);
        if (!length) break;
        read += length;
        if (read > stat.size) fail('ARTIFACT_CHANGED');
        digest.update(chunk.subarray(0, length));
        fileDigest.update(chunk.subarray(0, length));
        if (output !== undefined) {
          let written = 0;
          while (written < length) {
            const count = fs.writeSync(
              output,
              chunk,
              written,
              length - written
            );
            if (count <= 0) fail('ARTIFACT_COPY_FAILED');
            written += count;
          }
        }
      }
      const after = fs.fstatSync(input);
      if (
        read !== stat.size ||
        after.size !== stat.size ||
        after.mtimeMs !== opened.mtimeMs ||
        after.ctimeMs !== opened.ctimeMs
      )
        fail('ARTIFACT_CHANGED');
    } finally {
      chunk.fill(0);
      if (output !== undefined) fs.closeSync(output);
      if (input !== undefined) fs.closeSync(input);
    }
    if (target) fs.chmodSync(target, stat.mode & 0o111 ? 0o500 : 0o400);
    files.set(relative, fileDigest.digest('hex'));
  };
  visit('', 0);
  return { sha256: digest.digest('hex'), files };
}

function sameArtifact(expected, actual) {
  return [
    'scenario',
    'bundle',
    'executableName',
    'cdhash',
    'executableSha256',
    'bundleSha256',
    'signingTeamSha256',
    'artifactSha256',
  ].every((key) => expected[key] === actual[key]);
}
function parseOptions(argv) {
  const flags = new Set([
    '--device',
    '--source-revision',
    '--import-app',
    '--generate-app',
    '--import-cdhash',
    '--generate-cdhash',
    '--full-slh-app',
    '--full-slh-cdhash',
    '--output',
  ]);
  const values = {};
  let reset = false;
  let fullSlh = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--full-slh') {
      if (fullSlh) fail('INVALID_ARGUMENTS');
      fullSlh = true;
      continue;
    }
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
    Object.keys(values).length !== (fullSlh ? 5 : 7) ||
    !/^[a-f0-9-]{20,64}$/i.test(values['--device']) ||
    !/^[a-f0-9]{40}$/.test(values['--source-revision']) ||
    typeof values['--output'] !== 'string' ||
    (fullSlh ?
      typeof values['--full-slh-app'] !== 'string' || !/^[a-f0-9]{40}$/.test(values['--full-slh-cdhash']) ||
      ['--import-app', '--generate-app', '--import-cdhash', '--generate-cdhash'].some(flag => own(values, flag)) :
      typeof values['--import-app'] !== 'string' || typeof values['--generate-app'] !== 'string' ||
      !/^[a-f0-9]{40}$/.test(values['--import-cdhash']) || !/^[a-f0-9]{40}$/.test(values['--generate-cdhash']) ||
      ['--full-slh-app', '--full-slh-cdhash'].some(flag => own(values, flag)))
  )
    fail('INVALID_ARGUMENTS');
  return Object.freeze({
    device: values['--device'],
    sourceRevision: values['--source-revision'],
    output: path.resolve(values['--output']),
    reset,
    ...(fullSlh ? { fullSlh: true } : {}),
    apps: Object.freeze({
      ...(fullSlh ? { full_slh: path.resolve(values['--full-slh-app']) } : {
        import: path.resolve(values['--import-app']),
        generate: path.resolve(values['--generate-app']),
      }),
    }),
    cdhashes: Object.freeze({
      ...(fullSlh ? { full_slh: values['--full-slh-cdhash'] } : {
        import: values['--import-cdhash'],
        generate: values['--generate-cdhash'],
      }),
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

function requirePhysicalXcode(execute) {
  let output;
  try {
    output = execute('xcodebuild', ['-version']).stdout;
  } catch {
    return fail('XCODE_27_REQUIRED');
  }
  if (typeof output !== 'string' || Buffer.byteLength(output) > 256)
    fail('XCODE_27_REQUIRED');
  const version =
    /^Xcode ([1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){0,2}\r?\nBuild version [A-Za-z0-9]{1,32}(?:\r?\n)?$/.exec(
      output
    );
  if (!version || version[0] !== output || Number(version[1]) < 27)
    fail('XCODE_27_REQUIRED');
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
    (scenario === 'full_slh' ? info.PaliQualificationFullSLH !== true : own(info, 'PaliQualificationFullSLH')) ||
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
  const tree = artifactTree(app);
  return Object.freeze({
    app,
    scenario,
    bundle,
    executableName: info.CFBundleExecutable,
    cdhash,
    executableSha256: tree.files.get(info.CFBundleExecutable),
    bundleSha256: tree.files.get('main.jsbundle'),
    artifactSha256: tree.sha256,
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
    // These exact, newly allocated destinations are ours. Do not follow links
    // or recursively delete unexpected directory contents during cleanup.
    try {
      fs.lstatSync(destination);
      fail('COPY_DESTINATION_EXISTS');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    let bytes;
    let failure;
    try {
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
      const input = fs.openSync(
        destination,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
      );
      const extra = Buffer.alloc(1);
      try {
        const opened = fs.fstatSync(input);
        if (
          !opened.isFile() ||
          opened.dev !== stat.dev ||
          opened.ino !== stat.ino ||
          opened.size !== stat.size
        )
          fail('INVALID_COPIED_FILE');
        bytes = Buffer.alloc(stat.size);
        let read = 0;
        while (read < bytes.length) {
          const length = fs.readSync(
            input,
            bytes,
            read,
            bytes.length - read,
            null
          );
          if (!length) fail('INVALID_COPIED_FILE');
          read += length;
        }
        if (fs.readSync(input, extra, 0, 1, null)) fail('INVALID_COPIED_FILE');
      } finally {
        extra.fill(0);
        fs.closeSync(input);
      }
      return bytes;
    } catch (error) {
      bytes?.fill(0);
      failure = error;
      throw error;
    } finally {
      try {
        const stat = fs.lstatSync(destination);
        if (stat.isDirectory()) fs.rmdirSync(destination);
        else fs.unlinkSync(destination);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          bytes?.fill(0);
          if (!failure) throw error;
        }
      }
    }
  };
  const awaitReport = async (artifact, phase, runId) => {
    const phaseTimeout = artifact.scenario === 'full_slh' && phase !== 'reset' ? FULL_SLH_PHASE_TIMEOUT_MS : 300000;
    const deadline = now() + phaseTimeout;
    let attempt = 0;
    while (now() < deadline && attempt < Math.ceil(phaseTimeout / 1000) + 1) {
      const name = `pali-native-qualification-${phase}-${runId}.json`;
      const bytes = readFile(
        artifact,
        `Documents/${name}`,
        path.join(options.output, `.read-${attempt++}.json`),
        true
      );
      if (bytes) {
        try {
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
              lockfileSha256,
            });
            if (value.osVersion !== device.osVersion)
              fail('PHYSICAL_OS_VERSION_CHANGED');
          }
          return value;
        } finally {
          bytes.fill(0);
        }
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
  // stdout JSON from devicectl requires the selected Xcode 27+ toolchain.
  // Reject it before reading/copying artifacts or contacting any device.
  requirePhysicalXcode(execute);
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
  if (options.fullSlh !== undefined && options.fullSlh !== true) fail('INVALID_ARGUMENTS');
  const scenarios = options.fullSlh ? ['full_slh'] : ['import', 'generate'];
  const originalArtifacts = scenarios.map((scenario) =>
    inspectArtifact(
      options.apps[scenario],
      scenario,
      options,
      execute,
      lockfileSha256
    )
  );
  if (
    originalArtifacts.some(artifact => artifact.signingTeamSha256 !== originalArtifacts[0].signingTeamSha256)
  )
    fail('SIGNING_TEAM_CHANGED');
  if (
    originalArtifacts.some(
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
    stage = 'artifact-snapshots';
    const staging = path.join(options.output, '.verified-artifacts');
    fs.mkdirSync(staging, { mode: 0o700 });
    const artifacts = originalArtifacts.map((original) => {
      const stagedPath = path.join(staging, `${original.scenario}.app`);
      artifactTree(original.app, stagedPath);
      const staged = inspectArtifact(
        stagedPath,
        original.scenario,
        options,
        execute,
        lockfileSha256
      );
      if (!sameArtifact(original, staged)) fail('ARTIFACT_CHANGED');
      return staged;
    });
    const install = (artifact) => {
      checkDevice();
      const checked = inspectArtifact(
        artifact.app,
        artifact.scenario,
        options,
        execute,
        lockfileSha256
      );
      if (!sameArtifact(artifact, checked)) fail('ARTIFACT_CHANGED');
      dc([
        'device',
        'install',
        'app',
        '--device',
        device.identifier,
        artifact.app,
      ]);
    };
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
      install(artifact);
      if (options.reset) {
        stage = `${artifact.scenario}-explicit-reset`;
        launch(artifact, 'reset', runId);
        const ack = await awaitReport(artifact, 'reset', runId);
        persist(`${artifact.scenario}-explicit-reset.json`, ack);
        stopOwned();
        // Only the selected literal fixture bundles can reach this operation.
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
        install(artifact);
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
      let databaseEvidence;
      try {
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
        databaseEvidence = {
          bytes: database.length,
          sha256: sha256(database),
          plaintextHeader: false,
          fixtureCredentialsPresent: false,
        };
      } finally {
        database.fill(0);
      }
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
        artifactSha256: artifact.artifactSha256,
        database: databaseEvidence,
        processRestartVerified: true,
        hdAccountsRestored: true,
        erc20TransferRestored: true,
        ...(artifact.scenario === 'full_slh' ? { fullSlhExecutionVerified: true,
          resources: { create: created.fullSlhResources, restart: restored.fullSlhResources } } : {}),
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
      ...(options.fullSlh ? { fullSlhExecutionVerified: true, fullSlhResourcesQualified: false } : {}),
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
        error.code === 'XCODE_27_REQUIRED'
          ? `XCODE_27_REQUIRED: ${XCODE_REQUIREMENT}`
          : /^[A-Z0-9_]+$/.test(error.code || '')
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
