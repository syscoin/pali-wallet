import fs from 'fs';
import path from 'path';
import vm from 'vm';

const scriptPath = path.resolve(
  __dirname,
  '../../scripts/generate-pali-deployment.cjs'
);
const script = fs.readFileSync(scriptPath, 'utf8');
const pin = `0x${'ab'.repeat(32)}`;
const wrongPin = `0x${'cd'.repeat(32)}`;
const ids = [
  'compositeValidator',
  'ecdsaValidator',
  'guardianRecoveryModule',
  'p256WebAuthnValidator',
  'slhDsaValidator',
  'slhDsaVerifier',
  'accountImplementation',
  'factory',
];

function run({
  entries,
  guardianPin = pin,
  write = false,
}: {
  entries?: string;
  guardianPin?: string | null;
  write?: boolean;
} = {}) {
  const source = `
    const PALI_CREATE2_DEPLOYER_ADDRESS = '0x${'11'.repeat(20)}';
    const PALI_CANONICAL_ENTRYPOINT_ADDRESS = '0x${'22'.repeat(20)}';
    const PALI_INFRASTRUCTURE_VERSION = 'fixture';
    const slhDsaVerifierCodeHash = '${pin}';
    const bytecodes = {${ids.map((id) => `${id}:\n'0x01'`).join(',')}};
    const entries = [${
      entries ??
      `
      { id: 'other', runtimeCodeHash: '${pin}', salt: otherSalt },
      { id: 'guardianRecoveryModule',
        ${guardianPin === null ? '' : `runtimeCodeHash: '${guardianPin}',`}
        salt: guardianRecoveryModuleSalt,
      }
    `
    }];
  `;
  const writes: string[] = [];
  const stdout: string[] = [];
  let error: Error | undefined;
  const fakeFs = {
    readFileSync: (file: string) => {
      if (file.endsWith('/deployment.ts')) return source;
      if (file.endsWith('/contracts.ts'))
        return "const PALI_SMART_ACCOUNT_VERSION = 'fixture';";
      return JSON.stringify({
        bytecode: { object: '0x01' },
        deployedBytecode: { object: '0x02' },
      });
    },
    writeFileSync: (_file: string, content: string) => writes.push(content),
  };
  const fakeProcess = {
    argv: [
      'node',
      scriptPath,
      '--contracts-root',
      '/fixture',
      ...(write ? ['--write'] : []),
    ],
    stdout: { write: (value: string) => stdout.push(value) },
    exitCode: 0,
  };
  try {
    vm.runInNewContext(script, {
      __dirname: path.dirname(scriptPath),
      process: fakeProcess,
      require: (name: string) => {
        if (name === 'node:fs') return fakeFs;
        if (name === 'node:path') return path;
        if (name === 'node:child_process')
          return {
            execFileSync: (_command: string, args: string[]) => {
              if (args[0] !== 'keccak') return `0x${'33'.repeat(20)}`;
              return args[1] === '0x02' ? pin : wrongPin;
            },
          };
        throw new Error(`Unexpected dependency: ${name}`);
      },
    });
  } catch (caught) {
    error = caught as Error;
  }
  return { error, source, writes, stdout };
}

test.each([false, true])(
  'rejects a changed guardian runtime before any write (write=%s)',
  (write) => {
    const result = run({ guardianPin: wrongPin, write });
    expect(result.error?.message).toMatch(
      /runtime changed; review its storage layout/
    );
    expect(result.writes).toEqual([]);
  }
);

test.each([false, true])(
  'rejects a missing guardian pin without accepting another contract pin (write=%s)',
  (write) => {
    const result = run({ guardianPin: null, write });
    expect(result.error?.message).toMatch(/Missing explicit guardian recovery/);
    expect(result.writes).toEqual([]);
  }
);

test('check mode permits matching guardian runtime without writing', () => {
  const result = run();
  expect(result.error).toBeUndefined();
  expect(result.writes).toEqual([]);
});

test('write mode preserves the explicitly reviewed runtime pin', () => {
  const result = run({ write: true });
  expect(result.error).toBeUndefined();
  expect(result.writes).toHaveLength(1);
  expect(result.writes[0]).toContain(`runtimeCodeHash: '${pin}'`);
});

test.each([
  [
    'duplicate guardian records',
    `
    { id: 'guardianRecoveryModule', runtimeCodeHash: '${pin}', salt: guardianRecoveryModuleSalt, },
    { id: 'guardianRecoveryModule', runtimeCodeHash: '${pin}', salt: guardianRecoveryModuleSalt, },
  `,
  ],
  [
    'duplicate runtime fields',
    `
    { id: 'guardianRecoveryModule', runtimeCodeHash: '${pin}', runtimeCodeHash: '${wrongPin}', salt: guardianRecoveryModuleSalt, },
  `,
  ],
  [
    'a quoted duplicate runtime field',
    `
    { id: 'guardianRecoveryModule', runtimeCodeHash: '${pin}', 'runtimeCodeHash': '${wrongPin}', salt: guardianRecoveryModuleSalt, },
  `,
  ],
  [
    'a pin in the next object',
    `
    { id: 'guardianRecoveryModule', salt: otherSalt, },
    { id: 'other', runtimeCodeHash: '${pin}', salt: guardianRecoveryModuleSalt, },
  `,
  ],
  [
    'a commented pin',
    `
    { id: 'guardianRecoveryModule', /* runtimeCodeHash: '${pin}', */ salt: guardianRecoveryModuleSalt, },
  `,
  ],
  [
    'a commented guardian record',
    `
    /* { id: 'guardianRecoveryModule', runtimeCodeHash: '${pin}', salt: guardianRecoveryModuleSalt, } */
    { id: 'guardianRecoveryModule', salt: guardianRecoveryModuleSalt, },
  `,
  ],
  [
    'a malformed runtime pin',
    `
    { id: 'guardianRecoveryModule', runtimeCodeHash: '${pin}00', salt: guardianRecoveryModuleSalt, },
  `,
  ],
  [
    'duplicate id fields',
    `
    { id: 'guardianRecoveryModule', id: 'other', runtimeCodeHash: '${pin}', salt: guardianRecoveryModuleSalt, },
  `,
  ],
  [
    'duplicate salt fields',
    `
    { id: 'guardianRecoveryModule', runtimeCodeHash: '${pin}', salt: guardianRecoveryModuleSalt, salt: otherSalt, },
  `,
  ],
])('rejects %s before writing', (_description, entries) => {
  const result = run({ entries, write: true });
  expect(result.error?.message).toMatch(/Missing explicit guardian recovery/);
  expect(result.writes).toEqual([]);
});
