/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Buffer } = require('node:buffer');
const test = require('node:test');
const { runInNewContext } = require('node:vm');
const yaml = require('js-yaml');

const root = path.resolve(__dirname, '../../..');

test('proof key preparation accepts only the fixed URL, bounded body and matching pin', async () => {
  const fixture = Buffer.from('abc');
  const pin = crypto.createHash('sha256').update(fixture).digest('hex');
  const output = { exports: {} };
  const load = name => {
    if (name === '../source/utils/privacy/proverArtifacts.ts') return {
      PRIVACY_PROVING_KEY_URL: 'https://fixed.invalid/pinned-key', PRIVACY_PROVING_KEY_BYTES: 3, PRIVACY_PROVING_KEY_SHA256: pin,
    };
    return require(name);
  };
  runInNewContext(fs.readFileSync(path.join(root, 'scripts/prepare-native-private-prover.cjs'), 'utf8'), {
    require: load, module: output, Buffer, AbortSignal, __dirname: path.join(root, 'scripts'),
  });
  const { downloadProvingKey } = output.exports;
  let cancelled = false;
  const fetch = bytes => async (url, options) => {
    assert.equal(url, 'https://fixed.invalid/pinned-key');
    assert.equal(options.redirect, 'error');
    let sent = false;
    return { ok: true, body: { getReader: () => ({ read: async () => sent ? { done: true } : (sent = true, { value: bytes, done: false }),
      cancel: async () => { cancelled = true; } }) } };
  };
  assert.deepEqual(await downloadProvingKey(fetch(fixture)), fixture);
  assert(cancelled);
  await assert.rejects(downloadProvingKey(fetch(Buffer.from('abcd'))), /KEY_INVALID/);
  await assert.rejects(downloadProvingKey(fetch(Buffer.from('xyz'))), /KEY_INVALID/);
});

test('private proof workflow remains opt-in, exclusive and within existing owned native jobs', () => {
  const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/mobile-native-qualification.yml'), 'utf8'));
  assert.equal(workflow.on.workflow_dispatch.inputs.private_proof.type, 'boolean');
  assert.equal(workflow.on.workflow_dispatch.inputs.private_proof.default, false);
  assert.equal(workflow.env.PALI_NATIVE_PRIVATE_PROOF_QUALIFICATION, "${{ inputs.private_proof && '1' || '0' }}");
  assert.match(workflow.env.PALI_NATIVE_HTTP_QUALIFICATION, /inputs\.public_pool \|\| inputs\.private_proof/);
  assert.deepEqual(Object.keys(workflow.jobs), ['ios', 'android']);
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(job['timeout-minutes'], 90);
    assert.equal(job.defaults.run['working-directory'], 'apps/mobile');
    const steps = job.steps;
    const validate = steps.findIndex(step => step.name === 'Validate exclusive proof mode');
    const prepare = steps.findIndex(step => step.name === 'Package pinned local proof assets');
    const configure = steps.findIndex(step => step.run === 'node scripts/configure-native-qualification.cjs');
    assert(validate >= 0 && prepare > validate && configure > prepare);
    assert.match(steps[validate].run, /PALI_NATIVE_PUBLIC_POOL_QUALIFICATION/);
    assert.equal(steps[prepare].if, "env.PALI_NATIVE_PRIVATE_PROOF_QUALIFICATION == '1'");
    assert.equal(steps[prepare]['working-directory'], '.');
    assert.match(steps[prepare].run, /yarn install --frozen-lockfile --ignore-scripts/);
    assert(steps[prepare].run.indexOf('node scripts/apply-keyring-ledger.cjs') < steps[prepare].run.indexOf('node scripts/prepare-native-private-prover.cjs'));
    assert(steps.some(step => step.run?.includes('qualification/run-native.cjs')));
    assert.equal(steps.filter(step => step.uses?.startsWith('actions/upload-artifact@')).length, 1);
    assert.equal(steps.find(step => step.uses?.startsWith('actions/upload-artifact@')).if, 'always()');
  }
  assert.equal(workflow.jobs.android.steps.filter(step => step.name === 'Start isolated API 35 emulator').length, 1);
  assert.equal(workflow.jobs.android.steps.find(step => step.name === 'Stop isolated emulator').if, 'always()');
});
