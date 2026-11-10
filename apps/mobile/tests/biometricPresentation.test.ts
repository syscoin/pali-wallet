import assert from 'node:assert/strict';
import test from 'node:test';
import { describeBiometricHardware, detectBiometricPresentation, genericBiometrics } from '../src/core/biometricPresentation.ts';
import { screenFixture } from './screenFixture.ts';

for (const [platform, types, label, icon] of [
  ['ios', [2], 'Face ID', 'face-id'],
  ['ios', [1], 'Touch ID', 'fingerprint'],
  ['android', [1], 'fingerprint', 'fingerprint'],
] as const) test(`${platform} reports its real ${label} presentation`, async () => {
  let authenticated = 0;
  const api = { hasHardwareAsync: async () => true, supportedAuthenticationTypesAsync: async () => types,
    authenticateAsync: async () => { authenticated++; } };
  assert.deepEqual(await detectBiometricPresentation(platform, api), { label, icon });
  assert.equal(authenticated, 0, 'Display detection never authenticates');
});

test('ambiguous, unsupported, absent and failed detection keep generic presentation', async () => {
  for (const value of [[], [1, 2], [3], [7], ['2'], null])
    assert.strictEqual(describeBiometricHardware('ios', value), genericBiometrics);
  assert.strictEqual(describeBiometricHardware('android', [2]), genericBiometrics);
  assert.strictEqual(describeBiometricHardware('web', [1]), genericBiometrics);
  let reads = 0;
  const missing = { hasHardwareAsync: async () => false, supportedAuthenticationTypesAsync: async () => { reads++; return [2]; } };
  assert.strictEqual(await detectBiometricPresentation('ios', missing), genericBiometrics);
  assert.strictEqual(await detectBiometricPresentation('web', missing), genericBiometrics);
  assert.equal(reads, 0);
  assert.strictEqual(await detectBiometricPresentation('ios', { ...missing, hasHardwareAsync: async () => { throw Error('unavailable'); } }), genericBiometrics);
});

test('a late display result cannot update an unmounted hook', async () => {
  let finish!: (value: typeof genericBiometrics) => void;
  const pending = new Promise<typeof genericBiometrics>(resolve => { finish = resolve; });
  const fixture = screenFixture(new URL('../src/platform/useBiometricPresentation.ts', import.meta.url), 'useBiometricPresentation', {
    '../core/biometricPresentation': { genericBiometrics }, './biometricPresentation': { readBiometricPresentation: () => pending },
  });
  assert.strictEqual(fixture.render({}), genericBiometrics);
  fixture.close(); finish({ label: 'Face ID', icon: 'face-id' }); await pending; await Promise.resolve();
  assert.strictEqual(fixture.render({}), genericBiometrics);
});
