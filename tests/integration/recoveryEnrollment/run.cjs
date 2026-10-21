const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const pins = require('./pins.cjs');

assert.equal(
  process.versions.node,
  '23.11.1',
  'Use Node 23.11.1 for the pinned integration fixture'
);
assert.ok(
  process.env.RECOVERY_BACKEND_ROOT,
  'Set RECOVERY_BACKEND_ROOT to the pinned sysnode-backend checkout'
);
const backendRoot = fs.realpathSync(process.env.RECOVERY_BACKEND_ROOT);
const git = (...args) =>
  execFileSync('git', ['-C', backendRoot, ...args], {
    encoding: 'utf8',
  }).trim();
assert.equal(
  git('rev-parse', 'HEAD'),
  pins.backendRevision,
  'Backend checkout must match the reviewed immutable revision'
);
git('diff', '--exit-code', 'HEAD');
const anvil = process.env.ANVIL_BIN || 'anvil';
const version = execFileSync(anvil, ['--version'], { encoding: 'utf8' });
assert.ok(
  version.split('\n')[0].trim() === `anvil Version: ${pins.anvilVersion}`,
  'Use the pinned Anvil version'
);
const rootDir = path.resolve(__dirname, '../../..');
console.log(
  JSON.stringify({
    scope:
      'Actual Pali signing component and SDK to real local ERC1271 and backend; not extension-browser E2E',
    backendRevision: pins.backendRevision,
    paliRevision: execFileSync('git', ['-C', rootDir, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    node: process.versions.node,
    anvil: version.trim(),
  })
);
const evidence = process.env.RECOVERY_ENROLLMENT_EVIDENCE_DIR;
if (evidence) fs.mkdirSync(evidence, { recursive: true });
const args = [
  require.resolve('jest/bin/jest'),
  '--config',
  path.join(__dirname, 'jest.config.cjs'),
  '--runInBand',
  '--ci',
];
if (evidence)
  args.push('--json', '--outputFile', path.join(evidence, 'jest-results.json'));
const result = spawnSync(process.execPath, args, {
  cwd: rootDir,
  env: { ...process.env, NODE_ENV: 'test', RECOVERY_BACKEND_ROOT: backendRoot },
  stdio: 'inherit',
  timeout: 150000,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
