import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  NativeTrezorResumeIntent,
  NativeTrezorSnapshot,
  NativeTrezorView,
} from '../src/custody/trezorAccounts.ts';
import { screenElements, screenFixture } from './screenFixture.ts';

const smart = '0x1111111111111111111111111111111111111111';
const first = '0x2222222222222222222222222222222222222222';
const second = '0x3333333333333333333333333333333333333333';
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture(
  signer: NativeTrezorSnapshot['signer'],
  operation: NativeTrezorSnapshot['operation'] = 'smart-operation'
) {
  let snapshot: NativeTrezorSnapshot = {
    phase: operation ? 'resume' : 'idle',
    operation,
    networkLabel: 'Ethereum',
    accountLabel: 'Smart savings',
    address: operation ? smart : null,
    signer,
    error: null,
  };
  let resumes = 0,
    imports = 0,
    returned = 0,
    canceled = 0;
  const resumed: NativeTrezorResumeIntent[] = [];
  const intent: NativeTrezorResumeIntent = {
    id: 'original-request',
    kind: 'smart-operation',
    accountId: 'smart:60:0',
    networkId: 'ethereum',
  };
  const controller: NativeTrezorView = {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    async startImport() {
      imports++;
    },
    async resumeImport() {
      imports++;
    },
    async resumeSend(...args: unknown[]) {
      assert.equal(args.length, 0);
      resumes++;
      return intent;
    },
    background() {},
    async cancel() {
      canceled++;
    },
  };
  const screen = screenFixture(
    new URL('../src/screens/NativeTrezor.tsx', import.meta.url),
    'NativeTrezor',
    {
      'react-native': {
        ActivityIndicator: 'ActivityIndicator',
        BackHandler: { addEventListener: () => ({ remove() {} }) },
        Keyboard: { dismiss() {} },
        KeyboardAvoidingView: 'KeyboardAvoidingView',
        Platform: { OS: 'android' },
        StyleSheet: { create: (value: unknown) => value },
        View: 'View',
      },
      'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      '../ui': {
        ...Object.fromEntries(
          ['Button', 'Card', 'Header', 'Screen', 'Text'].map((name) => [
            name,
            name,
          ])
        ),
        colors: {},
        styles: {},
      },
      './IdleActivityBoundary': { IdleTextInput: 'IdleTextInput' },
    }
  );
  const render = () =>
    screenElements(
      screen.render({
        controller,
        onBack() {
          returned++;
        },
        onImported() {},
        onResumeSend(value: NativeTrezorResumeIntent) {
          resumed.push(value);
        },
      })
    );
  const text = () =>
    render()
      .filter((element) => element.type === 'Text')
      .map((element) =>
        element.children
          .filter(
            (value) => typeof value === 'string' || typeof value === 'number'
          )
          .join('')
      )
      .join('\n');
  const button = (title: string) => {
    const result = render().find(
      (element) => element.type === 'Button' && element.props.title === title
    );
    assert(result);
    return result;
  };
  return {
    render,
    text,
    button,
    intent,
    resumed,
    close: screen.close,
    setSigner(next: NativeTrezorSnapshot['signer']) {
      snapshot = { ...snapshot, signer: next };
    },
    counts: () => ({ resumes, imports, returned, canceled }),
  };
}

test('Smart Suite review shows the target account and exact expected signer occurrence without acting', () => {
  const f = fixture({
    label: 'First Trezor owner',
    address: first,
    step: 1,
    total: 2,
  });
  try {
    const text = f.text();
    assert(text.includes('Smart savings'));
    assert(text.includes(smart));
    assert(text.includes('Expected signer'));
    assert(text.includes('First Trezor owner'));
    assert(text.includes(first));
    assert(text.includes('Signer 1 of 2'));
    assert.deepEqual(f.counts(), {
      resumes: 0,
      imports: 0,
      returned: 0,
      canceled: 0,
    });
    f.setSigner({
      label: 'Second Trezor owner',
      address: second,
      step: 2,
      total: 2,
    });
    assert(f.text().includes('Signer 2 of 2'));
    assert(f.text().includes(second));
    assert(!f.text().includes(first));
    assert.deepEqual(f.counts(), {
      resumes: 0,
      imports: 0,
      returned: 0,
      canceled: 0,
    });
  } finally {
    f.close();
  }
});

test('single-owner review identifies its signer without an unnecessary progress count', () => {
  const f = fixture({
    label: 'Travel Trezor',
    address: first,
    step: 1,
    total: 1,
  });
  try {
    assert(f.text().includes('Expected signer'));
    assert(f.text().includes('Travel Trezor'));
    assert(f.text().includes(first));
    assert(!/Signer \d+ of \d+/.test(f.text()));
  } finally {
    f.close();
  }
});

test('ordinary and import snapshots use explicit null and show no Smart signer presentation', () => {
  for (const operation of [null, 'import', 'send'] as const) {
    const f = fixture(null, operation);
    try {
      assert(!f.text().includes('Expected signer'));
      assert(!/Signer \d+ of \d+/.test(f.text()));
      assert.deepEqual(f.counts(), {
        resumes: 0,
        imports: 0,
        returned: 0,
        canceled: 0,
      });
    } finally {
      f.close();
    }
  }
});

test('signer presentation keeps explicit Continue and stale screen callbacks cannot resume', async () => {
  const f = fixture({
    label: 'Second Trezor owner',
    address: second,
    step: 2,
    total: 2,
  });
  try {
    const continueRequest = f.button('Continue').props.onPress;
    assert.equal(f.button('Continue').props.disabled, false);
    continueRequest();
    await tick();
    assert.equal(f.counts().resumes, 1);
    assert.deepEqual(f.resumed, [f.intent]);
    f.close();
    continueRequest();
    await tick();
    assert.equal(f.counts().resumes, 1);
    assert.equal(f.counts().canceled, 0);
  } finally {
    f.close();
  }
});
