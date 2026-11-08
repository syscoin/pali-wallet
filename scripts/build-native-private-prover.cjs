// Builds only the isolated proof document/Workers. This is not a native app build.
// The proving key must already be present locally and match the shared engine pin.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const webpack = require('webpack');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'source/scripts/privacyProver');
const destination = path.join(
  root,
  'apps/mobile/modules/pali-private-prover/generated'
);
const digest = (bytes) =>
  crypto.createHash('sha256').update(bytes).digest('hex');

async function build() {
  const keyPath = process.argv[2];
  if (!keyPath || process.argv.length !== 3)
    throw new Error('Supply the local pinned proving key path');
  const pins = JSON.parse(
    await fs.readFile(path.join(source, 'assets/manifest.json'), 'utf8')
  );
  const key = await fs.readFile(path.resolve(keyPath));
  if (
    key.length !== pins.provingKey.bytes ||
    digest(key) !== pins.provingKey.sha256
  ) {
    throw new Error('Proving key pin mismatch');
  }
  const stage = await fs.mkdtemp(
    path.join(path.dirname(destination), '.proof-package-')
  );
  const packageRoot = path.join(stage, 'package');
  const output = path.join(packageRoot, 'pali-private-prover');
  try {
    const config = {
      mode: 'production',
      target: ['web', 'es2020'],
      entry: path.join(source, 'nativeEntry.ts'),
      output: {
        path: output,
        filename: 'host.js',
        chunkFilename: '[name].js',
        publicPath: 'auto',
        clean: true,
      },
      devtool: false,
      resolve: {
        extensions: ['.ts', '.js', '.json'],
        alias: {
          utils: path.join(root, 'source/utils'),
          scripts: path.join(root, 'source/scripts'),
        },
        fallback: { crypto: false, fs: false, path: false },
      },
      module: {
        rules: [
          {
            test: /\.ts$/,
            exclude: /node_modules/,
            use: {
              loader: require.resolve('babel-loader'),
              options: {
                babelrc: false,
                configFile: false,
                presets: [
                  [
                    require.resolve('@babel/preset-typescript'),
                    { allowDeclareFields: true },
                  ],
                ],
              },
            },
          },
        ],
      },
      optimization: { splitChunks: false, runtimeChunk: false },
      performance: false,
    };
    const compiler = webpack(config);
    await new Promise((resolve, reject) =>
      compiler.run((error, stats) => {
        compiler.close((closeError) => {
          if (error || closeError || stats?.hasErrors())
            reject(
              error ||
                closeError ||
                new Error(stats.toString({ all: false, errors: true }))
            );
          else resolve();
        });
      })
    );
    const artifactDir = path.join(output, 'assets/privacy-prover');
    await fs.mkdir(artifactDir, { recursive: true });
    for (const [name, pin] of [
      ['metadata.json.gz', pins.artifacts.metadata],
      ['groth16.wasm', pins.artifacts.wasm],
    ]) {
      const bytes = await fs.readFile(path.join(source, 'assets', name));
      if (bytes.length !== pin.bytes || digest(bytes) !== pin.sha256)
        throw new Error('Witness artifact pin mismatch');
      await fs.writeFile(path.join(artifactDir, name), bytes);
    }
    await fs.writeFile(path.join(artifactDir, 'tornadoProvingKey.bin'), key);
    await fs.writeFile(
      path.join(output, 'index.html'),
      '<!doctype html><meta charset="utf-8"><script src="host.js"></script>'
    );
    for (const name of ['COPYING', 'LICENSES.md'])
      await fs.copyFile(path.join(source, name), path.join(output, name));
    const manifest = {};
    async function collect(directory) {
      for (const entry of await fs.readdir(directory, {
        withFileTypes: true,
      })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await collect(file);
          continue;
        }
        if (!entry.isFile()) throw new Error('Unexpected proof package entry');
        const name = path.relative(output, file).split(path.sep).join('/');
        const bytes = await fs.readFile(file);
        const mime = name.endsWith('.html')
          ? 'text/html'
          : name.endsWith('.js')
          ? 'text/javascript'
          : 'application/octet-stream';
        manifest[name] = { bytes: bytes.length, sha256: digest(bytes), mime };
      }
    }
    await collect(output);
    if (Object.keys(manifest).length > 16)
      throw new Error('Proof package entry limit exceeded');
    await fs.writeFile(
      path.join(output, 'proof-assets.json'),
      JSON.stringify(manifest, null, 2) + '\n'
    );
    // Only replace this script's generated package after compilation and all pin checks succeed.
    const old = await fs.lstat(destination).catch(() => undefined);
    if (old?.isSymbolicLink())
      throw new Error('Generated package cannot be a symlink');
    const previous = path.join(stage, 'previous');
    if (old) await fs.rename(destination, previous);
    try {
      await fs.rename(packageRoot, destination);
    } catch (error) {
      if (old) await fs.rename(previous, destination);
      throw error;
    }
    process.stdout.write(
      'Bundled private proof assets verified and packaged\n'
    );
  } finally {
    key.fill(0);
    await fs.rm(stage, { recursive: true, force: true });
  }
}

build().catch(() => {
  process.stderr.write('Private proof packaging failed\n');
  process.exitCode = 1;
});
