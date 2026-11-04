const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Buffer } = require('node:buffer');
const {
  parseOptions,
  deviceSelection,
  runPhysical,
} = require('./run-physical-ios.cjs');
const { PHYSICAL_BUNDLES } = require('./physical-contract.ts');
const { TIMED_CRYPTO_CASES, CHECKS } = require('./simulator-contract.cjs');
const {
  decodePhysicalReport,
  assertPhysicalRestart,
} = require('./report-validation.cjs');
const SOURCE = 'a'.repeat(40);
const DEVICE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const TEAM = 'TESTTEAM01';
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
function physicalDevice() {
  return {
    identifier: DEVICE,
    hardwareProperties: {
      reality: 'physical',
      platform: 'iOS',
      deviceType: 'iPhone',
    },
    connectionProperties: { pairingState: 'paired', tunnelState: 'connected' },
    deviceProperties: {
      bootState: 'booted',
      ddiServicesAvailable: true,
      osVersionNumber: '27.2',
    },
  };
}
function report(phase, scenario, runId) {
  return {
    version: 1,
    status: 'passed',
    phase,
    scenario,
    platform: 'ios',
    osVersion: '27.2',
    sessionId:
      phase === 'create'
        ? '11111111-1111-1111-1111-111111111111'
        : '22222222-2222-2222-2222-222222222222',
    address:
      scenario === 'import'
        ? '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0'
        : '0x' + '11'.repeat(20),
    fingerprint: 'f'.repeat(64),
    networkCalls: 0,
    nativeBridgeExercised: true,
    sdkVersion: '2.0.0',
    nativeSigningVerified: true,
    nativeHdAccountsVerified: true,
    selectedAccountId: 'hd:60:1',
    selectedAccountIndex: 1,
    journalContainerVersion: 2,
    transferHash: '0x' + 'a'.repeat(64),
    firstTransferHash: '0x' + 'b'.repeat(64),
    mnemonicEntropyVerified: scenario === 'generate' && phase === 'create',
    cryptoEvidence: {
      passed: true,
      productionIterations: 900000,
      cases: TIMED_CRYPTO_CASES.map((name) => ({ name, milliseconds: 1 })),
    },
    checks: [
      ...CHECKS,
      'synchronous lock and wrong password refusal',
      phase === 'create'
        ? 'fresh password-backed seed confirmation'
        : 'seed reauthentication after cold restart',
    ].map((name) => ({ name, durationMs: 1 })),
    storageDiagnostic: { stage: 'ready' },
    nativeErc20Verified: true,
    erc20AccountId: 'hd:60:2',
    erc20AccountIndex: 2,
    erc20Address:
      scenario === 'import'
        ? '0xb6716976A3ebe8D39aCEB04372f22Ff8e6802D7A'
        : '0x' + '22'.repeat(20),
    erc20TransferHash: '0x' + 'c'.repeat(64),
    erc20IntentHash: '0x' + 'd'.repeat(64),
    erc20Signatures: phase === 'create' ? 1 : 0,
    erc20Authorizations: phase === 'create' ? 0 : 1,
    erc20InjectedBroadcasts: 1,
    erc20RestoredFromJournal: phase === 'restart',
    nativeNevmVerified: true,
    nevmAccountId: 'hd:60:3',
    nevmAccountIndex: 3,
    nevmAddress: scenario === 'import'
      ? '0xF3f50213C1d2e255e4B2bAD430F8A38EEF8D718E'
      : '0x' + '33'.repeat(20),
    nevmTransferHash: '0x' + '7'.repeat(64),
    nevmEthereumTransferHash: '0x' + '8'.repeat(64),
    nevmChainId: '5700',
    nevmJournalContainerVersion: 2,
    nevmRestoredFromJournal: phase === 'restart',
    physicalRunId: runId,
    physicalBundleIdentifier: PHYSICAL_BUNDLES[scenario],
    physicalSourceRevision: SOURCE,
  };
}

