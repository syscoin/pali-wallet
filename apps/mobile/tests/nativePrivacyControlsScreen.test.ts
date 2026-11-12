import assert from 'node:assert/strict';
import test from 'node:test';
import { URL } from 'node:url';
import { PRIVACY_POOLS } from '../../../source/utils/privacy/registry.ts';
import { normalizePrivacyServiceOrigin } from '../../../source/shared/privacyServiceOrigin.ts';
import type { PrivacySyncStatus } from '../../../source/utils/privacy/types.ts';
import { englishI18n, nativeTranslationFixture } from './localizationFixture.ts';
import { screenElements, screenFixture } from './screenFixture.ts';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('privacy controls display live local progress and verified data, then detach on exit', async () => {
  let listener: ((status: PrivacySyncStatus) => void) | undefined;
  let detached = 0, disposed = 0, reads = 0;
  const done = Promise.withResolvers<PrivacySyncStatus>();
  const pool = {
    getStatus: (): PrivacySyncStatus => { reads++; return { poolId: 'eth-1', phase: 'idle' }; },
    subscribe(next: typeof listener) { listener = next; return () => { detached++; listener = undefined; }; },
    refresh: () => done.promise,
    dispose: async () => { disposed++; },
  };
  const controls = {
    getOrigin: async () => 'https://privacy.example',
    openPool: async () => pool,
  };
  const f = screenFixture(new URL('../src/screens/NativePrivacyControls.tsx', import.meta.url), 'NativePrivacyControls', {
    '../../../../source/utils/privacy/registry': { PRIVACY_POOLS },
    '../../../../source/shared/privacyServiceOrigin': { normalizePrivacyServiceOrigin },
    '../platform/localization': nativeTranslationFixture,
    './IdleActivityBoundary': { IdleTextInput: 'IdleTextInput' },
    'react-native': {
      ...Object.fromEntries(['KeyboardAvoidingView', 'View'].map(name => [name, name])),
      AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
      BackHandler: { addEventListener: () => ({ remove() {} }) },
      Keyboard: { dismiss() {} }, Platform: { OS: 'ios' }, StyleSheet: { create: (value: unknown) => value },
    },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Header', 'Row', 'Screen', 'Text'].map(name => [name, name])), colors: {}, styles: {} },
  }, { AbortController });
  const props = { open: async () => controls, onBack() {} };
  const render = () => screenElements(f.render(props));
  try {
    render(); await tick();
    render().find(row => row.type === 'Button' && row.props.title === englishI18n.t('privacy.refresh'))!.props.onPress();
    await tick();
    assert(listener);
    listener({ poolId: 'eth-1', phase: 'verifying', completed: 32, total: 128 });
    let rows = render();
    assert.equal(rows.find(row => row.props.accessibilityRole === 'progressbar')?.props.accessibilityValue.now, 25);
    assert(rows.some(row => row.children.includes(englishI18n.t('privacy.progress', { completed: 32, total: 128 }))));
    const ready: PrivacySyncStatus = { poolId: 'eth-1', phase: 'ready', completed: 128, total: 128, leafCount: 128, blockNumber: 12345, verifiedAt: 1 };
    listener(ready); done.resolve(ready); await tick(); rows = render();
    assert(rows.some(row => row.children.includes(englishI18n.t('privacy.savedDeposits', { count: 128 }))));
    assert(rows.some(row => row.children.includes(englishI18n.t('privacy.verifiedBlock', { block: 12345 }))));
    assert.equal(rows.some(row => row.props.accessibilityRole === 'progressbar'), false);
    assert.equal(reads, 1, 'progress uses subscription, not repeated status/network polling');
  } finally { done.resolve({ poolId: 'eth-1', phase: 'ready' }); f.close(); }
  assert.equal(detached, 1);
  assert.equal(disposed, 1);
});
