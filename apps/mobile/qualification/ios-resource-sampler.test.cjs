/* global __dirname */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');
const { processUsage, memoryUsage, MAX_BYTES, MAX_SAMPLES } = require('./ios-resource-sampler.cjs');

test('resource projection aggregates only fixed process names and never outputs paths or arguments', () => {
  const result = processUsage(' 12.3 2048 /private/worker/com.apple.WebKit.WebContent\n 20 1024 /private/worker/com.apple.WebKit.WebContent\n 0.1 30 /a/PaliQualification\n 90 2000 /private/SECRET\n 10 2000 /a/clang private-secret\n 20 30 toString\n');
  assert.deepEqual(result, [{ kind: 'web-content', count: 2, cpuPercent: 32.3, rssBytes: 3072 * 1024 }, { kind: 'qualification', count: 1, cpuPercent: 0.1, rssBytes: 30 * 1024 }]);
  assert(!JSON.stringify(result).includes('private'));
  assert.equal(processUsage('x'.repeat(512 * 1024 + 1)), null);
  assert.equal(processUsage('10001 1 /a/clang'), null);
  assert.equal(processUsage('1 9999999999999999999 /a/clang'), null);
});

test('memory projection preserves units and refuses malformed or missing numeric observations', () => {
  const vm = 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 10.\nPages active: 20.\nPages inactive: 30.\nPages wired down: 40.\nPages occupied by compressor: 50.\nPageouts: 60.\n';
  const system = '8589934592\ntotal = 2048.00M  used = 100.50M  free = 1947.50M';
  assert.deepEqual(memoryUsage(vm, system), { physicalBytes: 8589934592, swapUsedBytes: 100.5 * 1024 ** 2,
    freeBytes: 10 * 16384, activeBytes: 20 * 16384, inactiveBytes: 30 * 16384, wiredBytes: 40 * 16384, compressedBytes: 50 * 16384, pageoutBytes: 60 * 16384 });
  for (const bad of [undefined, '', vm.replace('Pages free: 10.', 'Pages free: SECRET'), vm.replace('page size of 16384', 'page size of -1')])
    assert.equal(memoryUsage(bad, system), null);
  assert.equal(memoryUsage(vm, 'secret'), null);
  assert.equal(MAX_BYTES, 1048576); assert.equal(MAX_SAMPLES, 360);
});

test('CI bounds build parallelism and sampler cleanup preserves the qualification exit status', () => {
  const workflow = yaml.load(fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/mobile-native-qualification.yml'), 'utf8'));
  const build = workflow.jobs.ios.steps.find(step => step.name === 'Build real iOS simulator binary');
  assert.match(build.run, /-jobs 2 CODE_SIGNING_ALLOWED=NO build/);
  const run = workflow.jobs.ios.steps.find(step => step.env?.QUALIFICATION_ARTIFACTS).run;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-resource-cleanup-'));
  try {
    fs.writeFileSync(path.join(directory, 'node'), '#!/bin/sh\nif [ "$1" = "qualification/ios-resource-sampler.cjs" ]; then if [ "$SAMPLER_FAIL" = 1 ]; then exit 55; fi; trap "exit 0" TERM; while :; do sleep 0.05; done; fi\nexit "$QUALIFICATION_EXIT"\n', { mode: 0o700 });
    for (const code of [0, 37]) for (const samplerFailure of ['0', '1']) {
      const result = spawnSync('/bin/bash', ['-e', '-c', run], {
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, QUALIFICATION_EXIT: String(code), SAMPLER_FAIL: samplerFailure, QUALIFICATION_ARTIFACTS: directory, RUNNER_TEMP: directory }, timeout: 5000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, code);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
