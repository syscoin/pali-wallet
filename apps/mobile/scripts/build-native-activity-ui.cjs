const path = require('node:path');
const { spawnSync } = require('node:child_process');
const mobileRoot = path.resolve(__dirname, '..');
const result = spawnSync(process.execPath, [require.resolve('expo/bin/cli'), 'export', '--platform', 'web', '--output-dir', path.join(mobileRoot, 'dist-native-activity-ui'), '--max-workers', '1'], {
  cwd: path.join(mobileRoot, 'tests/native-activity-ui'), stdio: 'inherit', env: { ...process.env, EXPO_NO_TELEMETRY: '1', EXPO_NO_DOTENV: '1' },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