function fixture(changes = {}) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pali-physical-host-')
  );
  const lockHash = hash(
    fs.readFileSync(
      path.join(
        path.dirname(require.resolve('./physical-host.test.cjs')),
        '../package-lock.json'
      )
    )
  );
  const infos = {};
  const calls = [];
  const running = new Map();
  const reports = new Map();
  const installed = new Set(
    changes.installed ? Object.values(PHYSICAL_BUNDLES) : []
  );
  const options = {
    device: DEVICE,
    sourceRevision: SOURCE,
    output: path.join(directory, 'evidence'),
    reset: !!changes.reset,
    apps: {},
    cdhashes: { import: '1'.repeat(40), generate: '2'.repeat(40) },
  };
  for (const scenario of ['import', 'generate']) {
    const app = path.join(directory, scenario + '.app');
    fs.mkdirSync(app);
    options.apps[scenario] = app;
    const executable =
      scenario === 'import' ? 'PaliPhysicalImport' : 'PaliPhysicalGenerate';
    infos[app] = {
      CFBundleIdentifier: PHYSICAL_BUNDLES[scenario],
      CFBundleExecutable: executable,
      DTPlatformName: 'iphoneos',
      PaliQualificationMode: 'physical',
      PaliQualificationScenario: scenario,
      PaliQualificationSourceRevision: SOURCE,
      PaliQualificationLockfileSHA256: lockHash,
      ...changes.info,
    };
    fs.writeFileSync(path.join(app, 'Info.plist'), JSON.stringify(infos[app]));
    fs.writeFileSync(path.join(app, executable), 'public executable');
    fs.writeFileSync(path.join(app, 'main.jsbundle'), 'public bundle');
    fs.writeFileSync(path.join(app, 'resource.txt'), 'public resource');
  }
  let pid = 100;
  let time = 0;
  let sequence = 0;
  if (changes.existingProcess)
    running.set(
      90,
      'file:///private/var/containers/Bundle/Application/public/PaliPhysicalImport'
    );
  const ok = (stdout = '', stderr = '') => ({ status: 0, stdout, stderr });
  const json = (value) =>
    ok(JSON.stringify({ info: { outcome: 'success' }, result: value }));
  const appInfo = (app) =>
    infos[app] ||
    JSON.parse(fs.readFileSync(path.join(app, 'Info.plist'), 'utf8'));
  const spawn = (command, args, config) => {
    calls.push({ command, args });
    if (command === 'xcodebuild') {
      assert.deepEqual(args, ['-version']);
      return changes.xcodeResult || ok('Xcode 27.2\nBuild version 18C54\n');
    }
    if (command === 'git')
      return ok(
        args.includes('rev-parse')
          ? changes.source || SOURCE
          : changes.dirty
          ? ' M source.ts'
          : ''
      );
    if (command === 'plutil') {
      if (args.at(-1) === '-') return ok(config.input);
      return ok(JSON.stringify(appInfo(path.dirname(args.at(-1)))));
    }
    if (command === 'lipo') return ok(changes.arch || 'arm64');
    if (command === 'codesign') {
      if (args.includes('--verify'))
        return changes.signature
          ? { status: 1, stderr: 'private error' }
          : ok();
      const app = args.at(-1);
      const info = appInfo(app);
      const scenario = info.PaliQualificationScenario;
      return ok(
        JSON.stringify({
          'application-identifier': `${TEAM}.${PHYSICAL_BUNDLES[scenario]}`,
          'com.apple.developer.team-identifier': TEAM,
          'get-task-allow': true,
          ...changes.entitlements,
        }),
        `Identifier=${info.CFBundleIdentifier}\nCDHash=${
          changes.cdhash || options.cdhashes[scenario]
        }\nTeamIdentifier=${TEAM}\n${changes.adhoc ? 'flags=0x2(adhoc)' : ''}`
      );
    }
    assert.equal(command, 'xcrun');
    assert.equal(args[0], 'devicectl');
    const a = args.slice(5);
    const arg = (name) => a[a.indexOf(name) + 1];
    if (a.join(' ') === 'list devices')
      return json({ devices: [{ ...physicalDevice(), ...changes.device }] });
    if (a.includes('info') && a.includes('apps'))
      return json({
        apps: installed.has(arg('--bundle-id'))
          ? [{ bundleIdentifier: arg('--bundle-id') }]
          : [],
      });
    if (a.includes('install')) {
      installed.add(appInfo(a.at(-1)).CFBundleIdentifier);
      return json({});
    }
    if (a.includes('uninstall')) {
      installed.delete(a.at(-1));
      return json({});
    }
    if (a.includes('launch')) {
      const url = new URL(a.at(-1));
      const phase = url.searchParams.get('phase');
      const scenario = url.searchParams.get('scenario');
      const runId = url.searchParams.get('runId');
      const bundle = PHYSICAL_BUNDLES[scenario];
      const executable = `file:///private/var/containers/Bundle/Application/public/${
        infos[options.apps[scenario]].CFBundleExecutable
      }`;
      const next = ++pid;
      running.set(next, executable);
      const value =
        phase === 'reset'
          ? {
              version: 1,
              status: 'reset',
              keyDeleted: true,
              physicalRunId: runId,
              physicalBundleIdentifier: bundle,
              physicalSourceRevision: SOURCE,
            }
          : report(phase, scenario, runId);
      if (changes.report) changes.report(value, phase, scenario);
      reports.set(
        `${bundle}:Documents/pali-native-qualification-${phase}-${runId}.json`,
        value
      );
      return json({ processIdentifier: next, executable });
    }
    if (a.includes('processes'))
      return json({
        runningProcesses: [...running].map(
          ([processIdentifier, executable]) => ({
            processIdentifier,
            executable: changes.pidReuse
              ? 'file:///different/owner'
              : executable,
          })
        ),
      });
    if (a.includes('terminate')) {
      running.delete(Number(arg('--pid')));
      return json({});
    }
    if (a.includes('copy')) {
      const source = arg('--source');
      const destination = arg('--destination');
      if (source.endsWith('wallet.sqlite')) {
        fs.writeFileSync(
          destination,
          Buffer.alloc(4096, changes.plaintext ? 0 : 0xa5)
        );
        return json({});
      }
      const value = reports.get(`${arg('--domain-identifier')}:${source}`);
      if (!value || changes.noReport)
        return { status: 1, stderr: 'private missing file' };
      fs.writeFileSync(destination, JSON.stringify(value));
      return json({});
    }
    throw Error('Unexpected command');
  };
  return {
    options,
    calls,
    infos,
    spawn,
    dependencies: {
      spawnSync: spawn,
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
      randomBytes: (length) => Buffer.alloc(length, ++sequence),
    },
    cleanup: () => fs.rmSync(directory, { recursive: true, force: true }),
  };
}
async function run(f) {
  const prior = {
    CI: process.env.CI,
    PALI_NATIVE_QUALIFICATION: process.env.PALI_NATIVE_QUALIFICATION,
  };
  process.env.CI = 'true';
  process.env.PALI_NATIVE_QUALIFICATION = '1';
  try {
    return await runPhysical(f.options, f.dependencies);
  } finally {
    for (const [key, value] of Object.entries(prior))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
}
const mutations = (calls) =>
  calls.filter(
    (call) =>
      call.command === 'xcrun' &&
      call.args.some((arg) =>
        ['install', 'uninstall', 'launch', 'terminate'].includes(arg)
      )
  );

test('CLI accepts only exact bounded physical inputs, with explicit reset', () => {
  const args = [
    '--device',
    DEVICE,
    '--source-revision',
    SOURCE,
    '--import-app',
    '/a.app',
    '--generate-app',
    '/b.app',
    '--import-cdhash',
    '1'.repeat(40),
    '--generate-cdhash',
    '2'.repeat(40),
    '--output',
    '/out',
  ];
  assert.equal(parseOptions(args).reset, false);
  assert.equal(parseOptions([...args, '--reset-fixtures']).reset, true);
  for (const value of [
    args.slice(2),
    [...args, '--unknown'],
    [...args, '--device', DEVICE],
    [...args, '--reset-fixtures', '--reset-fixtures'],
    args.map((v) => (v === DEVICE ? '--production' : v)),
    args.map((v) => (v === SOURCE ? 'main' : v)),
  ])
    assert.throws(() => parseOptions(value));
});
test('invalid CLI arguments are contained without echoing them or contacting a device', () => {
  const result = spawnSync(
    process.execPath,
    [require.resolve('./run-physical-ios.cjs'), '--private-argument-example'],
    { encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } }
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'INVALID_ARGUMENTS\n');
  assert(!result.stderr.includes('private-argument-example'));
});
test('physical runner accepts selected Xcode 27 or newer before artifact preparation', async () => {
  for (const version of ['27', '27.0', '27.2', '28.1.2']) {
    const f = fixture({
      xcodeResult: {
        status: 0,
        stdout: `Xcode ${version}\r\nBuild version 18C54\r\n`,
      },
    });
    try {
      assert.equal((await run(f)).fixtureCustodyQualified, true);
      assert.deepEqual(f.calls[0], {
        command: 'xcodebuild',
        args: ['-version'],
      });
    } finally {
      f.cleanup();
    }
  }
});
test('physical runner rejects Xcode 26 before inspecting artifacts or contacting a device', async () => {
  const f = fixture({
    reset: true,
    xcodeResult: { status: 0, stdout: 'Xcode 26.6\nBuild version 17F42\n' },
  });
  try {
    for (const app of Object.values(f.options.apps))
      fs.rmSync(app, { recursive: true });
    await assert.rejects(run(f), { code: 'XCODE_27_REQUIRED' });
    assert.deepEqual(f.calls, [{ command: 'xcodebuild', args: ['-version'] }]);
    assert.equal(fs.existsSync(f.options.output), false);
  } finally {
    f.cleanup();
  }
});
test('physical runner rejects missing or malformed selected Xcode versions before any work', async () => {
  for (const xcodeResult of [
    { status: 0 },
    { status: 0, stdout: '' },
    { status: 0, stdout: 'Xcode 27.2\n' },
    { status: 0, stdout: 'Xcode 027.2\nBuild version 18C54\n' },
    { status: 0, stdout: 'Xcode 27.2.0.1\nBuild version 18C54\n' },
    { status: 0, stdout: 'Xcode 27.2\nBuild version ../private\n' },
    { status: 0, stdout: 'Xcode 27.2\nBuild version 18C54\nextra' },
    { status: 0, stdout: 'x'.repeat(1024) },
    { status: 127, stderr: 'private command details' },
    { status: null, error: { code: 'ENOENT' } },
  ]) {
    const f = fixture({ xcodeResult });
    try {
      for (const app of Object.values(f.options.apps))
        fs.rmSync(app, { recursive: true });
      await assert.rejects(run(f), { code: 'XCODE_27_REQUIRED' });
      assert.deepEqual(f.calls, [
        { command: 'xcodebuild', args: ['-version'] },
      ]);
      assert.equal(fs.existsSync(f.options.output), false);
    } finally {
      f.cleanup();
    }
  }
});
test('physical runner CLI gives fixed Xcode selection guidance without raw diagnostics', () => {
  const f = fixture();
  try {
    const preload = path.join(
      path.dirname(f.options.output),
      'xcode-preload.cjs'
    );
    fs.writeFileSync(
      preload,
      `require('node:child_process').spawnSync = (command, args) => {
      if (command !== 'xcodebuild' || args.join() !== '-version') throw Error('Unexpected command');
      return { status: 0, stdout: 'Xcode 26.6\\nBuild version 17F42\\n', stderr: 'private diagnostics' };
    };\n`
    );
    const result = spawnSync(
      process.execPath,
      [
        '--require',
        preload,
        require.resolve('./run-physical-ios.cjs'),
        '--device',
        DEVICE,
        '--source-revision',
        SOURCE,
        '--import-app',
        f.options.apps.import,
        '--generate-app',
        f.options.apps.generate,
        '--import-cdhash',
        f.options.cdhashes.import,
        '--generate-cdhash',
        f.options.cdhashes.generate,
        '--output',
        f.options.output,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_NO_WARNINGS: '1',
          CI: 'true',
          PALI_NATIVE_QUALIFICATION: '1',
        },
      }
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(
      result.stderr,
      'XCODE_27_REQUIRED: Physical iOS qualification requires Xcode 27 or newer. Select it with xcode-select or DEVELOPER_DIR, then retry.\n'
    );
    assert.equal(fs.existsSync(f.options.output), false);
  } finally {
    f.cleanup();
  }
});
test('device gate refuses simulators, unpaired, disconnected and ambiguous identities', () => {
  assert.equal(
    deviceSelection({ devices: [physicalDevice()] }, DEVICE).osVersion,
    '27.2'
  );
  for (const value of [
    {
      ...physicalDevice(),
      hardwareProperties: {
        ...physicalDevice().hardwareProperties,
        reality: 'simulated',
      },
    },
    {
      ...physicalDevice(),
      connectionProperties: {
        ...physicalDevice().connectionProperties,
        pairingState: 'unpaired',
      },
    },
    {
      ...physicalDevice(),
      deviceProperties: {
        ...physicalDevice().deviceProperties,
        ddiServicesAvailable: false,
      },
    },
  ])
    assert.throws(() => deviceSelection({ devices: [value] }, DEVICE));
  assert.throws(() =>
    deviceSelection({ devices: [physicalDevice(), physicalDevice()] }, DEVICE)
  );
});
test('fresh physical fixture run owns exact PIDs and preserves both cold restart reports', async () => {
  const f = fixture();
  try {
    const value = await run(f);
    assert.equal(value.fixtureCustodyQualified, true);
    assert.equal(value.uiQualified, false);
    assert.equal(value.summaries.length, 2);
    assert.equal(value.summaries[0].database.bytes, 4096);
    assert.equal(f.calls.filter((c) => c.args.includes('launch')).length, 4);
    assert.equal(f.calls.filter((c) => c.args.includes('terminate')).length, 4);
    assert.equal(f.calls.filter((c) => c.args.includes('uninstall')).length, 0);
    assert(!JSON.stringify(value).includes(DEVICE));
  } finally {
    f.cleanup();
  }
});
test('device operations install private verified snapshots despite concurrent source rebuilds', async () => {
  const f = fixture({ reset: true });
  const original = f.dependencies.spawnSync;
  const installs = [];
  let changed = false;
  f.dependencies.spawnSync = (command, args, options) => {
    if (command === 'xcrun' && !changed) {
      changed = true;
      for (const app of Object.values(f.options.apps)) {
        fs.writeFileSync(path.join(app, 'main.jsbundle'), 'concurrent rebuild');
        fs.writeFileSync(
          path.join(app, f.infos[app].CFBundleExecutable),
          'different executable'
        );
      }
    }
    if (command === 'xcrun' && args.includes('install')) {
      const app = args.at(-1);
      installs.push({
        app,
        bundle: fs.readFileSync(path.join(app, 'main.jsbundle'), 'utf8'),
      });
    }
    return original(command, args, options);
  };
  try {
    const result = await run(f);
    assert.equal(installs.length, 4);
    for (const installed of installs) {
      assert(!Object.values(f.options.apps).includes(installed.app));
      assert.equal(installed.bundle, 'public bundle');
    }
    assert(
      result.summaries.every(
        (entry) => entry.bundleSha256 === hash('public bundle')
      )
    );
  } finally {
    f.cleanup();
  }
});

