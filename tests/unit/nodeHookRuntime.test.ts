/** @jest-environment node */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const repository = resolve(__dirname, '../..');
const roots: string[] = [];
const hooks = [
  ['pre-commit', 'lint-staged'],
  ['pre-push', 'type-check'],
] as const;

afterEach(() => {
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true }));
});

function fixture(script = true) {
  const root = mkdtempSync(join(tmpdir(), 'pali-node-hook-'));
  roots.push(root);
  const bin = join(root, 'bin');
  const nvm = join(root, 'nvm');
  const log = join(root, 'commands.log');
  for (const directory of [bin, nvm, join(root, '.husky/_')])
    mkdirSync(directory, { recursive: true });
  for (const file of [
    '.nvmrc',
    '.husky/use-pinned-node.sh',
    ...hooks.map(([hook]) => `.husky/${hook}`),
  ])
    writeFileSync(join(root, file), readFileSync(join(repository, file)));
  // The actual Husky wrapper re-executes hooks with -e; invoke that same inner shell directly.
  writeFileSync(join(root, '.husky/_/husky.sh'), '# fixture bootstrap\n');
  writeFileSync(
    join(bin, 'node'),
    `#!/bin/sh
case "$1" in --version|-v) printf '%s\\n' "$PALI_HOOK_TEST_NODE_VERSION" ;; *) exit 31 ;; esac
`,
    { mode: 0o755 }
  );
  writeFileSync(
    join(bin, 'yarn'),
    `#!/bin/sh
printf 'yarn:%s:node:%s\\n' "$*" "$PALI_HOOK_TEST_NODE_VERSION" >> "$PALI_HOOK_TEST_LOG"
exit "$PALI_HOOK_TEST_CHECK_EXIT"
`,
    { mode: 0o755 }
  );
  if (script)
    writeFileSync(
      join(nvm, 'nvm.sh'),
      `printf 'source:%s\\n' "$*" >> "$PALI_HOOK_TEST_LOG"
[ "$*" = '--no-use' ] || return 19
nvm() {
  printf 'nvm:%s\\n' "$*" >> "$PALI_HOOK_TEST_LOG"
  [ "$*" = 'use' ] || return 21
  [ "$PALI_HOOK_TEST_NVM_AVAILABLE" = 'yes' ] || return 3
  export PALI_HOOK_TEST_NODE_VERSION="$PALI_HOOK_TEST_NVM_RESULT"
}
`
    );
  return {
    run(hook: string, overrides: NodeJS.ProcessEnv = {}, shell = '/bin/sh') {
      const result = spawnSync(shell, ['-e', join(root, '.husky', hook)], {
        cwd: root,
        encoding: 'utf8',
        timeout: 5000,
        env: {
          ...process.env,
          PATH: `${bin}${delimiter}${process.env.PATH}`,
          NVM_DIR: nvm,
          PALI_HOOK_TEST_LOG: log,
          PALI_HOOK_TEST_NODE_VERSION: 'v26.12.1',
          PALI_HOOK_TEST_NVM_AVAILABLE: 'no',
          PALI_HOOK_TEST_NVM_RESULT: 'v26.12.1',
          PALI_HOOK_TEST_CHECK_EXIT: '0',
          ...overrides,
        },
      });
      return {
        ...result,
        commands: existsSync(log)
          ? readFileSync(log, 'utf8').trim().split('\n')
          : [],
      };
    },
  };
}

it.each(hooks)(
  '%s keeps an already-pinned Node and still runs %s',
  (hook, task) => {
    const result = fixture().run(hook);
    expect(result.status).toBe(0);
    expect(result.commands).toEqual([`yarn:${task}:node:v26.12.1`]);
  }
);

it.each(['/bin/sh', '/bin/dash'].filter(existsSync))(
  'loads NVM without its default version and verifies the switch in %s',
  (shell) => {
    const result = fixture().run(
      'pre-push',
      {
        PALI_HOOK_TEST_NODE_VERSION: 'v24.0.0',
        PALI_HOOK_TEST_NVM_AVAILABLE: 'yes',
      },
      shell
    );
    expect(result.status).toBe(0);
    expect(result.commands).toEqual([
      'source:--no-use',
      'nvm:use',
      'yarn:type-check:node:v26.12.1',
    ]);
  }
);

it.each(['missing-script', 'missing-version', 'wrong-result'])(
  'refuses %s before running checks on the wrong Node',
  (failure) => {
    const result = fixture(failure !== 'missing-script').run('pre-push', {
      PALI_HOOK_TEST_NODE_VERSION: 'v24.0.0',
      PALI_HOOK_TEST_NVM_AVAILABLE: failure === 'wrong-result' ? 'yes' : 'no',
      PALI_HOOK_TEST_NVM_RESULT: 'v24.0.0',
    });
    expect(result.status).not.toBe(0);
    expect(result.commands.some((command) => command.startsWith('yarn:'))).toBe(
      false
    );
  }
);

it.each(hooks)('%s propagates a failing %s check', (hook, task) => {
  const result = fixture().run(hook, { PALI_HOOK_TEST_CHECK_EXIT: '42' });
  expect(result.status).toBe(42);
  expect(result.commands).toEqual([`yarn:${task}:node:v26.12.1`]);
});
