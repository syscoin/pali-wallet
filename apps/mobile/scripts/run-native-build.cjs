const fs = require('node:fs');
const path = require('node:path');
const { runOwnedBuildChild, interruptedError } = require('./owned-build-child.cjs');
const { reserveBuildNumber, assertBuildSource } = require('../../../scripts/build-number.cjs');

const appRoot = path.resolve(__dirname, '..');

function parseArguments(argv) {
  const [platform, ...rest] = argv;
  const prepareOnly = rest.includes('--prepare-only');
  const purpose = rest.includes('--store') ? 'store' : 'qa';
  const forwarded = rest.filter(value => value !== '--prepare-only' && value !== '--store');
  if (!['ios', 'android', 'all'].includes(platform) ||
      platform === 'all' && !prepareOnly || purpose === 'store' && !prepareOnly ||
      prepareOnly && forwarded.length)
    throw Error('Usage: run-native-build.cjs ios|android [Expo run arguments], or all|ios|android --prepare-only [--store]');
  const flags = new Set(['--no-build-cache', '--no-install', '--no-bundler', ...(platform === 'android' ? ['--all-arch'] : [])]);
  const values = new Set(['--port', '-p', ...(platform === 'ios' ? ['--configuration', '--output', '-o'] : ['--variant'])]);
  for (let index = 0; index < forwarded.length; index++) {
    const flag = forwarded[index];
    if (flags.has(flag)) continue;
    if (flag === '--device' || flag === '-d') {
      if (forwarded[index + 1] && !forwarded[index + 1].startsWith('-')) index++;
      continue;
    }
    if (!values.has(flag) || !forwarded[index + 1] || forwarded[index + 1].startsWith('-'))
      throw Error(`Unsupported native build argument: ${flag}`);
    const value = forwarded[++index];
    if ((flag === '--port' || flag === '-p') && (!/^[1-9][0-9]*$/.test(value) || Number(value) > 65535) ||
        flag === '--configuration' && !['Debug', 'Release'].includes(value) ||
        flag === '--variant' && !['debug', 'release'].includes(value))
      throw Error(`Invalid native build argument: ${flag}`);
  }
  return { platform, prepareOnly, purpose, forwarded };
}

async function runNativeBuild(argv, ports = {}) {
  const options = parseArguments(argv);
  const root = ports.appRoot ?? appRoot;
  const stateDirectory = path.join(root, '.pali-build');
  const lockDirectory = path.join(stateDirectory, 'inflight');
  fs.mkdirSync(stateDirectory, { recursive: true });
  try { fs.mkdirSync(lockDirectory); }
  catch (error) {
    if (error.code === 'EEXIST') throw Error(`Another native build owns ${lockDirectory}. Check owner.json before removing an abandoned lock.`);
    throw error;
  }
  const cancellation = new AbortController();
  const interrupt = signal => { if (!cancellation.signal.aborted) cancellation.abort(signal); };
  const onInterrupt = () => interrupt('SIGINT');
  const onTerminate = () => interrupt('SIGTERM');
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);
  const checkpoint = () => { if (cancellation.signal.aborted) throw interruptedError(cancellation.signal.reason); };
  let preserveLock = false;
  try {
    fs.writeFileSync(path.join(lockDirectory, 'owner.json'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
    if (app.version !== pkg.version || app.ios?.bundleIdentifier !== 'com.paliwallet.mobile' ||
        app.android?.package !== 'com.paliwallet.mobile')
      throw Error('Native build requires the matching Pali app version and production identity.');

    checkpoint();
    const receipt = await (ports.reserve ?? reserveBuildNumber)({ cwd: root, purpose: options.purpose, channel: 'mobile' });
    const assertCurrent = async () => {
      checkpoint();
      await (ports.assertSource ?? assertBuildSource)({ cwd: root, receipt });
      checkpoint();
    };
    const destination = path.join(stateDirectory, `build-${receipt.buildNumber}.json`);
    fs.writeFileSync(destination, `${JSON.stringify({ ...receipt, marketingVersion: app.version, platform: options.platform, preparedOnly: options.prepareOnly }, null, 2)}\n`, { flag: 'wx' });
    const env = { ...process.env, EXPO_NO_TELEMETRY: '1', PALI_MOBILE_BUILD_NUMBER: String(receipt.buildNumber) };
    const child = (script, args) => runOwnedBuildChild(process.execPath, [script, ...args], { cwd: root, env, signal: cancellation.signal });
    const prepareAssets = ports.prepareAssets ?? (async () => {
      const result = await child(path.resolve(root, '../../scripts/prepare-native-private-prover.cjs'), ['--app']);
      if (result.code !== 0) throw Error('Native proof-asset preparation failed.');
    });
    const execute = ports.execute ?? (async args => {
      const cli = path.join(path.dirname(require.resolve('expo/package.json')), 'bin', 'cli');
      const result = await child(cli, args);
      if (result.code !== 0) throw Error(`Expo ${args[0]} failed; build ${receipt.buildNumber} remains reserved.`);
    });
    console.log(`Pali ${app.version} (${receipt.buildNumber}) · ${options.purpose}; receipt: ${destination}`);
    await assertCurrent();
    await prepareAssets();
    await assertCurrent();
    await execute(['prebuild', '--platform', options.platform, '--no-install', '--no-clean'], env);
    await assertCurrent();
    if (!options.prepareOnly) {
      await execute([`run:${options.platform}`, ...options.forwarded], env);
      checkpoint();
    }
    return receipt;
  } catch (error) {
    preserveLock = error.preserveLock === true;
    if (preserveLock) error.message += ` Lock retained at ${lockDirectory}; verify the owned build has stopped before removing it.`;
    throw error;
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
    if (!preserveLock) fs.rmSync(lockDirectory, { recursive: true });
  }
}

module.exports = { parseArguments, runNativeBuild };
if (require.main === module) runNativeBuild(process.argv.slice(2)).catch(error => {
  console.error(error.message);
  process.exitCode = error.exitCode ?? 1;
});
