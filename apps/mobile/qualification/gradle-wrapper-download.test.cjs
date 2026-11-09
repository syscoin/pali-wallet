/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');
const yaml = require('js-yaml');
const { configureGradleWrapperDownload } = require('./gradle-wrapper-download.cjs');

const mobile = path.resolve(__dirname, '..');
const root = path.resolve(mobile, '../..');
const template = execFileSync('tar', ['-xOf', path.join(path.dirname(require.resolve('expo/package.json')), 'template.tgz'),
  'package/android/gradle/wrapper/gradle-wrapper.properties'], { encoding: 'utf8' });

function fixture(text) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-gradle-wrapper-'));
  const wrapper = path.join(directory, 'android/gradle/wrapper');
  fs.mkdirSync(wrapper, { recursive: true });
  const file = path.join(wrapper, 'gradle-wrapper.properties');
  if (text !== undefined) fs.writeFileSync(file, text);
  return { directory, wrapper, file, dispose: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

test('installed Expo wrapper changes only its distribution download timeout, idempotently', () => {
  assert.match(template, /^distributionUrl=https\\:\/\/services\.gradle\.org\/distributions\/gradle-9\.4\.1-bin\.zip$/m);
  assert.match(template, /^networkTimeout=10000$/m);
  assert.match(template, /^validateDistributionUrl=true$/m);
  for (const text of [template, template.replace(/\n/g, '\r\n'),
    template + '# Existing verification, cache and authentication settings are untouched\n' +
      'distributionSha256Sum=' + 'a'.repeat(64) + '\nwrapperUser=kept\nwrapperPassword=kept\n']) {
    const f = fixture(text);
    try {
      const expected = text.replace('networkTimeout=10000', 'networkTimeout=60000');
      configureGradleWrapperDownload(f.directory);
      assert.equal(fs.readFileSync(f.file, 'utf8'), expected);
      configureGradleWrapperDownload(f.directory);
      assert.equal(fs.readFileSync(f.file, 'utf8'), expected);
    } finally { f.dispose(); }
  }
});

test('missing, ambiguous or unexpected timeout properties fail before writing', () => {
  for (const text of [undefined, template.replace('networkTimeout=10000\n', ''),
    template + 'networkTimeout=10000\n', template + 'networkTimeout=60000\n',
    template.replace('networkTimeout=10000', 'networkTimeout=30000'),
    template.replace('networkTimeout=10000', 'networkTimeout=10000 # ignored?'),
    template.replace('networkTimeout=10000', ' networkTimeout=10000'),
    template.replace('networkTimeout=10000', 'networkTimeout:10000'),
    template.replace('networkTimeout=10000', 'networkTimeout=100\\\n00'),
    template + 'network\\Timeout=10000\n', template + 'network\\u0054imeout=10000\n']) {
    const f = fixture(text);
    try {
      assert.throws(() => configureGradleWrapperDownload(f.directory));
      if (text !== undefined) assert.equal(fs.readFileSync(f.file, 'utf8'), text);
      else assert.equal(fs.existsSync(f.file), false);
    } finally { f.dispose(); }
  }
});

test('unexpected symlink and directory property paths cannot redirect the installer write', () => {
  for (const kind of ['file-symlink', 'parent-symlink', 'directory']) {
    const f = fixture(template);
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-gradle-other-'));
    const outside = path.join(target, 'gradle-wrapper.properties');
    fs.writeFileSync(outside, template);
    try {
      if (kind === 'parent-symlink') {
        fs.rmSync(f.wrapper, { recursive: true }); fs.symlinkSync(target, f.wrapper);
      } else {
        fs.unlinkSync(f.file);
        if (kind === 'file-symlink') fs.symlinkSync(outside, f.file);
        else fs.mkdirSync(f.file);
      }
      assert.throws(() => configureGradleWrapperDownload(f.directory));
      assert.equal(fs.readFileSync(outside, 'utf8'), template);
    } finally { f.dispose(); fs.rmSync(target, { recursive: true, force: true }); }
  }
});

test('every Android qualification mode configures the wrapper before JVM checks and binary assembly', () => {
  const workflowFile = '.github/workflows/mobile-native-qualification.yml';
  const workflow = yaml.load(fs.readFileSync(path.join(root, workflowFile), 'utf8'));
  const steps = workflow.jobs.android.steps;
  const prebuild = steps.findIndex(step => step.run === 'npx --no-install expo prebuild --platform android --no-install');
  const configurations = steps.map((step, index) => ({ step, index }))
    .filter(({ step }) => step.run === 'node qualification/gradle-wrapper-download.cjs');
  assert.equal(configurations.length, 1);
  const configure = configurations[0];
  assert.equal(configure.step.if, undefined);
  assert.equal(configure.step['continue-on-error'], undefined);
  assert(configure.index > prebuild && prebuild >= 0);
  const gradleSteps = steps.map((step, index) => ({ step, index })).filter(({ step }) => step.run?.includes('./gradlew'));
  assert.equal(gradleSteps.length, 2);
  assert(gradleSteps.every(({ index }) => index > configure.index));
  assert.equal(steps.find(step => step.name === 'Run Android JVM public snapshot and SLH ownership checks').if,
    "env.PALI_NATIVE_PUBLIC_POOL_QUALIFICATION != '1' && env.PALI_NATIVE_PRIVATE_PROOF_QUALIFICATION != '1'");
  assert.equal(workflow.jobs.android['timeout-minutes'], 90);
  assert.equal(workflow.jobs.android.defaults.run['working-directory'], 'apps/mobile');
  for (const [file, dependency] of [['mobile.yml', 'apps/mobile/**'], ['mobile-native-qualification.yml', 'apps/mobile/qualification/**']]) {
    const lane = yaml.load(fs.readFileSync(path.join(root, '.github/workflows', file), 'utf8'));
    assert(lane.on.pull_request.paths.includes(dependency));
    assert(lane.on.pull_request.paths.includes(workflowFile));
  }
});