test('a staged resource change before install is rejected before device mutation', async () => {
  const f = fixture();
  const original = f.dependencies.spawnSync;
  let lists = 0;
  f.dependencies.spawnSync = (command, args, options) => {
    if (command === 'xcrun' && args.includes('devices') && ++lists === 2) {
      const resource = path.join(
        f.options.output,
        '.verified-artifacts',
        'import.app',
        'resource.txt'
      );
      if (fs.existsSync(resource)) {
        fs.chmodSync(resource, 0o600);
        fs.writeFileSync(resource, 'unexpected staged mutation');
      }
    }
    return original(command, args, options);
  };
  try {
    await assert.rejects(run(f), /ARTIFACT_CHANGED/);
    assert.equal(mutations(f.calls).length, 0);
  } finally {
    f.cleanup();
  }
});

test('snapshot admission rejects symlink and special resources without following them', async () => {
  for (const kind of ['symlink', 'fifo', 'oversized']) {
    const f = fixture();
    const resource = path.join(f.options.apps.import, 'unsafe-resource');
    if (kind === 'symlink') fs.symlinkSync('/dev/null', resource);
    else if (kind === 'fifo')
      assert.equal(spawnSync('mkfifo', [resource]).status, 0);
    else {
      fs.writeFileSync(resource, '');
      fs.truncateSync(resource, 256 * 1024 * 1024 + 1);
    }
    try {
      await assert.rejects(run(f), /ARTIFACT/);
      assert.equal(mutations(f.calls).length, 0);
    } finally {
      f.cleanup();
    }
  }
});

