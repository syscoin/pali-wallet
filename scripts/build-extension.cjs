const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { reserveBuildNumber, assertBuildSource } = require('./build-number.cjs');
const {
  extensionBuildVersion,
  CANARY_BASE_VERSION,
} = require('../source/config/extensionBuildVersion.cjs');

const repositoryRoot = path.resolve(__dirname, '..');

function parseArguments(argv) {
  const [channel, ...flags] = argv;
  if (
    !['production', 'canary'].includes(channel) ||
    flags.length > 1 ||
    flags.some((flag) => flag !== '--store') ||
    (channel === 'production' && flags.length)
  )
    throw Error(
      'Usage: build-extension.cjs production|canary [--store (Canary only)]'
    );
  return { channel, purpose: flags.length ? 'store' : 'qa' };
}

async function buildExtension(argv, ports = {}) {
  const options = parseArguments(argv);
  const root = ports.root ?? repositoryRoot;
  const directory = path.join(root, '.pali-build');
  const lock = path.join(directory, 'extension-inflight');
  fs.mkdirSync(directory, { recursive: true });
  try {
    fs.mkdirSync(lock);
  } catch (error) {
    if (error.code === 'EEXIST')
      throw Error(
        `Another extension build owns ${lock}. Check owner.json before removing an abandoned lock.`
      );
    throw error;
  }
  try {
    fs.writeFileSync(
      path.join(lock, 'owner.json'),
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })
    );
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8')
    );
    const receipt =
      options.channel === 'canary'
        ? await (ports.reserve ?? reserveBuildNumber)({
            cwd: root,
            purpose: options.purpose,
            channel: 'canary',
            series: CANARY_BASE_VERSION,
          })
        : null;
    const version = extensionBuildVersion(
      options.channel,
      pkg.version,
      receipt?.buildNumber
    );
    const manifestFile = path.join(lock, 'manifest.json');
    const artifact = path.join(
      root,
      'build',
      `pali-wallet-${options.channel}-chrome-${version.version}.zip`
    );
    const receiptFile =
      receipt && path.join(directory, `canary-${version.version}.json`);
    const record = receipt && {
      ...receipt,
      ...version,
      artifact,
      status: 'reserved',
    };
    if (receiptFile)
      fs.writeFileSync(receiptFile, `${JSON.stringify(record, null, 2)}\n`, {
        flag: 'wx',
      });
    const env = {
      ...process.env,
      NODE_ENV: options.channel,
      TARGET_BROWSER: 'chrome',
      PALI_EXTENSION_MANIFEST: manifestFile,
    };
    // An inherited number must never select an unrelated build.
    delete env.PALI_CANARY_BUILD_NUMBER;
    env.PALI_EXTENSION_STORE_BUILD = options.purpose === 'store' ? '1' : '0';
    if (receipt) env.PALI_CANARY_BUILD_NUMBER = String(receipt.buildNumber);
    const execute =
      ports.execute ??
      ((script, args) => {
        const result = spawnSync(process.execPath, [script, ...args], {
          cwd: root,
          env,
          stdio: 'inherit',
        });
        if (result.error || result.status !== 0)
          throw Error(
            `Extension build failed; any allocated Canary number remains reserved.`
          );
      });
    const assertSource = async () => {
      if (receipt)
        await (ports.assertSource ?? assertBuildSource)({ cwd: root, receipt });
    };
    await assertSource();
    await execute(
      path.join(root, 'source/config/generateManifest.js'),
      [],
      env
    );
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    if (
      manifest.version !== version.version ||
      manifest.version_name !== version.version_name
    )
      throw Error(
        'Generated extension version does not match the reserved build.'
      );
    await assertSource();
    await execute(
      path.join(root, 'node_modules/webpack-cli/bin/cli.js'),
      ['--config', 'source/config/webpack.prod.js'],
      env
    );
    await assertSource();
    const packaged = JSON.parse(
      fs.readFileSync(path.join(root, 'build/chrome/manifest.json'), 'utf8')
    );
    if (
      packaged.version !== version.version ||
      packaged.version_name !== version.version_name
    )
      throw Error(
        'Packaged extension version does not match the reserved build.'
      );
    const bytes = fs.readFileSync(artifact);
    if (!bytes.length) throw Error('Extension archive is empty.');
    if (receiptFile)
      fs.writeFileSync(
        receiptFile,
        `${JSON.stringify(
          {
            ...record,
            status: 'built',
            sha256: createHash('sha256').update(bytes).digest('hex'),
          },
          null,
          2
        )}\n`
      );
    console.log(`Pali ${version.version_name ?? version.version}: ${artifact}`);
    return { ...version, artifact, receipt };
  } finally {
    fs.rmSync(lock, { recursive: true });
  }
}

module.exports = { parseArguments, buildExtension };
if (require.main === module)
  buildExtension(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
