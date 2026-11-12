/** @jest-environment node */
/* eslint-disable @typescript-eslint/no-var-requires, camelcase */
import { execFileSync, spawnSync } from 'node:child_process';
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

function fixture(packageVersion = '5.0.0') {
  const root = mkdtempSync(join(tmpdir(), 'pali-extension-build-'));
  roots.push(root);
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ version: packageVersion })
  );
  writeFileSync(
    join(root, 'manifest.json'),
    'tracked manifest remains unchanged'
  );
  const receipt = {
    channel: 'canary',
    series: packageVersion,
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
        packageVersion,
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
  expect(f.execute.mock.calls[0][2].PALI_EXTENSION_STORE_BUILD).toBe('1');
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
  const f = fixture('4.0.121');
  const previous = process.env.PALI_CANARY_BUILD_NUMBER;
  const previousStore = process.env.PALI_EXTENSION_STORE_BUILD;
  process.env.PALI_CANARY_BUILD_NUMBER = '600';
  process.env.PALI_EXTENSION_STORE_BUILD = '1';
  try {
    const result = await buildExtension(['production'], f.ports);
    expect(result).toMatchObject({ version: '4.0.121', receipt: null });
    expect(result.version_name).toBeUndefined();
    expect(f.reserve).not.toHaveBeenCalled();
    expect(f.execute.mock.calls[0][2].PALI_CANARY_BUILD_NUMBER).toBeUndefined();
    expect(f.execute.mock.calls[0][2].PALI_EXTENSION_STORE_BUILD).toBe('0');
    expect(
      JSON.parse(readFileSync(join(f.root, 'package.json'), 'utf8')).version
    ).toBe('4.0.121');
  } finally {
    if (previous === undefined) delete process.env.PALI_CANARY_BUILD_NUMBER;
    else process.env.PALI_CANARY_BUILD_NUMBER = previous;
    if (previousStore === undefined)
      delete process.env.PALI_EXTENSION_STORE_BUILD;
    else process.env.PALI_EXTENSION_STORE_BUILD = previousStore;
  }
});

test('an upgrade-test version selects its own series without publishing production', async () => {
  const f = fixture('5.0.1');
  const result = await buildExtension(['canary'], f.ports);
  expect(f.reserve).toHaveBeenCalledWith({
    cwd: f.root,
    channel: 'canary',
    series: '5.0.1',
    purpose: 'qa',
  });
  expect(result.version).toBe('5.0.1.47');
  expect(result.version_name).toBe('5.0.1 Canary (47)');
  expect(result.artifact).toMatch(
    /pali-wallet-canary-chrome-5\.0\.1\.47\.zip$/
  );
});

test.each(['5.0.1-dev', '5.0', '5.0.1.2', '05.0.1', '65536.0.1'])(
  'refuses a non-Store numeric base %s',
  (version) => {
    expect(() => extensionBuildVersion('canary', version, 1)).toThrow(
      'INVALID_SERIES'
    );
  }
);

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

test.each([false, true])(
  'real generator isolates the manifest and excludes local keys from store builds (%s)',
  (store) => {
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
          PALI_EXTENSION_STORE_BUILD: store ? '1' : '0',
        },
      }
    );
    expect(JSON.parse(readFileSync(output, 'utf8'))).toMatchObject({
      name: 'Pali Wallet Canary BETA',
      version: '5.0.0.65535',
      version_name: '5.0.0 Canary (65535)',
    });
    const manifest = JSON.parse(readFileSync(output, 'utf8'));
    expect(manifest.description).toMatch(
      /^THIS EXTENSION IS FOR BETA TESTING\./
    );
    expect(manifest.description.length).toBeLessThanOrEqual(132);
    if (store) expect(manifest).not.toHaveProperty('key');
    else expect(manifest.key).toMatch(/^MIIB/);
    expect(readFileSync(resolve('manifest.json')).equals(tracked)).toBe(true);
  }
);

test('both manifest templates and the committed manifest follow the package release fields', () => {
  const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
  const { MV2_OPTIONS, MV3_OPTIONS } = require('../../source/config/consts.js');
  const committed = JSON.parse(readFileSync(resolve('manifest.json'), 'utf8'));
  for (const manifest of [MV2_OPTIONS, MV3_OPTIONS, committed]) {
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.description).toBe(pkg.description);
  }
  expect(pkg.description.length).toBeLessThanOrEqual(132);
});

test.each(['development', 'production'])(
  'the real %s generator labels development without changing the numeric release version',
  (mode) => {
    const f = fixture();
    const output = join(f.root, 'generated.json');
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
    execFileSync(
      process.execPath,
      [resolve('source/config/generateManifest.js')],
      {
        cwd: resolve('.'),
        env: {
          ...process.env,
          NODE_ENV: mode,
          MANIFEST_TYPE: 'MV3',
          PALI_EXTENSION_MANIFEST: output,
        },
      }
    );
    const manifest = JSON.parse(readFileSync(output, 'utf8'));
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.description).toBe(pkg.description);
    expect(manifest.version_name).toBe(
      mode === 'development' ? `${pkg.version} Development` : undefined
    );
    expect(manifest.permissions.includes('webRequest')).toBe(
      mode === 'development'
    );
  }
);

test.each([false, true])(
  'the development package command uses the platform shell without nested quotes (generation fails: %s)',
  (failGeneration) => {
    const f = fixture();
    const bin = join(f.root, 'node_modules/.bin');
    const scripts = join(f.root, 'scripts with spaces');
    mkdirSync(bin, { recursive: true });
    mkdirSync(scripts);
    mkdirSync(join(f.root, 'source/config'), { recursive: true });
    const eventScript = `
      require('node:fs').appendFileSync('events.jsonl', JSON.stringify({
        step: process.env.PALI_COMMAND_STEP || 'generate',
        mode: process.env.NODE_ENV, browser: process.env.TARGET_BROWSER,
        args: process.argv.slice(2)
      }) + '\\n');
    `;
    writeFileSync(
      join(f.root, 'source/config/generateManifest.js'),
      eventScript + (failGeneration ? 'process.exit(7);' : '')
    );
    const webpack = join(scripts, 'webpack.cjs');
    writeFileSync(
      webpack,
      `process.env.PALI_COMMAND_STEP = 'webpack';\n${eventScript}`
    );
    for (const [name, target] of [
      ['cross-env', require.resolve('cross-env/src/bin/cross-env.js')],
      ['webpack', webpack],
    ]) {
      writeFileSync(
        join(bin, name),
        `#!/usr/bin/env node\nrequire(${JSON.stringify(target)});\n`,
        { mode: 0o755 }
      );
      writeFileSync(
        join(bin, `${name}.cmd`),
        `@"${process.execPath}" "${target}" %*\r\n`
      );
    }
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'canary',
      TARGET_BROWSER: 'firefox',
    };
    const pathKey =
      Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'PATH';
    env[pathKey] = `${bin}${process.platform === 'win32' ? ';' : ':'}${
      env[pathKey] || ''
    }`;
    const command = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
      .scripts['dev:chrome'];
    const result = spawnSync(command, {
      shell: true,
      cwd: f.root,
      env,
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(failGeneration ? 7 : 0);
    const events = readFileSync(join(f.root, 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(events).toEqual([
      { step: 'generate', mode: 'development', browser: 'chrome', args: [] },
      ...(failGeneration
        ? []
        : [
            {
              step: 'webpack',
              mode: 'development',
              browser: 'chrome',
              args: ['--config', 'source/config/webpack.dev.js', '--watch'],
            },
          ]),
    ]);
  }
);
