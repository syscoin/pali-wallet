import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativePrivateAuthenticationScope, createNativePrivateAuthenticationChild } from '../src/custody/privateAuthentication.ts';
import { allowsPrivateAuthenticationInterruption } from '../src/screens/privateAuthenticationLifecycle.ts';
import { screenElements, screenFixture } from './screenFixture.ts';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

for (const kind of ['Deposit', 'Withdrawal'] as const) test(`${kind} waits for the first late-open disposal before returning`, async () => {
  const opening = Promise.withResolvers<object>();
  const disposal = Promise.withResolvers<void>();
  let backs = 0, disposals = 0;
  const controller = {
    dispose() {
      disposals++;
      // A second idempotent call does not stand in for the first pending cleanup.
      return disposals === 1 ? disposal.promise : Promise.resolve();
    },
  };
  const fixture = screenFixture(new URL(`../src/screens/NativePrivate${kind}.tsx`, import.meta.url), `NativePrivate${kind}`, {
    'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
      BackHandler: { addEventListener: () => ({ remove() {} }) }, Keyboard: { dismiss() {} },
      Platform: { OS: 'android' }, StyleSheet: { create: (value: unknown) => value }, View: 'View', ActivityIndicator: 'ActivityIndicator' },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Header', 'Screen', 'Text'].map(value => [value, value])), colors: {}, styles: {} },
    '../custody/privateAuthentication': { createNativePrivateAuthenticationScope, createNativePrivateAuthenticationChild },
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption },
    '../core/amounts': { formatBaseUnits: (value: string) => value },
    './IdleActivityBoundary': { IdlePressable: 'Pressable', IdleTextInput: 'Input' },
    './PinEntry': { PinField: 'PinField' },
    '../platform/security': { recordIdleActivity: () => true },
    '../../../../source/utils/privacy/registry': { PRIVACY_POOLS: [] },
    'ethers/address': { getAddress: (value: string) => value },
  }, { AbortController });
  const props = { open: () => opening.promise, onBack() { backs++; }, onBackup() {},
    authentication: createNativePrivateAuthenticationScope(), note: { amount: '1', createdAt: 1 } };
  try {
    fixture.render(props); await tick();
    const header = screenElements(fixture.render(props)).find(element => element.type === 'Header'); assert(header);
    header.props.onBack();
    opening.resolve(controller); await tick();
    assert.equal(disposals, 1);
    assert.equal(backs, 0, 'navigation must wait for the original cleanup');
    disposal.resolve(); await tick(); await tick();
    assert.equal(backs, 1);
  } finally { opening.resolve(controller); disposal.resolve(); fixture.close(); props.authentication.retire(); }
});
