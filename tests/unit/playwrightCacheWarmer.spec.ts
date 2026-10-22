import fs from 'fs';
import path from 'path';

const readWorkflow = (name: string) =>
  fs
    .readFileSync(
      path.resolve(__dirname, '../../.github/workflows', name),
      'utf8'
    )
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
const workflow = readWorkflow('browser-cache.yml');
const main = readWorkflow('main.yml');
const warm = workflow.split('\n  warm:\n')[1];
const steps = warm.split(/\n(?=      - )/);
const aptPath = '          path: /var/cache/pali-playwright-apt/*.deb';
const verifier = 'bash .github/scripts/verify-playwright-apt-cache.sh';

it('warms only the trusted master repository on push, manual dispatch or a daily schedule', () => {
  const triggers = workflow.split('\non:\n')[1].split('\npermissions:')[0];
  expect(
    [...triggers.matchAll(/^  ([a-z_]+):/gm)].map((match) => match[1]).sort()
  ).toEqual(['push', 'schedule', 'workflow_dispatch']);
  expect(triggers).toContain('  push:\n    branches: [master]');
  const cron = triggers.match(/    - cron: '([^']+)'/)?.[1].split(' ');
  expect(cron).toHaveLength(5);
  expect(cron?.slice(2)).toEqual(['*', '*', '*']);
  expect(warm.split('\n    steps:')[0]).toContain(
    "    if: github.repository == 'syscoin/pali-wallet' && github.ref == 'refs/heads/master'"
  );
  expect(workflow).toContain('\npermissions:\n  contents: read\n');
  expect(workflow).not.toMatch(
    /pull_request|workflow_run|repository_dispatch|inputs:|github\.event\.inputs/
  );
  const checkout = steps.filter((step) =>
    step.includes('uses: actions/checkout@')
  );
  expect(checkout).toHaveLength(1);
  expect(checkout[0]).toContain('          persist-credentials: false');
  expect(checkout[0]).not.toMatch(/^\s+(ref|repository):/m);
});

it('shares exactly the main visual/conformance archive key and caches downloads only', () => {
  const keys = (text: string) =>
    text.match(/^          key: playwright-apt-v1-.+$/gm);
  const mainKeys = keys(main)!;
  expect(mainKeys).toHaveLength(2);
  expect(mainKeys[0]).toBe(mainKeys[1]);
  expect(keys(workflow)).toEqual([mainKeys[0]]);
  const aptCaches = steps.filter((step) =>
    /uses: actions\/cache\/(restore|save)@/.test(step)
  );
  expect(aptCaches).toHaveLength(2);
  for (const step of aptCaches) expect(step).toContain(aptPath);
  expect(workflow).not.toMatch(/^\s*restore-keys:/m);
  expect(workflow).not.toMatch(/\/var\/lib\/(apt|dpkg)|\/usr\//);
  for (const input of [
    'yarn.lock',
    'package.json',
    '.github/workflows/main.yml',
    '.github/scripts/verify-playwright-apt-cache.sh',
  ]) {
    expect(mainKeys[0]).toContain(`'${input}'`);
  }
  for (const part of ['platform', 'image', 'week']) {
    expect(mainKeys[0]).toContain(`steps.apt-cache-key.outputs.${part}`);
  }
});

it('keeps real apt sandbox access and verifies restored and downloaded archives before save', () => {
  const prepare = steps.findIndex((step) =>
    step.includes('name: Prepare sandboxed apt download archive')
  );
  expect(steps[prepare]).toContain(
    'sudo install -d -o "$(id -u)" -g "$(id -g)" -m 0711 /var/cache/pali-playwright-apt'
  );
  expect(steps[prepare]).toContain(
    'sudo install -d -o _apt -g root -m 0700 /var/cache/pali-playwright-apt/partial'
  );
  const restore = steps.findIndex((step) =>
    step.includes('uses: actions/cache/restore@')
  );
  const checks = steps
    .map((step, index) => (step.includes(verifier) ? index : -1))
    .filter((index) => index >= 0);
  const install = steps.findIndex((step) =>
    step.includes('run: npx playwright install --with-deps chromium')
  );
  const save = steps.findIndex((step) =>
    step.includes('uses: actions/cache/save@')
  );
  expect(checks).toHaveLength(2);
  expect(prepare).toBeGreaterThanOrEqual(0);
  expect(prepare).toBeLessThan(restore);
  expect(restore).toBeLessThan(checks[0]);
  expect(checks[0]).toBeLessThan(install);
  expect(install).toBeLessThan(checks[1]);
  expect(checks[1]).toBeLessThan(save);
  expect(steps[checks[0]]).toContain(`run: ${verifier}`);
  // sudo APT leaves root-owned downloads: even chmod-to-the-current-mode
  // fails as the runner. Keep the trusted post-install repair privileged.
  expect(steps[checks[1]]).toContain(`run: sudo ${verifier}`);
  expect(steps[install]).not.toContain('if:');
  expect(workflow).not.toMatch(
    /Sandbox::User|RUNNER_TEMP.*chmod|continue-on-error:/
  );
});

it('always cleans apt configuration and publishes only successful cache misses without racing writers', () => {
  const cleanup = steps.find((step) =>
    step.includes('name: Remove temporary apt configuration')
  )!;
  expect(cleanup).toContain('        if: always()');
  expect(cleanup).toContain(
    'run: sudo rm -f /etc/apt/apt.conf.d/99pali-playwright-cache'
  );
  const saves = steps.filter((step) =>
    step.includes('uses: actions/cache/save@')
  );
  expect(saves).toHaveLength(1);
  expect(saves[0]).toContain(
    "        if: success() && steps.apt-cache.outputs.cache-hit != 'true'"
  );
  expect(saves[0]).toContain(
    '          key: ${{ steps.apt-cache.outputs.cache-primary-key }}'
  );
  expect(workflow.match(/^    concurrency:/gm)).toHaveLength(1);
  expect(workflow).toContain('      group: playwright-download-caches-master');
  expect(workflow).toContain('      cancel-in-progress: false');
});
