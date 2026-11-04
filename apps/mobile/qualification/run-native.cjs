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
const { isStorageQualificationDiagnostic } = require('./storage-diagnostics.ts');
const { isHdQualificationReport, matchesHdRestartEvidence } = require('./hd-accounts.ts');
const { isErc20QualificationReport, matchesErc20RestartEvidence } = require('./erc20-transfer.ts');
const { createCommandRunner, describeQualificationFailure, COLD_BOOT_TIMEOUT_MS } = require('./command-runner.cjs');
const { qualificationMode, assertSimulatorRefusal, assertSimulatorTarget } = require('./simulator-contract.cjs');

if (process.env.CI !== 'true' || process.env.PALI_NATIVE_QUALIFICATION !== '1')
  throw Error('Run only against isolated qualification devices');
const platform = process.argv[2];
const mode = qualificationMode(platform, process.argv.slice(4));
const simulatorContract = mode === 'ios-simulator-contract';
const artifact = path.resolve(process.argv[3] || '');
const output = path.resolve(
  process.env.QUALIFICATION_ARTIFACTS ||
    '/private/tmp/pali-native-qualification'
);
const PACKAGE = 'com.paliwallet.qualification';
const PUBLIC_PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PUBLIC_PASSWORD = 'PUBLIC native qualification password 2026';
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
const androidProcessRunning = () =>
  Boolean(
    run('adb', [
      'shell',
      `pidof -s ${PACKAGE}; pali_pidof_status=$?; if [ "$pali_pidof_status" -eq 1 ]; then exit 0; fi; exit "$pali_pidof_status"`,
    ])
  );
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const validateReport = (text, phase, scenario) => {
  if (
    !text ||
    text.length > 100000 ||
    text.includes(PUBLIC_PHRASE) ||
    text.includes(PUBLIC_PASSWORD)
  )
    throw Error('Invalid qualification report');
  const report = JSON.parse(text);
  const allowed = new Set([
    'version',
    'status',
    'phase',
    'scenario',
    'platform',
    'osVersion',
    'sessionId',
    'address',
    'fingerprint',
    'checks',
    'networkCalls',
    'nativeBridgeExercised',
    'sdkVersion',
    'nativeSigningVerified',
    'transferHash',
    'pendingProcessTermination',
    'failedStage',
    'cryptoEvidence',
    'cryptoDiagnostic',
    'mnemonicEntropyVerified',
    'storageDiagnostic',
    'nativeHdAccountsVerified',
    'selectedAccountId',
    'selectedAccountIndex',
    'firstTransferHash',
    'journalContainerVersion',
    'nativeErc20Verified',
    'erc20AccountId',
    'erc20AccountIndex',
    'erc20Address',
    'erc20TransferHash',
    'erc20IntentHash',
    'erc20Signatures',
    'erc20Authorizations',
    'erc20InjectedBroadcasts',
    'erc20RestoredFromJournal',
  ]);
  if (
    Object.keys(report).some((key) => !allowed.has(key)) ||
    !isHdQualificationReport(report) ||
    !isErc20QualificationReport(report) ||
    (report.cryptoDiagnostic !== undefined && !isCryptoDiagnostic(report.cryptoDiagnostic)) ||
    !isStorageQualificationDiagnostic(report.storageDiagnostic, report.status, report.failedStage) ||
    report.phase !== phase ||
    report.scenario !== scenario ||
    report.platform !== platform ||
    report.version !== 1
  )
    throw Error('Unexpected qualification report schema');
  if (simulatorContract) assertSimulatorRefusal(report);
  fs.writeFileSync(
    path.join(output, `${platform}-${scenario}-${phase}.json`),
    simulatorContract ? text : `${JSON.stringify(report, null, 2)}\n`
  );
  if (simulatorContract) return report;
  if (
    report.status !== 'passed' ||
    report.networkCalls !== 0 ||
    report.nativeBridgeExercised !== true ||
    report.nativeSigningVerified !== true ||
    report.sdkVersion !== '2.0.0' ||
    !/^0x[0-9a-f]{64}$/.test(report.transferHash || '') ||
    report.mnemonicEntropyVerified !==
      (phase === 'create' && scenario === 'generate') ||
    !/^[0-9a-f]{64}$/.test(report.fingerprint || '') ||
    report.cryptoEvidence?.passed !== true ||
    report.cryptoEvidence?.productionIterations !== 900000
  )
    throw Error(
      `Native qualification failed at ${report.failedStage || phase} (${JSON.stringify(report.cryptoDiagnostic || {})}; storage ${JSON.stringify(report.storageDiagnostic)})`
    );
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
  const runtime = runtimes
    .filter(
      (item) =>
        item.isAvailable &&
        item.identifier === 'com.apple.CoreSimulator.SimRuntime.iOS-26-5'
    )
    .sort((a, b) =>
      a.version.localeCompare(b.version, undefined, { numeric: true })
    )
    .at(-1);
  const types = JSON.parse(
    run('xcrun', ['simctl', 'list', 'devicetypes', '-j'])
  ).devicetypes;
  const type = types.find((item) => item.identifier.endsWith('.iPhone-17'));
  if (!runtime || !type) throw Error('No installed iOS simulator runtime');
  if (simulatorContract) {
    assertSimulatorTarget(run('plutil', ['-extract', 'DTPlatformName', 'raw', '-o', '-', info]), runtime.identifier);
    if (!/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA || '')) throw Error('Simulator contract requires source revision');
  }
  const reports = [];
  for (const scenario of (simulatorContract ? ['import'] : ['import', 'generate'])) {
    const device = run('xcrun', [
      'simctl',
      'create',
      `PaliQualification-${scenario}-${Date.now()}`,
      type.identifier,
      runtime.identifier,
    ]);
    let container;
    try {
      run('xcrun', ['simctl', 'boot', device]);
      run(
        'xcrun',
        ['simctl', 'bootstatus', device, '-b'],
        false,
        COLD_BOOT_TIMEOUT_MS
      );
      run('xcrun', ['simctl', 'install', device, artifact]);
      container = run('xcrun', [
        'simctl',
        'get_app_container',
        device,
        PACKAGE,
        'data',
      ]);
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
      run('xcrun', [
        'simctl',
        'launch',
        device,
        PACKAGE,
        '-PaliQualificationURL',
        `pali-wallet-qualification://run?phase=create&scenario=${scenario}`,
      ]);
      const created = await waitReport(
        () => read('create'),
        'create',
        scenario,
        () => read('startup')
      );
      if (simulatorContract) {
        // The original report remains failed. No database read, restart or
        // full-custody aggregate follows this expected protection refusal.
        return {
          platform,
          appExecutableSha256: hash(fs.readFileSync(path.join(artifact, executable))),
          runtime: runtime.identifier,
          nativeCryptoVerified: true,
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
      run('xcrun', ['simctl', 'terminate', device, PACKAGE]);
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
      run('xcrun', [
        'simctl',
        'launch',
        device,
        PACKAGE,
        '-PaliQualificationURL',
        `pali-wallet-qualification://run?phase=restart&scenario=${scenario}&address=${created.address}`,
      ]);
      const restored = await waitReport(
        () => read('restart'),
        'restart',
        scenario,
        () => read('startup')
      );
      if (
        created.sessionId === restored.sessionId ||
        created.address !== restored.address ||
        created.fingerprint !== restored.fingerprint ||
        !matchesHdRestartEvidence(created, restored) ||
        !matchesErc20RestartEvidence(created, restored)
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
        journalContainerVersion: 2,
      });
    } finally {
      if (container) {
        for (const [stage, suffix] of [['quick-crypto-load', 'load-error'], ['software-sdk-load', 'sdk-load-error']]) {
          try {
            captureFixtureLoadError(fs.readFileSync(path.join(container, 'Documents', `pali-native-qualification-${suffix}.json`), 'utf8'), scenario, stage);
          } catch { /* A missing fixture error file cannot replace the primary failure. */ }
        }
      }
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
  run('adb', ['root']);
  run('adb', ['wait-for-device']);
  const reports = [];
  for (const scenario of ['import', 'generate']) {
    run('adb', ['uninstall', PACKAGE], true); // Dedicated test package only.
    try {
      run('adb', ['install', artifact]);
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
      launch(
        `pali-wallet-qualification://run?phase=create&scenario=${scenario}`,
        'create'
      );
      const created = await waitReport(
        () => read('create'),
        'create',
        scenario,
        () => read('startup'),
        androidProcessRunning
      );
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
      launch(
        `pali-wallet-qualification://run?phase=restart&scenario=${scenario}&address=${created.address}`,
        'restart'
      );
      const restored = await waitReport(
        () => read('restart'),
        'restart',
        scenario,
        () => read('startup'),
        androidProcessRunning
      );
      const newPid = run('adb', ['shell', 'pidof', '-s', PACKAGE]);
      if (
        oldPid === newPid ||
        created.sessionId === restored.sessionId ||
        created.address !== restored.address ||
        created.fingerprint !== restored.fingerprint ||
        !matchesHdRestartEvidence(created, restored) ||
        !matchesErc20RestartEvidence(created, restored)
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
        journalContainerVersion: 2,
      });
    } finally {
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
  const report = await (platform === 'ios' ? ios() : android());
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
