const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  PHYSICAL_BUNDLES,
  physicalBuild,
  physicalLaunch,
  resetPhysicalFixture,
} = require('./physical-contract.ts');
const {
  assertQualificationBuild,
  parseQualificationLaunch,
} = require('./launch-parameters.ts');
const build = () =>
  physicalBuild(
    {
      version: 1,
      scenario: 'import',
      bundleIdentifier: PHYSICAL_BUNDLES.import,
      sourceRevision: 'a'.repeat(40),
      lockfileSha256: 'b'.repeat(64),
    },
    PHYSICAL_BUNDLES.import,
    'com.paliwallet.qualification'
  );
const link = (phase = 'reset') =>
  `pali-wallet-qualification://physical?phase=${phase}&scenario=import&runId=${'c'.repeat(
    32
  )}`;

test('physical identities are fixed and do not broaden the old simulator contract', () => {
  assert.equal(build().bundleIdentifier, PHYSICAL_BUNDLES.import);
  for (const change of [
    { bundleIdentifier: 'com.paliwallet.mobile' },
    { scenario: 'other' },
    { version: 2 },
    { sourceRevision: 'main' },
    { lockfileSha256: '' },
    { arbitrary: true },
  ])
    assert.throws(() =>
      physicalBuild(
        { ...build(), ...change },
        PHYSICAL_BUNDLES.import,
        'com.paliwallet.qualification'
      )
    );
  assert.throws(() =>
    physicalBuild(
      build(),
      'com.paliwallet.mobile',
      'com.paliwallet.qualification'
    )
  );
  assert.throws(() =>
    physicalBuild(build(), PHYSICAL_BUNDLES.import, 'com.paliwallet.mobile')
  );
  assert.throws(() =>
    assertQualificationBuild(
      PHYSICAL_BUNDLES.import,
      'com.paliwallet.qualification'
    )
  );
  assert.throws(() => parseQualificationLaunch(link()));
});

test('reset and qualification launches bind the exact scenario, route and fresh run ID', () => {
  assert.equal(physicalLaunch(link(), build()).phase, 'reset');
  assert.equal(physicalLaunch(link('create'), build()).phase, 'create');
  assert.equal(
    physicalLaunch(`${link('restart')}&address=0x${'11'.repeat(20)}`, build())
      .phase,
    'restart'
  );
  for (const value of [
    link().replace('import', 'generate'),
    link().replace('physical?', 'run?'),
    link().replace('physical?', 'physical/extra?'),
    link().replace('//physical', '//user@physical'),
    link() + '&runId=' + 'd'.repeat(32),
    link() + '&key=other',
    link() + '#fragment',
    link().replace('c'.repeat(32), 'x'),
    link('restart'),
    link() + '&address=0x' + '11'.repeat(20),
  ])
    assert.throws(() => physicalLaunch(value, build()));
});

test('only explicit reset deletes the fixture key and acknowledges after null readback', async () => {
  const calls = [];
  const ports = {
    async deleteKey() {
      calls.push('delete');
    },
    async readKey() {
      calls.push('read');
      return null;
    },
  };
  await assert.rejects(
    resetPhysicalFixture(physicalLaunch(link('create'), build()), ports)
  );
  assert.deepEqual(calls, []);
  await assert.rejects(
    resetPhysicalFixture(
      { ...physicalLaunch(link(), build()), address: '0x' + '11'.repeat(20) },
      ports
    )
  );
  assert.deepEqual(calls, []);
  const value = await resetPhysicalFixture(
    physicalLaunch(link(), build()),
    ports
  );
  assert.deepEqual(calls, ['delete', 'read']);
  assert.equal(value.physicalRunId, 'c'.repeat(32));
  assert.equal(value.keyDeleted, true);
  await assert.rejects(
    resetPhysicalFixture(physicalLaunch(link(), build()), {
      ...ports,
      async readKey() {
        return 'retained';
      },
    }),
    /RESET_FAILED/
  );
  await assert.rejects(
    resetPhysicalFixture(physicalLaunch(link(), build()), {
      ...ports,
      async deleteKey() {
        throw Error('locked');
      },
    }),
    /locked/
  );
});

for (const scenario of ['import', 'generate'])
  test(`physical ${scenario} configuration changes only a fresh dedicated fixture and records the actual lock hash`, () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'pali-physical-config-')
    );
    try {
      const keyringVersion = '3.9.7';
      fs.mkdirSync(path.join(directory, 'scripts'));
      fs.mkdirSync(path.join(directory, 'node_modules/@sidhujag/sysweb3-keyring'), { recursive: true });
      fs.writeFileSync(path.join(directory, 'node_modules/@sidhujag/sysweb3-keyring/package.json'), JSON.stringify({ name: '@sidhujag/sysweb3-keyring', version: keyringVersion }));
      fs.mkdirSync(path.join(directory, 'qualification'));
      for (const file of [
        'scripts/configure-native-qualification.cjs',
        'scripts/qualification-sdk.cjs',
        'qualification/physical-contract.ts',
      ])
        fs.copyFileSync(
          path.join(
            path.dirname(require.resolve('./physical-contract.test.cjs')),
            '..',
            file
          ),
          path.join(directory, file)
        );
      fs.writeFileSync(
        path.join(directory, 'index.ts'),
        'public production entry'
      );
      fs.writeFileSync(
        path.join(directory, 'package-lock.json'),
        '{"lockfileVersion":3}'
      );
      fs.writeFileSync(
        path.join(directory, 'package.json'),
        JSON.stringify({
          main: 'index.ts',
          dependencies: { '@sidhujag/sysweb3-keyring': keyringVersion },
        })
      );
      fs.writeFileSync(
        path.join(directory, 'app.json'),
        JSON.stringify({
          expo: {
            ios: { bundleIdentifier: 'com.paliwallet.mobile' },
            android: { package: 'com.paliwallet.mobile', allowBackup: false },
            updates: { enabled: false },
          },
        })
      );
      const env = {
        ...process.env,
        CI: 'true',
        PALI_NATIVE_QUALIFICATION: '1',
        PALI_NATIVE_HTTP_QUALIFICATION: '0',
        PALI_PHYSICAL_QUALIFICATION: scenario,
        GITHUB_SHA: 'a'.repeat(40),
      };
      const command = [
        path.join(directory, 'scripts/configure-native-qualification.cjs'),
      ];
      assert.notEqual(
        spawnSync(process.execPath, command, {
          env: { ...env, GITHUB_SHA: '' },
        }).status,
        0
      );
      assert.equal(
        JSON.parse(fs.readFileSync(path.join(directory, 'package.json'))).main,
        'index.ts'
      );
      assert.equal(spawnSync(process.execPath, command, { env }).status, 0);
      const configured = JSON.parse(
        fs.readFileSync(path.join(directory, 'app.json'))
      ).expo;
      assert.equal(configured.ios.bundleIdentifier, PHYSICAL_BUNDLES[scenario]);
      assert.equal(configured.android.package, 'com.paliwallet.qualification');
      assert.equal(
        configured.ios.infoPlist.PaliQualificationSourceRevision,
        'a'.repeat(40)
      );
      assert.equal(
        configured.extra.paliPhysicalQualification.lockfileSha256.length,
        64
      );
      assert.equal(
        fs.readFileSync(path.join(directory, 'index.ts'), 'utf8'),
        'public production entry'
      );
      assert.notEqual(spawnSync(process.execPath, command, { env }).status, 0);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
