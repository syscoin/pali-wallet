import { nativeTranslationFixture } from './localizationFixture.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { screenElements, screenFixture } from './screenFixture.ts';
import type { NativeLedgerFailureCategory } from '../src/hardware/ledgerFailure.ts';
import { nativeLedgerFailureCategory } from '../src/hardware/ledgerFailure.ts';

for (const [failure, action] of [
  ['permission', 'Try again'],
  ['bluetooth-off', 'Try again'],
  ['disconnected', 'Reconnect Ledger'],
  ['retry', 'Try again'],
] as const)
  test(`Ledger ${failure} shows only supported actions`, async () => {
    let started = 0,
      settings = 0;
    const controller = {
      purpose: 'connect',
      subscribe: () => () => {},
      getSnapshot: () => ({
        phase: 'error',
        failure,
        error: 'Supported failure',
        devices: [],
        address: null,
        networkLabel: 'Ethereum',
      }),
      async close() {},
      async start() {
        started++;
      },
    };
    const f = screenFixture(
      new URL('../src/screens/NativeLedger.tsx', import.meta.url),
      'NativeLedger',
      {
        '../platform/localization': nativeTranslationFixture,
    'react-native': {
          ActivityIndicator: 'Spinner',
          BackHandler: { addEventListener: () => ({ remove() {} }) },
          KeyboardAvoidingView: 'KeyboardAvoidingView',
          Linking: {
            async openSettings() {
              settings++;
            },
          },
          Modal: 'Modal',
          Platform: { OS: 'ios' },
          StyleSheet: { create: (value: unknown) => value },
          View: 'View',
        },
        'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
        '../ui': {
          Button: 'Button',
          Card: 'Card',
          Header: 'Header',
          Screen: 'Screen',
          Text: 'Text',
          colors: {},
        },
        './IdleActivityBoundary': { IdleTextInput: 'Input' },
      }
    );
    const render = () =>
      screenElements(f.render({ controller, onBack() {}, onFinished() {} }));
    try {
      const elements = render();
      const buttons = elements.filter((element) => element.type === 'Button');
      assert(buttons.some((button) => button.props.title === action));
      assert.equal(
        buttons.some((button) => button.props.title === 'Open Settings'),
        failure === 'permission'
      );
      assert(
        !buttons.some(
          (button) =>
            button.props.title === 'Turn on Bluetooth' ||
            button.props.title === 'Allow Bluetooth'
        )
      );
      buttons.find((button) => button.props.title === action)!.props.onPress();
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(started, 1);
      if (failure === 'permission') {
        render()
          .find(
            (button) =>
              button.type === 'Button' && button.props.title === 'Open Settings'
          )!
          .props.onPress();
        await Promise.resolve();
        assert.equal(settings, 1);
      }
    } finally {
      f.close();
    }
  });

test('Ledger category reader does not inspect arbitrary error messages or accessors', () => {
  assert.equal(
    nativeLedgerFailureCategory(Error('permission bluetooth disconnected')),
    'retry'
  );
  const dangerous = {
    get _tag() {
      throw Error('do not execute');
    },
    cause: { errorCode: 102 },
  };
  assert.equal(nativeLedgerFailureCategory(dangerous), 'bluetooth-off');
  assert.equal(
    nativeLedgerFailureCategory({ _tag: 'BleNotSupported' }),
    'unsupported' satisfies NativeLedgerFailureCategory
  );
});
