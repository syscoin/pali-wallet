/** @jest-environment node */
/* eslint-disable @typescript-eslint/no-var-requires, camelcase */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const {
  buildExtension,
  parseArguments,
} = require('../../scripts/build-extension.cjs');
const {
  extensionBuildVersion,
} = require('../../source/config/extensionBuildVersion.cjs');
const roots: string[] = [];

afterEach(() => {
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true }));
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pali-extension-build-'));
  roots.push(root);
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ version: '4.0.121' })
  );
  writeFileSync(
    join(root, 'manifest.json'),
    'tracked manifest remains unchanged'
  );
  const receipt = {
    channel: 'canary',
    series: '5.0.0',
    buildNumber: 47,
    sourceRevision: 'a'.repeat(40),
    purpose: 'qa',
  };
  const reserve = jest.fn(async (options) => ({
    ...receipt,
    purpose: options.purpose,
  }));
  const assertSource = jest.fn(async () => undefined);
  const execute = jest.fn(
    async (script: string, _args: string[], env: NodeJS.ProcessEnv) => {
      const version = extensionBuildVersion(
        env.NODE_ENV,
        '4.0.121',
        env.PALI_CANARY_BUILD_NUMBER
      );
      if (script.endsWith('generateManifest.js')) {
        writeFileSync(env.PALI_EXTENSION_MANIFEST!, JSON.stringify(version));
      } else {
        mkdirSync(join(root, 'build/chrome'), { recursive: true });
        writeFileSync(
          join(root, 'build/chrome/manifest.json'),
          JSON.stringify(version)
        );
        writeFileSync(
          join(
            root,
            `build/pali-wallet-${env.NODE_ENV}-chrome-${version.version}.zip`
          ),
          'fixture archive'
        );
      }
    }
  );
  return {
    root,
    reserve,
    assertSource,
    execute,
    ports: { root, reserve, assertSource, execute },
  };
}

test('Canary reserves once and binds the manifest, ZIP, label and receipt to that number', async () => {
  const f = fixture();
  const result = await buildExtension(['canary', '--store'], f.ports);
  expect(f.reserve).toHaveBeenCalledTimes(1);
  expect(f.reserve).toHaveBeenCalledWith({
    cwd: f.root,
    channel: 'canary',
    series: '5.0.0',
    purpose: 'store',
  });
  expect(result.version).toBe('5.0.0.47');
  expect(result.version_name).toBe('5.0.0 Canary (47)');
  expect(f.execute.mock.calls[0][2]).toBe(f.execute.mock.calls[1][2]);
  expect(f.assertSource).toHaveBeenCalledTimes(3);
  expect(
    JSON.parse(
      readFileSync(join(f.root, '.pali-build/canary-5.0.0.47.json'), 'utf8')
    )
  ).toMatchObject({
    status: 'built',
    purpose: 'store',
    version: '5.0.0.47',
    sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
  });
  expect(readFileSync(join(f.root, 'manifest.json'), 'utf8')).toBe(
    'tracked manifest remains unchanged'
  );
  expect(existsSync(join(f.root, '.pali-build/extension-inflight'))).toBe(
    false
  );
});

test('production keeps its version and never allocates or inherits a Canary number', async () => {
  const f = fixture();
  const previous = process.env.PALI_CANARY_BUILD_NUMBER;
  process.env.PALI_CANARY_BUILD_NUMBER = '600';
  try {
    const result = await buildExtension(['production'], f.ports);
    expect(result).toMatchObject({ version: '4.0.121', receipt: null });
    expect(result.version_name).toBeUndefined();
    expect(f.reserve).not.toHaveBeenCalled();
    expect(f.execute.mock.calls[0][2].PALI_CANARY_BUILD_NUMBER).toBeUndefined();
    expect(
      JSON.parse(readFileSync(join(f.root, 'package.json'), 'utf8')).version
    ).toBe('4.0.121');
  } finally {
    if (previous === undefined) delete process.env.PALI_CANARY_BUILD_NUMBER;
    else process.env.PALI_CANARY_BUILD_NUMBER = previous;
  }
});

