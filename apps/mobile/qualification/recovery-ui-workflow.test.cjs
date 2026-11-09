const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');
const yaml = require('js-yaml');

const mobile = path.dirname(require.resolve('../package.json'));
const root = path.resolve(mobile, '../..');
const wrapper = path.join(mobile, 'scripts/build-native-recovery-ui.cjs');

test('recovery UI build uses the actual isolated fixture and bounded offline Expo export', () => {
  let call;
  const host = { execPath: '/fixture/node', env: { FIXTURE: 'kept' }, exitCode: undefined };
  const load = (name) => {
    if (name === 'node:path') return path;
    if (name === 'node:child_process') return { spawnSync(...args) { call = args; return { status: 7 }; } };
    assert.fail(`Unexpected wrapper dependency ${name}`);
  };
  load.resolve = (name) => { assert.equal(name, 'expo/bin/cli'); return '/fixture/expo-cli'; };
  runInNewContext(fs.readFileSync(wrapper, 'utf8'), { require: load, process: host, __dirname: path.dirname(wrapper) });
  assert.equal(call[0], host.execPath);
  assert.deepEqual(Array.from(call[1]), ['/fixture/expo-cli', 'export', '--dev', '--platform', 'web', '--output-dir', path.join(mobile, 'dist-native-recovery-ui'), '--max-workers', '1']);
  assert.equal(call[2].cwd, path.join(mobile, 'tests/native-recovery-ui'));
  assert.equal(call[2].env.EXPO_NO_TELEMETRY, '1');
  assert.equal(call[2].env.EXPO_NO_DOTENV, '1');
  assert.equal(call[2].env.EXPO_OFFLINE, '1');
  assert.equal(host.exitCode, 7, 'build failure cannot be presented as successful');
  const fixture = JSON.parse(fs.readFileSync(path.join(call[2].cwd, 'package.json')));
  assert.equal(fixture.private, true);
  assert(fs.existsSync(path.join(call[2].cwd, fixture.main)));
});

test('portable recovery output is exercised in the existing CI budget and uploaded on failure', () => {
  const module = { exports: {} };
  const config = fs.readFileSync(path.join(mobile, 'playwright.recovery.config.ts'), 'utf8');
  runInNewContext(ts.transpileModule(config, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    module, exports: module.exports,
    require(name) { assert.equal(name, '@playwright/test'); return { defineConfig(value) { return value; } }; },
  });
  const output = module.exports.default.outputDir;
  assert.equal(output, 'test-results/recovery-ui');
  assert.equal(path.isAbsolute(output), false);
  const manifest = JSON.parse(fs.readFileSync(path.join(mobile, 'package.json')));
  assert.equal(manifest.scripts['test:recovery-ui'], 'node scripts/build-native-recovery-ui.cjs && playwright test --config playwright.recovery.config.ts');
  const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/mobile.yml'), 'utf8'));
  const { foundation, browser, validate } = workflow.jobs;
  assert.equal(foundation['timeout-minutes'], 30);
  assert.equal(browser['timeout-minutes'], 20);
  for (const job of [foundation, browser]) {
    assert.equal(job.defaults.run['working-directory'], 'apps/mobile');
  }
  for (const command of ['npm run lint', 'npm run typecheck', 'npm test'])
    assert.equal(foundation.steps.filter((step) => step.run === command).length, 1, command);
  assert.equal(browser.steps.find(step => step.run === 'npm run build:web').if, "matrix.suite == 'preview'");
  assert.equal(browser.strategy['fail-fast'], false);
  assert.deepEqual(browser.strategy.matrix.include.map(entry => entry.command), [
    'npm run test:ui', 'npm run test:activity-ui', 'npm run test:watch-ui -- --workers=2',
    'npm run test:faucet-ui', 'npm run test:recovery-ui',
  ]);
  for (const platform of ['android', 'ios']) assert(foundation.steps.some((step) => step.run?.startsWith(`npx --no-install expo export --platform ${platform} `)));
  assert.equal(validate.name, 'Mobile types, behavior and bundles');
  assert.equal(validate.if, 'always()');
  assert.deepEqual(validate.needs, ['foundation', 'browser']);
  const { spawnSync } = require('node:child_process');
  const aggregate = validate.steps[0];
  for (const status of ['success', 'failure', 'cancelled', 'skipped']) {
    for (const other of ['success', 'failure', 'cancelled', 'skipped']) {
      const result = spawnSync('/bin/bash', ['-e', '-c', aggregate.run], {
        env: { FOUNDATION_RESULT: status, BROWSER_RESULT: other },
      });
      assert.equal(result.status === 0, status === 'success' && other === 'success');
    }
  }
  const upload = browser.steps.find((step) => step.name === 'Upload browser failure evidence');
  assert.equal(upload.if, 'failure() || cancelled()');
  const includes = upload.with.path.split('\n').map((line) => line.trim());
  assert(includes.includes('apps/mobile/test-results/'), 'existing recursive upload must include the recovery output directory');
  assert(path.resolve(mobile, output).startsWith(path.resolve(root, 'apps/mobile/test-results') + path.sep));
});


test('both mobile workflows include shared wallet and token discovery code', () => {
  for (const name of ['mobile.yml', 'mobile-native-qualification.yml']) {
    const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows', name), 'utf8'));
    assert(workflow.on.pull_request.paths.includes('source/wallet/**'));
    assert(workflow.on.pull_request.paths.includes('source/utils/tokenDiscovery.ts'), name);
  }
});

test('native qualification includes native runner dependency resolution', () => {
  const native = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/mobile-native-qualification.yml'), 'utf8'));
  assert(native.on.pull_request.paths.includes('apps/mobile/scripts/register-shared-test-dependencies.mjs'));
  for (const job of Object.values(native.jobs)) {
    assert(job.steps.some(step => step.run === 'node --import ./scripts/register-shared-test-dependencies.mjs --test qualification/*.test.cjs'));
    assert(job.steps.some(step => step.run?.includes('node --import ./scripts/register-shared-test-dependencies.mjs qualification/run-native.cjs')));
  }
});