test('staged mutation after reset cannot reach the reinstall operation', async () => {
  const f = fixture({ reset: true });
  const original = f.dependencies.spawnSync;
  f.dependencies.spawnSync = (command, args, options) => {
    const result = original(command, args, options);
    if (command === 'xcrun' && args.includes('uninstall')) {
      const resource = path.join(
        f.options.output,
        '.verified-artifacts',
        'import.app',
        'resource.txt'
      );
      fs.chmodSync(resource, 0o600);
      fs.writeFileSync(resource, 'changed after reset');
    }
    return result;
  };
  try {
    await assert.rejects(run(f), /ARTIFACT_CHANGED/);
    assert.equal(
      f.calls.filter((call) => call.args.includes('install')).length,
      1
    );
  } finally {
    f.cleanup();
  }
});

test('partial, oversized and invalid copied files are removed without deleting symlink targets', async () => {
  for (const kind of [
    'partial',
    'failed-database',
    'oversized',
    'symlink',
    'directory',
  ]) {
    const f = fixture();
    const original = f.dependencies.spawnSync;
    let injected = false;
    const target = path.join(path.dirname(f.options.output), 'unrelated.txt');
    fs.writeFileSync(target, 'preserve unrelated data');
    f.dependencies.spawnSync = (command, args, options) => {
      if (
        command === 'xcrun' &&
        args.includes('copy') &&
        !injected &&
        (kind !== 'failed-database' ||
          args.includes('Library/Application Support/PaliWallet/wallet.sqlite'))
      ) {
        injected = true;
        const destination = args[args.indexOf('--destination') + 1];
        if (kind === 'symlink') fs.symlinkSync(target, destination);
        else if (kind === 'directory') fs.mkdirSync(destination);
        else
          fs.writeFileSync(
            destination,
            kind === 'partial' ? 'partial copied report' : 'x'.repeat(100001)
          );
        return kind === 'partial' || kind === 'failed-database'
          ? { status: 1, stderr: 'interrupted copy' }
          : {
              status: 0,
              stdout: JSON.stringify({
                info: { outcome: 'success' },
                result: {},
              }),
            };
      }
      return original(command, args, options);
    };
    try {
      if (kind === 'partial') await run(f);
      else
        await assert.rejects(
          run(f),
          kind === 'failed-database'
            ? /NATIVE_COMMAND_FAILED/
            : /INVALID_COPIED_FILE/
        );
      assert.equal(fs.readFileSync(target, 'utf8'), 'preserve unrelated data');
      assert.equal(
        fs
          .readdirSync(f.options.output)
          .some((name) => name.startsWith('.read-') || name === '.database'),
        false
      );
    } finally {
      f.cleanup();
    }
  }
});

