/* global __dirname */
const { matchesImportedRestartEvidence } = require('./imported-evm.ts');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { Buffer } = require('node:buffer');
const {
  summarizeAndroidLog,
  summarizeAndroidExitInfo,
  latestAndroidExitPid,
} = require('./log-diagnostics.cjs');
const { isCryptoDiagnostic } = require('../src/crypto/diagnostics.ts');
const { matchesHdRestartEvidence } = require('./hd-accounts.ts');
const { matchesErc20RestartEvidence } = require('./erc20-transfer.ts');
const { matchesNevmRestartEvidence } = require('./nevm-transfer.ts');
const { matchesZksysRestartEvidence } = require('./zksys-transfer.ts');
const { matchesHdKeyRevealRestartEvidence } = require('./hd-key-reveal.ts');
const { createCommandRunner, describeQualificationFailure, COLD_BOOT_TIMEOUT_MS } = require('./command-runner.cjs');
const { qualificationMode, assertSimulatorTarget, selectSimulatorTarget } = require('./simulator-contract.cjs');
const { prepareAndroidRoot, launchIos } = require('./native-readiness.cjs');
const { prepareIosSimulator, createIosStageRecorder, assertOwnedIosDevice } = require('./ios-runner-diagnostics.cjs');
const { decodeNativeReport, assertFullNativeReport } = require('./report-validation.cjs');
const { readHttpSidecar, readAndroidHttpSidecar } = require('./post-sidecar.cjs');
const { captureIosLaunchReports } = require('./ios-launch-reports.cjs');
const { fullSlhBuild, readFullSlhEvidence, matchesFullSlhRestart, FULL_SLH_PHASE_TIMEOUT_MS } = require('./native-slh-full.ts');

if (process.env.CI !== 'true' || process.env.PALI_NATIVE_QUALIFICATION !== '1')
  throw Error('Run only against isolated qualification devices');
const platform = process.argv[2];
const mode = qualificationMode(platform, process.argv.slice(4));
const simulatorContract = mode === 'ios-simulator-contract';
let simulatorVersion;
const httpEnabled = process.env.PALI_NATIVE_HTTP_QUALIFICATION === '1';
const fullSlhEnabled = process.env.PALI_NATIVE_FULL_SLH_QUALIFICATION === '1';
const poolCi = process.env.PALI_NATIVE_PUBLIC_POOL_QUALIFICATION === '1' ? require('./public-pool-ci.cjs') : null;
const proofCi = process.env.PALI_NATIVE_PRIVATE_PROOF_QUALIFICATION === '1' ? require('./private-proof-ci.cjs') : null;
if (fullSlhEnabled && (httpEnabled || poolCi || proofCi || process.env.PALI_PHYSICAL_QUALIFICATION !== undefined))
  throw Error('Full SLH qualification requires a dedicated isolated build');
