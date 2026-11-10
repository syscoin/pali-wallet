import assert from 'node:assert/strict';
import test from 'node:test';
import { OperationAuthentication } from '../src/core/operationAuthentication.ts';
import type { NativeOperationCredentialVerification } from '../src/custody/types.ts';
import { screenElements, screenFixture } from './screenFixture.ts';

const request = { id: 'owned-operation', purpose: 'account-change' as const, biometricsEnabled: true };
function fixture() {
  const broker = new OperationAuthentication();
  let listener: ((state: string) => void) | undefined;
  let protectedPrompt = false;
  const view = screenFixture(new URL('../src/screens/NativeOperationAuthentication.tsx', import.meta.url), 'NativeOperationAuthentication', {
    'react-native': { AppState: { addEventListener(_event: string, callback: (state: string) => void) { listener = callback; return { remove() { listener = undefined; } }; } } },
    '../platform/operationAuthentication': { nativeOperationAuthentication: broker },
    './TransactionAuthentication': { TransactionAuthentication: 'Authentication' },
    '../platform/useBiometricPresentation': { useBiometricPresentation: () => ({ label: 'Face ID', icon: 'face-id' }) },
  });
  const render = () => view.render({ isProtectedPromptActive: () => protectedPrompt });
  render();
  return { broker, render, close: view.close,
    emit(state: string) { listener?.(state); },
    protect(value: boolean) { protectedPrompt = value; },
    page() { const page = screenElements(render()).find(value => value.type === 'Authentication'); assert(page); return page; } };
}

test('common authorization keeps one Face ID page through owned interruption and PIN fallback', async () => {
  const f = fixture(), held = Promise.withResolvers<NativeOperationCredentialVerification>();
  let checks = 0;
  const pending = f.broker.request(request, new AbortController().signal, () => { checks++; }, async (credential, check) => {
    check(); return credential.method === 'biometric' ? held.promise : { accepted: true };
  });
  const initial = f.page();
  assert.equal(initial.props.method, 'biometric');
  initial.props.onConfirm({ method: 'biometric' });
  assert.equal(f.page().props.busy, true);
  f.protect(true); f.emit('inactive');
  held.resolve({ accepted: false, reason: 'DEVICE_UNLOCK_UNAVAILABLE' });
  await held.promise; await new Promise(resolve => setImmediate(resolve));
  const retry = f.page();
  assert.equal(retry.props.identity, initial.props.identity);
  assert.equal(retry.props.busy, false); assert.match(retry.props.error, /Enter your PIN/);
  retry.props.onConfirm({ method: 'pin', pin: '123456' });
  await pending;
  assert(checks > 0); assert.equal(f.render(), null); f.close();
});

for (const boundary of ['unrelated-inactive', 'background'] as const) test(`common authorization cancels on ${boundary}`, async () => {
  const f = fixture(), held = Promise.withResolvers<NativeOperationCredentialVerification>();
  const pending = f.broker.request(request, new AbortController().signal, () => {}, async (_credential, check) => {
    await held.promise; check(); return { accepted: true };
  });
  const rejected = assert.rejects(pending, /CANCELLED/);
  if (boundary === 'background') { f.page().props.onConfirm({ method: 'biometric' }); f.protect(true); }
  f.emit(boundary === 'background' ? 'background' : 'inactive');
  await rejected; held.resolve({ accepted: true }); await held.promise;
  assert.equal(f.render(), null); f.close();
});