test('copied report and invalid database buffers are cleared on every consumption path', async () => {
  for (const invalid of ['none', 'database', 'report', 'read']) {
    const f = fixture();
    const originalRead = fs.readSync;
    const copied = [];
    fs.readSync = (fd, buffer, ...options) => {
      const value = originalRead(fd, buffer, ...options);
      const reportBytes =
        value && buffer.includes(Buffer.from('"physicalRunId"'));
      const databaseBytes =
        value &&
        buffer.length === 4096 &&
        buffer.every((byte) => byte === 0xa5);
      if (reportBytes || databaseBytes) {
        if (invalid === 'database' && databaseBytes)
          buffer.write('SQLite format 3\0');
        if (invalid === 'report' && reportBytes) buffer[0] = 0x5b;
        copied.push(buffer);
        if (invalid === 'read' && reportBytes)
          throw Error('partial local read failed');
      }
      return value;
    };
    try {
      if (invalid === 'database')
        await assert.rejects(run(f), /INVALID_ENCRYPTED_DATABASE/);
      else if (invalid === 'report' || invalid === 'read')
        await assert.rejects(run(f));
      else await run(f);
      assert(copied.length > 0);
      assert(
        copied.every(
          (buffer) =>
            Buffer.isBuffer(buffer) && buffer.every((byte) => byte === 0)
        )
      );
    } finally {
      fs.readSync = originalRead;
      f.cleanup();
    }
  }
});
test('source, bundle, platform, architecture and signature errors precede every device mutation', async () => {
  for (const changes of [
    { source: 'b'.repeat(40) },
    { dirty: true },
    { info: { CFBundleIdentifier: 'com.paliwallet.mobile' } },
    { info: { DTPlatformName: 'iphonesimulator' } },
    { info: { PaliQualificationSourceRevision: 'b'.repeat(40) } },
    { arch: 'x86_64' },
    { signature: true },
    { cdhash: 'e'.repeat(40) },
    { adhoc: true },
    {
      entitlements: {
        'keychain-access-groups': [TEAM + '.com.paliwallet.mobile'],
      },
    },
    {
      entitlements: {
        'com.apple.security.application-groups': ['group.production'],
      },
    },
  ]) {
    const f = fixture(changes);
    try {
      await assert.rejects(run(f));
      assert.equal(mutations(f.calls).length, 0);
    } finally {
      f.cleanup();
    }
  }
});
test('reset is opt-in and uninstall is limited to two acknowledged fixed fixture identities', async () => {
  const existing = fixture({ installed: true });
  try {
    await assert.rejects(run(existing), /FIXTURE_ALREADY_INSTALLED/);
    assert.equal(mutations(existing.calls).length, 0);
  } finally {
    existing.cleanup();
  }
  const f = fixture({ reset: true, installed: true });
  try {
    await run(f);
    const removed = f.calls
      .filter((c) => c.args.includes('uninstall'))
      .map((c) => c.args.at(-1));
    assert.deepEqual(removed, Object.values(PHYSICAL_BUNDLES));
    assert.equal(f.calls.filter((c) => c.args.includes('launch')).length, 6);
  } finally {
    f.cleanup();
  }
  const bad = fixture({
    reset: true,
    report: (r, phase) => {
      if (phase === 'reset') r.physicalRunId = '0'.repeat(32);
    },
  });
  try {
    await assert.rejects(run(bad), /RESET_ACKNOWLEDGEMENT/);
    assert.equal(
      bad.calls.filter((c) => c.args.includes('uninstall')).length,
      0
    );
  } finally {
    bad.cleanup();
  }
});
test('a reused PID is never terminated and cannot complete custody qualification', async () => {
  const f = fixture({ pidReuse: true });
  try {
    await assert.rejects(run(f), /OWNED_PROCESS_CHANGED/);
    assert.equal(f.calls.filter((c) => c.args.includes('terminate')).length, 0);
  } finally {
    f.cleanup();
  }
});
test('a pre-existing fixture process is never taken over or killed', async () => {
  const f = fixture({ existingProcess: true, reset: true, installed: true });
  try {
    await assert.rejects(run(f), /FIXTURE_PROCESS_ALREADY_RUNNING/);
    assert.equal(mutations(f.calls).length, 0);
  } finally {
    f.cleanup();
  }
});
test('reports reject stale nonce, missing native vectors and changed restart identity', async () => {
  for (const changes of [
    {
      report: (r) => {
        r.physicalRunId = '0'.repeat(32);
      },
    },
    {
      report: (r) => {
        r.cryptoEvidence.cases.pop();
      },
    },
    {
      report: (r, phase) => {
        if (phase === 'restart') r.fingerprint = 'e'.repeat(64);
      },
    },
    {
      report: (r, phase) => {
        if (phase === 'restart')
          r.sessionId = '11111111-1111-1111-1111-111111111111';
      },
    },
  ]) {
    const f = fixture(changes);
    try {
      await assert.rejects(run(f));
      assert(
        !fs.existsSync(
          path.join(f.options.output, 'physical-ios-qualification.json')
        )
      );
    } finally {
      f.cleanup();
    }
  }
});
test('missing reports reach a bounded deadline without inventing success', async () => {
  const f = fixture({ noReport: true });
  try {
    await assert.rejects(run(f), /TIMED_OUT/);
    assert(f.calls.length < 1000);
    assert(
      !fs.existsSync(
        path.join(f.options.output, 'physical-ios-qualification.json')
      )
    );
  } finally {
    f.cleanup();
  }
});
test('an existing host lease cannot be stolen or removed by another run', async () => {
  const lease = path.join(
    os.tmpdir(),
    `pali-physical-${hash(DEVICE.toLowerCase())}.lock`
  );
  fs.writeFileSync(lease, 'other owner', { flag: 'wx' });
  const f = fixture();
  try {
    await assert.rejects(run(f), /LEASE_BUSY/);
    assert.equal(mutations(f.calls).length, 0);
    assert.equal(fs.readFileSync(lease, 'utf8'), 'other owner');
  } finally {
    fs.unlinkSync(lease);
    f.cleanup();
  }
});
test('UDID and CoreDevice aliases contend for the same canonical host lease', async () => {
  const alias = 'bbbbbbbb-1111-2222-3333-aaaaaaaaaaaa';
  const lease = path.join(
    os.tmpdir(),
    `pali-physical-${hash(DEVICE.toLowerCase())}.lock`
  );
  fs.writeFileSync(lease, 'canonical owner', { flag: 'wx' });
  const f = fixture({
    device: {
      hardwareProperties: {
        ...physicalDevice().hardwareProperties,
        udid: alias,
      },
    },
  });
  f.options.device = alias;
  try {
    await assert.rejects(run(f), /LEASE_BUSY/);
    assert.equal(mutations(f.calls).length, 0);
    assert.equal(fs.readFileSync(lease, 'utf8'), 'canonical owner');
  } finally {
    fs.unlinkSync(lease);
    f.cleanup();
  }
});
test('device context changes stop the run without terminating an unproven process', async () => {
  const f = fixture();
  const original = f.dependencies.spawnSync;
  f.dependencies.spawnSync = (command, args, options) => {
    const value = original(command, args, options);
    if (
      command === 'xcrun' &&
      args.includes('devices') &&
      f.calls.some((call) => call.args.includes('launch'))
    ) {
      const document = JSON.parse(value.stdout);
      document.result.devices[0].deviceProperties.osVersionNumber = '27.3';
      value.stdout = JSON.stringify(document);
    }
    return value;
  };
  try {
    await assert.rejects(run(f), /DEVICE_CONTEXT_CHANGED/);
    assert.equal(
      f.calls.filter((call) => call.args.includes('terminate')).length,
      0
    );
    const failure = fs.readFileSync(
      path.join(f.options.output, 'physical-ios-failure.json'),
      'utf8'
    );
    assert(!failure.includes(DEVICE));
  } finally {
    f.cleanup();
  }
});
test('physical report checks preserve exact HD/ERC20/NEVM evidence and refuse an extra field', () => {
  const first = report('create', 'import', 'c'.repeat(32));
  const second = report('restart', 'import', 'c'.repeat(32));
  const expected = {
    phase: 'create',
    scenario: 'import',
    runId: 'c'.repeat(32),
    bundleIdentifier: PHYSICAL_BUNDLES.import,
    sourceRevision: SOURCE,
  };
  assert.equal(
    decodePhysicalReport(JSON.stringify(first), expected).fingerprint,
    first.fingerprint
  );
  assert.doesNotThrow(() => assertPhysicalRestart(first, second));
  for (const key of [
    'nativeNevmVerified', 'nevmAccountId', 'nevmAccountIndex', 'nevmAddress',
    'nevmTransferHash', 'nevmEthereumTransferHash', 'nevmChainId',
    'nevmJournalContainerVersion', 'nevmRestoredFromJournal',
  ]) {
    const incomplete = { ...first };
    delete incomplete[key];
    assert.throws(() => decodePhysicalReport(JSON.stringify(incomplete), expected));
  }
  for (const mutation of [
    { nevmTransferHash: '0x' + '9'.repeat(64) },
    { nevmEthereumTransferHash: '0x' + '9'.repeat(64) },
    { nevmChainId: '1' },
    { nevmRestoredFromJournal: false },
  ]) assert.throws(() => assertPhysicalRestart(first, { ...second, ...mutation }));
  assert.throws(() =>
    decodePhysicalReport(
      JSON.stringify({ ...first, secret: 'untrusted' }),
      expected
    )
  );
});