test('reservation failure stops before generating or building and releases the checkout lock', async () => {
  const f = fixture();
  f.reserve.mockRejectedValue(Error('counter unavailable'));
  await expect(buildExtension(['canary'], f.ports)).rejects.toThrow(
    'counter unavailable'
  );
  expect(f.execute).not.toHaveBeenCalled();
  expect(existsSync(join(f.root, '.pali-build/extension-inflight'))).toBe(
    false
  );
});

test('failed compilation retains the reservation and blocks reuse of that receipt', async () => {
  const f = fixture();
  const original = f.execute.getMockImplementation()!;
  f.execute.mockImplementation(async (...args) => {
    if (args[0].endsWith('cli.js')) throw Error('compilation failed');
    await original(...args);
  });
  await expect(buildExtension(['canary'], f.ports)).rejects.toThrow(
    'compilation failed'
  );
  expect(
    JSON.parse(
      readFileSync(join(f.root, '.pali-build/canary-5.0.0.47.json'), 'utf8')
    ).status
  ).toBe('reserved');
  expect(existsSync(join(f.root, '.pali-build/extension-inflight'))).toBe(
    false
  );
  await expect(buildExtension(['canary'], f.ports)).rejects.toMatchObject({
    code: 'EEXIST',
  });
});

test('an overlapping production build cannot overwrite an in-flight Canary manifest or artifacts', async () => {
  const f = fixture();
  let unblock!: () => void;
  const blocked = new Promise<void>((resolveBlocked) => {
    unblock = resolveBlocked;
  });
  const original = f.execute.getMockImplementation()!;
  f.execute.mockImplementation(async (...args) => {
    if (args[0].endsWith('generateManifest.js')) await blocked;
    await original(...args);
  });
  const first = buildExtension(['canary'], f.ports);
  await new Promise((resolveTick) => setImmediate(resolveTick));
  await expect(buildExtension(['production'], f.ports)).rejects.toThrow(
    'Another extension build owns'
  );
  unblock();
  await first;
  expect(f.reserve).toHaveBeenCalledTimes(1);
});

test.each(['generated', 'packaged'])(
  'rejects a mismatched %s manifest',
  async (stage) => {
    const f = fixture();
    const original = f.execute.getMockImplementation()!;
    f.execute.mockImplementation(async (...args) => {
      await original(...args);
      const generating = args[0].endsWith('generateManifest.js');
      if ((stage === 'generated') === generating)
        writeFileSync(
          generating
            ? args[2].PALI_EXTENSION_MANIFEST!
            : join(f.root, 'build/chrome/manifest.json'),
          JSON.stringify({ version: '4.0.121' })
        );
    });
    await expect(buildExtension(['canary'], f.ports)).rejects.toThrow(
      /does not match/
    );
    expect(
      JSON.parse(
        readFileSync(join(f.root, '.pali-build/canary-5.0.0.47.json'), 'utf8')
      ).status
    ).toBe('reserved');
  }
);

test.each(
  [
    [],
    ['canary', '--version', '5.0.0.99'],
    ['production', '--store'],
    ['canary', '--store', '--store'],
  ].map((args) => [args])
)('rejects unsupported build arguments %j before allocation', (args) => {
  expect(() => parseArguments(args)).toThrow('Usage:');
});

test.each([undefined, 0, '01', 65536, '5.0.0.1'])(
  'rejects invalid Canary suffix %s',
  (value) => {
    expect(() => extensionBuildVersion('canary', '4.0.121', value)).toThrow(
      'INVALID_BUILD_NUMBER'
    );
  }
);

test('real manifest generator uses an isolated file and exact Chrome-compatible Canary version', () => {
  const f = fixture();
  const output = join(f.root, 'generated.json');
  const tracked = readFileSync(resolve('manifest.json'));
  execFileSync(
    process.execPath,
    [resolve('source/config/generateManifest.js')],
    {
      cwd: resolve('.'),
      env: {
        ...process.env,
        NODE_ENV: 'canary',
        MANIFEST_TYPE: 'MV3',
        PALI_CANARY_BUILD_NUMBER: '65535',
        PALI_EXTENSION_MANIFEST: output,
      },
    }
  );
  expect(JSON.parse(readFileSync(output, 'utf8'))).toMatchObject({
    name: 'Pali Wallet Canary',
    version: '5.0.0.65535',
    version_name: '5.0.0 Canary (65535)',
  });
  expect(readFileSync(resolve('manifest.json')).equals(tracked)).toBe(true);
});