const fullSlhConfiguration = fullSlhEnabled ? fullSlhBuild(JSON.parse(fs.readFileSync(path.join(__dirname, '../.native-qualification.json'), 'utf8')).fullSlh) : null;
if (fullSlhConfiguration && (fullSlhConfiguration.sourceRevision !== process.env.GITHUB_SHA ||
    fullSlhConfiguration.lockfileSha256 !== crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../package-lock.json'))).digest('hex')))
  throw Error('Full SLH qualification build identity mismatch');
if (poolCi && platform === 'ios' && !simulatorContract) throw Error('Public pool qualification requires an owned simulator');
if (proofCi && platform === 'ios' && !simulatorContract) throw Error('Private proof qualification requires an owned simulator');
const publicPoolBuild = poolCi?.readPublicPoolCiBuild(process.env, path.join(__dirname, '../.native-qualification.json'));
if (httpEnabled && !/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA || ''))
  throw Error('Native HTTP qualification requires an immutable source revision');
let httpCompanion;
let httpRead;
let httpDiagnosticSaved = false;
const artifact = path.resolve(process.argv[3] || '');
const output = path.resolve(
  process.env.QUALIFICATION_ARTIFACTS ||
    '/private/tmp/pali-native-qualification'
);
const PACKAGE = 'com.paliwallet.qualification';
const PUBLIC_PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PUBLIC_PASSWORD = 'PUBLIC native qualification password 2026!';
if (!['ios', 'android'].includes(platform) || !fs.existsSync(artifact))
  throw Error('Expected platform and built qualification artifact');
if (simulatorContract && fs.existsSync(path.join(output, 'ios-qualification.json')))
  throw Error('Simulator output must not contain full custody evidence');
fs.mkdirSync(output, { recursive: true });
const redact = (value) =>
  value
    .split(PUBLIC_PHRASE)
    .join('[public phrase redacted]')
    .split(PUBLIC_PASSWORD)
    .join('[public password redacted]');
const run = createCommandRunner(spawnSync, redact);
const privateProofBuild = proofCi?.readPrivateProofCiBuild(process.env, path.join(__dirname, '..'), run);
const proofFailureName = (phase) => {
  if (!['create', 'startup'].includes(phase)) throw Error('PRIVATE_PROOF_FAILURE_PHASE_INVALID');
  return `pali-native-qualification-${phase}.json`;
};
const readIosProofFailure = (documents, phase) => {
  const name = proofFailureName(phase);
  let descriptor;
  try {
    descriptor = fs.openSync(path.join(documents, name), fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size < 1 || stat.size > 100000) throw Error('PRIVATE_PROOF_FAILURE_INVALID');
    const bytes = Buffer.alloc(100001); let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(descriptor, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > 100000) throw Error('PRIVATE_PROOF_FAILURE_INVALID');
    return bytes.subarray(0, length).toString('utf8');
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
};
const androidProcessRunning = () =>
  Boolean(
    run('adb', [
      'shell',
      `pidof -s ${PACKAGE}; pali_pidof_status=$?; if [ "$pali_pidof_status" -eq 1 ]; then exit 0; fi; exit "$pali_pidof_status"`,
    ])
  );
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
async function captureHttpDiagnostic() {
  if (!httpCompanion || httpDiagnosticSaved) return;
  try {
    const diagnostics = await httpCompanion.diagnostics(httpRead);
    httpDiagnosticSaved = true;
    for (const kind of ['http', 'post']) {
      const diagnostic = diagnostics?.[kind];
      if (!diagnostic) continue;
      const text = `${JSON.stringify(diagnostic, null, 2)}\n`;
      if (Buffer.byteLength(text) > 8192) continue;
      try { fs.writeFileSync(path.join(output, `${platform}-${kind}-diagnostic.json`), text); }
      catch { /* Keep the other diagnostic and the original failure. */ }
    }
  } catch { /* Partial diagnostics never replace the original failure. */ }
}
const validateReport = (text, phase, scenario) => {
  const report = decodeNativeReport(text, platform, phase, scenario, simulatorContract, simulatorVersion);
  fs.writeFileSync(
    path.join(output, `${platform}-${scenario}-${phase}.json`),
    simulatorContract ? text : `${JSON.stringify(report, null, 2)}\n`
  );
  if (!simulatorContract) assertFullNativeReport(report);
  if (fullSlhConfiguration && !simulatorContract) readFullSlhEvidence(report.fullSlh, phase, fullSlhConfiguration);
  return report;
};
const captureFixtureLoadError = (text, scenario, stage = 'quick-crypto-load') => {
  try {
    if (!['quick-crypto-load', 'software-sdk-load'].includes(stage) || scenario !== 'import' || typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 65536) return false;
    const value = JSON.parse(text);
    if (value.version !== 1 || value.stage !== stage ||
        !value.error || typeof value.error !== 'object' ||
        Object.keys(value).some((key) => !['version', 'stage', 'diagnostic', 'error'].includes(key)) ||
        Object.keys(value.error).some((key) => !['name', 'message', 'stack'].includes(key)) ||
        !['name', 'message', 'stack'].every((key) => typeof value.error[key] === 'string') ||
        (value.diagnostic !== undefined && !isCryptoDiagnostic({ bootstrap: 'quick-crypto-load', load: value.diagnostic }))) return false;
    const suffix = stage === 'quick-crypto-load' ? 'load-error' : 'sdk-load-error';
    fs.writeFileSync(path.join(output, `${platform}-import-fixture-${suffix}.json`), redact(text));
    return true;
  } catch {
    return false;
  }
};
const waitReport = async (read, phase, scenario, readStartup, isRunning) => {
  const startedAt = Date.now();
  const deadline = startedAt + 300000;
  const readAvailable = () => {
    const startup = readStartup?.();
    if (startup) {
      validateReport(startup, 'unknown', 'unknown');
      throw Error('Unexpected successful startup-failure report');
    }
    const text = read();
    return text ? validateReport(text, phase, scenario) : undefined;
  };
  while (Date.now() < deadline) {
    const report = readAvailable();
    if (report) return report;
    if (isRunning && Date.now() - startedAt >= 5000 && !isRunning()) {
      // A process may write its final report between the first read and exit.
      const finalReport = readAvailable();
      if (finalReport) return finalReport;
      throw Error(
        `Native ${platform} ${scenario} ${phase} process exited before report`
      );
    }
    await sleep(1000);
  }
  throw Error(`Native ${platform} ${scenario} ${phase} timed out`);
};
// Explicit manual full-profile lane only; ordinary custody keeps its 300s limit.
const waitFullSlhReport = async (read, phase, scenario, readStartup, isRunning) => {
  if (!fullSlhConfiguration || scenario !== 'import') throw Error('Full SLH qualification mode required');
  const startedAt = Date.now(), deadline = startedAt + FULL_SLH_PHASE_TIMEOUT_MS;
  const available = () => {
    const startup = readStartup?.();
    if (startup) { validateReport(startup, 'unknown', 'unknown'); throw Error('Unexpected startup report'); }
    const text = read(); return text ? validateReport(text, phase, scenario) : undefined;
  };
  while (Date.now() < deadline) {
    const report = available(); if (report) return report;
    if (isRunning && Date.now() - startedAt >= 5000 && !isRunning()) {
      const final = available(); if (final) return final;
      throw Error(`Native ${platform} full SLH ${phase} exited before report`);
    }
    await sleep(1000);
  }
  throw Error(`Native ${platform} full SLH ${phase} exceeded its 1800s phase budget`);
};
const waitPhaseReport = fullSlhEnabled ? waitFullSlhReport : waitReport;
const databaseEvidence = (bytes) => {
  if (
    bytes.length < 4096 ||
    bytes.subarray(0, 16).toString() === 'SQLite format 3\0' ||
    bytes.includes(Buffer.from(PUBLIC_PHRASE)) ||
    bytes.includes(Buffer.from(PUBLIC_PASSWORD))
  )
    throw Error(
      'Native database is empty, plaintext SQLite or contains fixture credentials'
    );
  return {
    bytes: bytes.length,
    sha256: hash(bytes),
    plaintextHeader: false,
    fixtureCredentialsPresent: false,
  };
};

async function ios() {
  const info = path.join(artifact, 'Info.plist');
  if (
    run('plutil', [
      '-extract',
      'CFBundleIdentifier',
      'raw',
      '-o',
      '-',
      info,
    ]) !== PACKAGE
  )
    throw Error('Refusing a production app identifier');
  const executable = run('plutil', [
    '-extract',
    'CFBundleExecutable',
    'raw',
    '-o',
    '-',
    info,
  ]);
  const runtimes = JSON.parse(
    run('xcrun', ['simctl', 'list', 'runtimes', '-j'])
  ).runtimes;
  const types = JSON.parse(
    run('xcrun', ['simctl', 'list', 'devicetypes', '-j'])
  ).devicetypes;
  const { runtime, type } = selectSimulatorTarget(runtimes, types,
    process.env.PALI_IOS_SIMULATOR_RUNTIME, process.env.PALI_IOS_SIMULATOR_DEVICE_TYPE);
  simulatorVersion = runtime.version;
  if (simulatorContract) {
    assertSimulatorTarget(run('plutil', ['-extract', 'DTPlatformName', 'raw', '-o', '-', info]), runtime.identifier, runtime.identifier);
    if (!/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA || '')) throw Error('Simulator contract requires source revision');
  }
  const reports = [];
  if (httpEnabled) {
    const { startHttpCompanion } = require('./http-companion.cjs');
    httpCompanion = await startHttpCompanion({ walletConnectIdentity: require('../scripts/qualification-sdk.cjs').readWalletConnectSdkIdentity(path.join(__dirname, '..')), platform, sourceRevision: process.env.GITHUB_SHA, run });
  }
  for (const scenario of (simulatorContract || fullSlhEnabled ? ['import'] : ['import', 'generate'])) {
    const stage = createIosStageRecorder((evidence) => fs.writeFileSync(
      path.join(output, `ios-${scenario}-stages.json`), `${JSON.stringify(evidence, null, 2)}\n`));
    let device, container;
    try {
      await stage('create', () => {
        const created = run('xcrun', [
          'simctl',
          'create',
          `PaliQualification-${scenario}-${Date.now()}`,
          type.identifier,
          runtime.identifier,
        ]);
        assertOwnedIosDevice(created, runtime.identifier);
        // Retain validated ownership before the completion record can fail.
        device = created;
      });
      await stage('boot', () => run('xcrun', ['simctl', 'boot', device]));
      await stage('bootstatus', () => run(
        'xcrun',
        ['simctl', 'bootstatus', device, '-b'],
        false,
        COLD_BOOT_TIMEOUT_MS
      ));
      if (publicPoolBuild) await stage('public-pool-trust', () => run(
        'xcrun', ['simctl', 'keychain', device, 'add-root-cert', publicPoolBuild.ca]));
      await stage('install', () => run('xcrun', ['simctl', 'install', device, artifact]));
      container = await stage('container', () => run('xcrun', [
        'simctl',
        'get_app_container',
        device,
        PACKAGE,
        'data',
      ]));
      httpRead = (name) => readHttpSidecar(path.join(container, 'Documents'), name);
      const read = (phase) => {
        try {
          return fs.readFileSync(
            path.join(
              container,
              'Documents',
              `pali-native-qualification-${phase}.json`
            ),
            'utf8'
          );
        } catch {
          return null;
        }
      };
      await stage('readiness-create', () => prepareIosSimulator(run, device, runtime.identifier,
        (evidence) => fs.writeFileSync(path.join(output, `ios-${scenario}-create-readiness.json`), `${JSON.stringify(evidence, null, 2)}\n`)));
      if (privateProofBuild) {
        const documents = path.join(container, 'Documents');
        const privateProof = await stage('report-create', () => proofCi.runPrivateProofQualification({
          platform, config: privateProofBuild, output,
          launch: (uri) => launchIos(run, device, uri, (evidence) => fs.writeFileSync(
            path.join(output, 'ios-private-proof-launch.json'), `${JSON.stringify(evidence, null, 2)}\n`)),
          list: () => fs.existsSync(documents) ? fs.readdirSync(documents) : [],
          read: (name) => readHttpSidecar(documents, name),
          readFailure: (phase) => readIosProofFailure(documents, phase),
        }));
        return { platform, runtime: runtime.identifier, privateProof,
          appExecutableSha256: hash(fs.readFileSync(path.join(artifact, executable))) };
      }
      if (publicPoolBuild) {
        const publicPool = await stage('report-create', () => poolCi.runHostedPublicPool({
          platform, config: publicPoolBuild, output,
          execute: async ({ uri, report, captureFailure }) => {
            launchIos(run, device, uri, (evidence) => fs.writeFileSync(path.join(output, 'ios-public-pool-launch.json'),
              `${JSON.stringify(evidence, null, 2)}\n`));
            const documents = path.join(container, 'Documents');
            const readPoolFile = (name) => fs.existsSync(path.join(documents, name)) ? readHttpSidecar(documents, name) : undefined;
            return poolCi.waitPublicPoolReport(
              () => readPoolFile(report),
              () => captureFailure(readPoolFile) || ['create', 'startup'].some((phase) => fs.existsSync(path.join(documents, `pali-native-qualification-${phase}.json`))));
          },
        }));
        return { platform, runtime: runtime.identifier, publicPool,
          appExecutableSha256: hash(fs.readFileSync(path.join(artifact, executable))) };
      }
      const httpCreate = httpCompanion ? await httpCompanion.begin('create', scenario) : '';
      await stage('launch-create', () => {
        try {
          return launchIos(run, device, `pali-wallet-qualification://run?phase=create&scenario=${scenario}${httpCreate}`,
            (evidence) => fs.writeFileSync(path.join(output, `ios-${scenario}-create-launch.json`), `${JSON.stringify(evidence, null, 2)}\n`));
        } catch (error) {
          try {
            captureIosLaunchReports(fs, container, scenario, (evidence) => fs.writeFileSync(
              path.join(output, `ios-${scenario}-create-launch-reports.json`), `${JSON.stringify(evidence, null, 2)}\n`));
          } catch { /* Report collection cannot replace the original launch failure. */ }
          throw error;
        }
      });
      const created = await stage('report-create', async () => {
        try {
          return await waitPhaseReport(() => read('create'), 'create', scenario, () => read('startup'));
        } catch (error) {
          try {
            captureIosLaunchReports(fs, container, scenario, (evidence) => fs.writeFileSync(
              path.join(output, `ios-${scenario}-create-failure-reports.json`), `${JSON.stringify(evidence, null, 2)}\n`), 'report-create');
          } catch { /* Report collection cannot replace the qualification error. */ }
          throw error;
        }
      });
      if (httpCompanion) {
        const { post, ...evidence } = await httpCompanion.verify(httpRead, created.sessionId);
        fs.writeFileSync(path.join(output, `ios-${scenario}-create-http.json`), `${JSON.stringify(evidence, null, 2)}\n`);
        fs.writeFileSync(path.join(output, `ios-${scenario}-create-post.json`), `${JSON.stringify(post, null, 2)}\n`);
      }
      if (simulatorContract) {
        // The original report remains failed. No database read, restart or
        // full-custody aggregate follows this expected protection refusal.
        return {
          platform,
          appExecutableSha256: hash(fs.readFileSync(path.join(artifact, executable))),
          runtime: runtime.identifier,
          nativeCryptoVerified: true,
          ...(fullSlhConfiguration ? { fullSlhQualified: false, fullSlhDurabilityQualified: false } : {}),
          sdkSmokeVerified: false,
          storageRefusal: created.storageDiagnostic,
          originalReportFile: 'ios-import-create.json',
        };
      }
      run('xcrun', [
        'simctl',
        'io',
        device,
        'screenshot',
        path.join(output, `ios-${scenario}-create.png`),
      ]);
      await stage('terminate', () => run('xcrun', ['simctl', 'terminate', device, PACKAGE]));
      const database = databaseEvidence(
        fs.readFileSync(
          path.join(
            container,
            'Library',
            'Application Support',
            'PaliWallet',
            'wallet.sqlite'
          )
        )
      );
      await stage('readiness-restart', () => prepareIosSimulator(run, device, runtime.identifier,
        (evidence) => fs.writeFileSync(path.join(output, `ios-${scenario}-restart-readiness.json`), `${JSON.stringify(evidence, null, 2)}\n`)));
      const httpRestart = httpCompanion ? await httpCompanion.begin('restart', scenario) : '';
      await stage('launch-restart', () => launchIos(run, device, `pali-wallet-qualification://run?phase=restart&scenario=${scenario}&address=${created.address}${httpRestart}`,
        (evidence) => fs.writeFileSync(path.join(output, `ios-${scenario}-restart-launch.json`), `${JSON.stringify(evidence, null, 2)}\n`)));
      const restored = await stage('report-restart', () => waitPhaseReport(
        () => read('restart'),
        'restart',
        scenario,
        () => read('startup')
      ));
      if (httpCompanion) {
        const { post, ...evidence } = await httpCompanion.verify(httpRead, restored.sessionId);
        fs.writeFileSync(path.join(output, `ios-${scenario}-restart-http.json`), `${JSON.stringify(evidence, null, 2)}\n`);
        fs.writeFileSync(path.join(output, `ios-${scenario}-restart-post.json`), `${JSON.stringify(post, null, 2)}\n`);
      }
      if (
        created.sessionId === restored.sessionId ||
        created.address !== restored.address ||
        created.fingerprint !== restored.fingerprint ||
        !matchesHdRestartEvidence(created, restored) ||
        !matchesErc20RestartEvidence(created, restored) ||
        !matchesNevmRestartEvidence(created, restored) ||
        !matchesZksysRestartEvidence(created, restored) ||
        !matchesHdKeyRevealRestartEvidence(created, restored) ||
        !matchesImportedRestartEvidence(created, restored) ||
        (fullSlhConfiguration && !matchesFullSlhRestart(created.fullSlh, restored.fullSlh, fullSlhConfiguration))
      )
        throw Error('Cold restart identity or backup fingerprint mismatch');
      run('xcrun', [
        'simctl',
        'io',
        device,
        'screenshot',
        path.join(output, `ios-${scenario}-restart.png`),
      ]);
      reports.push({
        scenario,
        database,
        processRestartVerified: true,
        sessionChanged: true,
        signedTransferRestored: true,
        hdAccountsRestored: true,
        erc20TransferRestored: true,
        nevmTransferRestored: true,
        zksysTransferRestored: true,
        importedAccountRestored: true,
        journalContainerVersion: 1,
      });
    } catch (error) { await captureHttpDiagnostic(); throw error; }
    finally {
      if (container) {
        for (const [stage, suffix] of [['quick-crypto-load', 'load-error'], ['software-sdk-load', 'sdk-load-error']]) {
          try {
            captureFixtureLoadError(fs.readFileSync(path.join(container, 'Documents', `pali-native-qualification-${suffix}.json`), 'utf8'), scenario, stage);
          } catch { /* A missing fixture error file cannot replace the primary failure. */ }
        }
      }
      if (device) {
        run(
          'xcrun',
          [
            'simctl',
            'io',
            device,
            'screenshot',
            path.join(output, `ios-${scenario}-final.png`),
          ],
          true
        );
        run('xcrun', ['simctl', 'shutdown', device], true);
        run('xcrun', ['simctl', 'delete', device], true);
      }
    }
  }
  return {
    platform,
    appExecutableSha256: hash(fs.readFileSync(path.join(artifact, executable))),
    runtime: runtime.identifier,
    reports,
  };
}

async function android() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) throw Error('Android SDK missing');
  const tools = fs
    .readdirSync(path.join(sdk, 'build-tools'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .at(-1);
  const badging = run(path.join(sdk, 'build-tools', tools, 'aapt'), [
    'dump',
    'badging',
    artifact,
  ]);
  if (!badging.startsWith(`package: name='${PACKAGE}'`))
    throw Error('Refusing a production app identifier');
  const apkEntries = run(path.join(sdk, 'build-tools', tools, 'aapt'), [
    'list',
    artifact,
  ]).split('\n');
  const nativeLibraries = apkEntries.filter((file) =>
    /^lib\/.*\.so$/.test(file)
  );
  fs.writeFileSync(
    path.join(output, 'android-apk-startup.json'),
    JSON.stringify(
      {
        packageMatches: true,
        mainActivityMatches: badging.includes(
          `launchable-activity: name='${PACKAGE}.MainActivity'`
        ),
        mainBundlePresent: apkEntries.includes('assets/index.android.bundle'),
      },
      null,
      2
    )
  );
  for (const abi of ['arm64-v8a', 'x86_64']) {
    for (const library of [
      'libQuickCrypto.so',
      'libNitroModules.so',
      'libexpo-sqlite.so',
    ]) {
      if (!nativeLibraries.includes(`lib/${abi}/${library}`))
        throw Error('Required JNI library missing from qualification APK');
    }
  }
  const publicPoolSerial = publicPoolBuild || privateProofBuild
    ? (poolCi || require('./public-pool-ci.cjs')).androidPublicPoolSerial(run) : undefined;
  const deviceRun = publicPoolSerial
    ? (command, args, ...options) => run(command, ['-s', publicPoolSerial, ...args], ...options)
    : run;
  prepareAndroidRoot(deviceRun, (evidence) => fs.writeFileSync(
    path.join(output, 'android-root-readiness.json'), `${JSON.stringify(evidence, null, 2)}\n`), publicPoolSerial);
  if (privateProofBuild) {
    deviceRun('adb', ['uninstall', PACKAGE], true);
    try {
      deviceRun('adb', ['install', artifact]);
      const privateProof = await proofCi.runPrivateProofQualification({
        platform, config: privateProofBuild, output,
        launch: (uri) => deviceRun('adb', ['shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', `'${uri}'`,
          '-n', `${PACKAGE}/.MainActivity`]),
        list: () => deviceRun('adb', ['shell',
          `if [ ! -e '/data/user/0/${PACKAGE}/files' ]; then exit 0; fi; [ -d '/data/user/0/${PACKAGE}/files' ] && [ ! -L '/data/user/0/${PACKAGE}/files' ] && ls -1 '/data/user/0/${PACKAGE}/files'`,
        ]).split(/\r?\n/).filter(Boolean),
        read: (name) => readAndroidHttpSidecar(deviceRun, name),
        readFailure: (phase) => {
          const file = `/data/user/0/${PACKAGE}/files/${proofFailureName(phase)}`;
          const command = `[ -f '${file}' ] && [ ! -L '${file}' ] && [ "$(stat -c %s '${file}')" -le 100000 ] && head -c 100001 '${file}'`;
          const text = deviceRun('adb', ['shell', command], false, 5000);
          if (typeof text !== 'string' || Buffer.byteLength(text) > 100000) throw Error('PRIVATE_PROOF_FAILURE_INVALID');
          return text;
        },
      });
      return { platform, apkSha256: hash(fs.readFileSync(artifact)), nativeLibraries, privateProof,
        osVersion: deviceRun('adb', ['shell', 'getprop', 'ro.build.version.release']) };
    } finally {
      deviceRun('adb', ['shell', 'am', 'force-stop', PACKAGE], true);
      deviceRun('adb', ['uninstall', PACKAGE], true);
    }
  }
  if (publicPoolSerial) {
    const exists = (name) => deviceRun('adb', ['shell', 'test', '-f', `/data/user/0/${PACKAGE}/files/${name}`], true, 5000) !== null;
    deviceRun('adb', ['uninstall', PACKAGE], true);
    try {
      deviceRun('adb', ['install', artifact]);
      const publicPool = await poolCi.runHostedPublicPool({
        platform, config: publicPoolBuild, output,
        execute: ({ uri, report, ports, captureFailure }) => poolCi.withPublicPoolAndroidRoutes(run, publicPoolSerial, ports, async () => {
          deviceRun('adb', ['shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', `'${uri}'`,
            '-n', `${PACKAGE}/.MainActivity`]);
          const readPoolFile = (name) => exists(name) ? readAndroidHttpSidecar(deviceRun, name) : undefined;
          return poolCi.waitPublicPoolReport(() => readPoolFile(report),
            () => captureFailure(readPoolFile) || ['create', 'startup'].some((phase) => exists(`pali-native-qualification-${phase}.json`)));
        }),
      });
      return { platform, apkSha256: hash(fs.readFileSync(artifact)), nativeLibraries, publicPool,
        osVersion: deviceRun('adb', ['shell', 'getprop', 'ro.build.version.release']) };
    } finally {
      deviceRun('adb', ['shell', 'am', 'force-stop', PACKAGE], true);
      deviceRun('adb', ['uninstall', PACKAGE], true);
    }
  }
  if (httpEnabled) {
    const { startHttpCompanion } = require('./http-companion.cjs');
    httpCompanion = await startHttpCompanion({ walletConnectIdentity: require('../scripts/qualification-sdk.cjs').readWalletConnectSdkIdentity(path.join(__dirname, '..')), platform, sourceRevision: process.env.GITHUB_SHA, run });
  }
  const reports = [];
  for (const scenario of (fullSlhEnabled ? ['import'] : ['import', 'generate'])) {
    run('adb', ['uninstall', PACKAGE], true); // Dedicated test package only.
    try {
      run('adb', ['install', artifact]);
      httpRead = (name) => readAndroidHttpSidecar(run, name);
      const read = (phase) =>
        run(
          'adb',
          [
            'shell',
            'cat',
            `/data/user/0/${PACKAGE}/files/pali-native-qualification-${phase}.json`,
          ],
          true
        );
      // adb shell constructs a remote command; preserve '&' inside the URI.
      const launch = (link, phase) => {
        const result = run('adb', [
          'shell',
          'am',
          'start',
          '-W',
          '-a',
          'android.intent.action.VIEW',
          '-d',
          `'${link}'`,
          '-n',
          `${PACKAGE}/.MainActivity`,
        ]);
        fs.writeFileSync(
          path.join(output, `android-${scenario}-${phase}-launch.log`),
          redact(result).slice(-4096)
        );
        return result;
      };
      const httpCreate = httpCompanion ? await httpCompanion.begin('create', scenario) : '';
      launch(
        `pali-wallet-qualification://run?phase=create&scenario=${scenario}${httpCreate}`,
        'create'
      );
      const created = await waitPhaseReport(
        () => read('create'),
        'create',
        scenario,
        () => read('startup'),
        androidProcessRunning
      );
      if (httpCompanion) {
        const { post, ...evidence } = await httpCompanion.verify(httpRead, created.sessionId);
        fs.writeFileSync(path.join(output, `android-${scenario}-create-http.json`), `${JSON.stringify(evidence, null, 2)}\n`);
        fs.writeFileSync(path.join(output, `android-${scenario}-create-post.json`), `${JSON.stringify(post, null, 2)}\n`);
      }
      const oldPid = run('adb', ['shell', 'pidof', '-s', PACKAGE]);
      run('adb', ['shell', 'am', 'force-stop', PACKAGE]);
      if (run('adb', ['shell', 'pidof', '-s', PACKAGE], true))
        throw Error('App process did not stop');
      const captured = run.binary(
        'adb',
        [
          'exec-out',
          'cat',
          `/data/user/0/${PACKAGE}/no_backup/PaliWallet/wallet.sqlite`,
        ],
        false,
        64 * 1024 * 1024
      );
      const database = databaseEvidence(captured);
      const httpRestart = httpCompanion ? await httpCompanion.begin('restart', scenario) : '';
      launch(
        `pali-wallet-qualification://run?phase=restart&scenario=${scenario}&address=${created.address}${httpRestart}`,
        'restart'
      );
      const restored = await waitPhaseReport(
        () => read('restart'),
        'restart',
        scenario,
        () => read('startup'),
        androidProcessRunning
      );
      if (httpCompanion) {
        const { post, ...evidence } = await httpCompanion.verify(httpRead, restored.sessionId);
        fs.writeFileSync(path.join(output, `android-${scenario}-restart-http.json`), `${JSON.stringify(evidence, null, 2)}\n`);
        fs.writeFileSync(path.join(output, `android-${scenario}-restart-post.json`), `${JSON.stringify(post, null, 2)}\n`);
      }
      const newPid = run('adb', ['shell', 'pidof', '-s', PACKAGE]);
      if (
        oldPid === newPid ||
        created.sessionId === restored.sessionId ||
        created.address !== restored.address ||
        created.fingerprint !== restored.fingerprint ||
        !matchesHdRestartEvidence(created, restored) ||
        !matchesErc20RestartEvidence(created, restored) ||
        !matchesNevmRestartEvidence(created, restored) ||
        !matchesZksysRestartEvidence(created, restored) ||
        !matchesHdKeyRevealRestartEvidence(created, restored) ||
        !matchesImportedRestartEvidence(created, restored) ||
        (fullSlhConfiguration && !matchesFullSlhRestart(created.fullSlh, restored.fullSlh, fullSlhConfiguration))
      )
        throw Error('Cold restart identity or backup fingerprint mismatch');
      try {
        const screenshot = run.binary(
          'adb',
          ['exec-out', 'screencap', '-p'],
          true
        );
        if (screenshot)
          fs.writeFileSync(
            path.join(output, `android-${scenario}-restart.png`),
            screenshot
          );
      } catch {
        /* Optional screenshot persistence cannot invalidate qualification. */
      }
      reports.push({
        scenario,
        database,
        processRestartVerified: true,
        sessionChanged: true,
        signedTransferRestored: true,
        hdAccountsRestored: true,
        erc20TransferRestored: true,
        nevmTransferRestored: true,
        zksysTransferRestored: true,
        importedAccountRestored: true,
        ...(fullSlhConfiguration ? { fullSlhQualified: true, fullSlhDurabilityQualified: true, slhUsageCount: 3, resourcePeak: 'unmeasured' } : {}),
        journalContainerVersion: 1,
      });
    } catch (error) { await captureHttpDiagnostic(); throw error; }
    finally {
      try {
        for (const [stage, suffix] of [['quick-crypto-load', 'load-error'], ['software-sdk-load', 'sdk-load-error']]) {
          captureFixtureLoadError(run('adb', ['shell', 'cat', `/data/user/0/${PACKAGE}/files/pali-native-qualification-${suffix}.json`], true), scenario, stage);
        }
        const processId = run('adb', ['shell', 'pidof', '-s', PACKAGE], true);
        const logs = run(
          'adb',
          [
            'logcat',
            '-b',
            'main',
            '-b',
            'system',
            '-b',
            'crash',
            '-d',
            '-t',
            '300',
            '-v',
            'brief',
            '*:E',
          ],
          true
        );
        const exitInfo = run(
          'adb',
          ['shell', 'dumpsys', 'activity', 'exit-info', PACKAGE],
          true
        );
        const exitPid = latestAndroidExitPid(exitInfo);
        const crashBytes = run.binary(
          'adb',
          [
            'logcat',
            '-b',
            'crash',
            '-d',
            '-v',
            'brief',
            ...(exitPid ? ['--pid', String(exitPid)] : []),
          ],
          true,
          1024 * 1024
        );
        const crashLog = crashBytes?.toString('utf8');
        const processBytes = exitPid
          ? run.binary(
              'adb',
              [
                'logcat',
                '-b',
                'main',
                '-b',
                'system',
                '-b',
                'crash',
                '-d',
                '-v',
                'brief',
                '--pid',
                String(exitPid),
                '*:E',
              ],
              true,
              1024 * 1024
            )
          : null;
        const processLog = processBytes?.toString('utf8');
        const exitSummary = summarizeAndroidExitInfo(exitInfo);
        // Isolated CI fixtures only: preserve bounded, redacted fatal evidence
        // separately from the fixed public diagnostic schema.
        if (scenario === 'import' && crashLog)
          fs.writeFileSync(
            path.join(output, `android-${scenario}-fixture-crash.log`),
            redact(crashLog).slice(0, 128 * 1024)
          );
        if (scenario === 'import' && processLog)
          fs.writeFileSync(
            path.join(output, `android-${scenario}-fixture-process.log`),
            redact(processLog).slice(0, 128 * 1024)
          );
        if (scenario === 'import' && exitInfo)
          fs.writeFileSync(
            path.join(output, `android-${scenario}-fixture-exit-info.log`),
            redact(exitInfo).slice(0, 32 * 1024)
          );
        if (
          scenario === 'import' &&
          exitPid &&
          exitSummary.exitReasons[0] === 'CRASH_NATIVE'
        ) {
          const inventory =
            run('adb', ['shell', 'ls', '-t', '/data/tombstones'], true) || '';
          for (const file of inventory
            .split(/\s+/)
            .filter((name) => /^tombstone_[0-9]+$/.test(name))
            .slice(0, 4)) {
            const tombstone = run
              .binary(
                'adb',
                [
                  'exec-out',
                  'head',
                  '-c',
                  '131072',
                  `/data/tombstones/${file}`,
                ],
                true,
                131072
              )
              ?.toString('utf8');
            if (
              tombstone &&
              new RegExp(`\\bpid: ${exitPid}\\b`).test(tombstone)
            ) {
              fs.writeFileSync(
                path.join(output, `android-${scenario}-fixture-tombstone.log`),
                redact(tombstone)
              );
              break;
            }
          }
        }
        fs.writeFileSync(
          path.join(output, `android-${scenario}-runtime-diagnostics.json`),
          JSON.stringify(
            {
              processRunning: Boolean(processId),
              logcatAvailable: logs !== null,
              exitInfoAvailable: exitInfo !== null,
              crashLogAvailable: crashBytes !== null,
              processLogAvailable: processBytes !== null,
              crashLogScoped: Boolean(exitPid),
              ...summarizeAndroidLog(
                `${logs || ''}\n${crashLog || ''}\n${processLog || ''}`
              ),
              ...exitSummary,
            },
            null,
            2
          )
        );
      } catch {
        /* Diagnostic collection cannot replace the primary failure. */
      }
      try {
        const screenshot = run.binary(
          'adb',
          ['exec-out', 'screencap', '-p'],
          true
        );
        if (screenshot)
          fs.writeFileSync(
            path.join(output, `android-${scenario}-final.png`),
            screenshot
          );
      } catch {
        /* Preserve the primary failure if cleanup screenshot/write fails. */
      }
      run('adb', ['shell', 'am', 'force-stop', PACKAGE], true);
      run('adb', ['uninstall', PACKAGE], true);
    }
  }
  return {
    platform,
    apkSha256: hash(fs.readFileSync(artifact)),
    nativeLibraries,
    osVersion: run('adb', ['shell', 'getprop', 'ro.build.version.release']),
    reports,
  };
}

(async () => {
  let report;
  let primaryFailure;
  try {
    report = await (platform === 'ios' ? ios() : android());
    if (httpEnabled) {
      httpCompanion.assertComplete(simulatorContract ? 1 : 4);
      report.nativeHttpQualified = true;
      report.nativePostQualified = true;
    }
  } catch (error) { primaryFailure = error; throw error; }
  finally {
    if (primaryFailure) {
      await captureHttpDiagnostic();
      await httpCompanion?.close().catch(() => undefined);
    }
    else await httpCompanion?.close();
  }
  if (privateProofBuild) {
    fs.writeFileSync(path.join(output, `${platform}-private-proof.json`), `${JSON.stringify({
      version: 1, status: 'passed', mode: 'private-proof', qualification: 'limited', custodyQualified: false,
      sourceRevision: process.env.GITHUB_SHA, runnerImage: process.env.ImageVersion || null, ...report,
    }, null, 2)}\n`, { flag: 'wx' });
    console.log(`${platform}: Native fixed-vector proof and cancellation scenario passed`);
    return;
  }
  if (publicPoolBuild) {
    fs.writeFileSync(path.join(output, `${platform}-public-pool.json`), `${JSON.stringify({
      version: 1, status: 'passed', sourceRevision: process.env.GITHUB_SHA,
      runnerImage: process.env.ImageVersion || null, ...report,
    }, null, 2)}\n`, { flag: 'wx' });
    console.log(`${platform}: Offline public pool verification passed`);
    return;
  }
  fs.writeFileSync(
    path.join(output, simulatorContract ? 'ios-simulator-limited.json' : `${platform}-qualification.json`),
    `${JSON.stringify(
      {
        ...(simulatorContract ? { version: 1, status: 'limited', custodyQualified: false, mode,
          reason: 'simulator-data-protection-unavailable' } : { status: 'passed' }),
        sourceRevision: process.env.GITHUB_SHA || null,
        runnerImage: process.env.ImageVersion || null,
        ...report,
      },
      null,
      2
    )}\n`
  );
  console.log(
    simulatorContract ? 'ios: Simulator crypto and expected storage refusal verified; custody is not qualified' :
      `${platform}: native import/create and two-process restart qualification passed`
  );
})().catch((error) => {
  // Written after best-effort device cleanup; the caught primary error retains
  // the original command/timeout even if screenshot/shutdown/delete also fail.
  const failure = describeQualificationFailure(error, redact);
  try {
    fs.writeFileSync(
      path.join(output, `${platform}-failure.json`),
      `${JSON.stringify(
        {
          version: 1,
          status: 'failed',
          platform,
          sourceRevision: process.env.GITHUB_SHA || null,
          runnerImage: process.env.ImageVersion || null,
          failure,
        },
        null,
        2
      )}\n`
    );
  } catch {
    /* Preserve the primary failure even if artifact writing fails. */
  }
  console.error('Native qualification failed:', JSON.stringify(failure));
  process.exitCode = 1;
});
