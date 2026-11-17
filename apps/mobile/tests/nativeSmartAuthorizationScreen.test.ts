import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import {
  screenElements,
  screenFixture,
  type ScreenElement,
} from './screenFixture.ts';
import {
  nativeTranslationFixture,
  englishI18n,
} from './localizationFixture.ts';

const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
const row = (n = 1) => ({
  account: `0x${'11'.repeat(20)}`,
  chainId: '1',
  createdAt: 10,
  operationHash: hash(n),
  operationNonce: (BigInt(2) ** BigInt(190)).toString(),
  payer: `0x${'22'.repeat(20)}`,
  observedAt: { number: '100', hash: hash(9) },
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
const t = (key: string) => englishI18n.t(key);

function fixture() {
  let foreground: ((next: string) => void) | undefined,
    hardwareBack: (() => boolean) | undefined;
  const app = {
    currentState: 'active',
    addEventListener(_event: string, listener: (next: string) => void) {
      foreground = listener;
      return {
        remove() {
          foreground = undefined;
        },
      };
    },
  };
  const lists: { options: any; signal: AbortSignal; guard: () => void }[] =
    [];
  const checks: {
    hash: string;
    signal: AbortSignal;
    guard: () => void;
  }[] = [];
  const calls: unknown[][] = [];
  let readList: (options: any) => Promise<any> = async () => ({
    entries: [row()],
    nextCursor: null,
  });
  let readStatus: () => Promise<any> = async () => ({
    kind: 'pending',
    operationHash: hash(1),
    currentNonce: row().operationNonce,
    anchor: { number: '100', hash: hash(9) },
  });
  const source = {
    async list(options: any, signal: AbortSignal, guard: () => void) {
      lists.push({
        options: JSON.parse(JSON.stringify(options)),
        signal,
        guard,
      });
      return readList(options);
    },
    async status(
      operationHash: string,
      signal: AbortSignal,
      guard: () => void
    ) {
      checks.push({ hash: operationHash, signal, guard });
      return readStatus();
    },
  };
  const screen = screenFixture(
    new URL(
      '../src/screens/NativeSmartAccountAuthorizations.tsx',
      import.meta.url
    ),
    'NativeSmartAccountAuthorizations',
    {
      'react-native': {
        ActivityIndicator: 'ActivityIndicator',
        FlatList: 'FlatList',
        View: 'View',
        AppState: app,
        BackHandler: {
          addEventListener(_event: string, listener: () => boolean) {
            hardwareBack = listener;
            return {
              remove() {
                hardwareBack = undefined;
              },
            };
          },
        },
        StyleSheet: { create: (value: unknown) => value },
      },
      'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      '../platform/localization': nativeTranslationFixture,
      '../ui': {
        ...Object.fromEntries(
          ['Button', 'Card', 'Header', 'IconButton', 'Notice', 'Text'].map(
            (name) => [name, name]
          )
        ),
        colors: {},
        styles: {},
      },
      '../ui/WalletBackHandler': {
        WalletBackHandler: {
          addEventListener(_event: string, listener: () => boolean) {
            hardwareBack = listener;
            return {
              remove() {
                hardwareBack = undefined;
              },
            };
          },
        },
      },
    },
    { queueMicrotask, AbortController },
    { target: ts.ScriptTarget.ES2022 }
  );
  const props = {
    source,
    accountLabel: 'Smart account',
    onBack() {
      calls.push(['back']);
    },
    onCancel(operationHash: string) {
      calls.push(['cancel', operationHash]);
    },
    onViewTransaction(transactionHash: string) {
      calls.push(['transaction', transactionHash]);
    },
  };
  const render = (overrides = {}) => {
    const nodes = screenElements(screen.render({ ...props, ...overrides }));
    const list = nodes.find((node) => node.type === 'FlatList')!;
    return [
      ...nodes,
      ...screenElements(
        nodes.find((node) => node.type === 'Header')?.props.right
      ),
      ...screenElements(list.props.ListHeaderComponent),
      ...screenElements(list.props.ListFooterComponent),
      ...(!list.props.data.length
        ? screenElements(list.props.ListEmptyComponent)
        : []),
      ...list.props.data.flatMap((item: unknown) =>
        screenElements(list.props.renderItem({ item }))
      ),
    ];
  };
  const button = (nodes: ScreenElement[], title: string) =>
    nodes.find(
      (node) => node.type === 'Button' && node.props.title === t(title)
    );
  return {
    render,
    button,
    lists,
    checks,
    calls,
    source,
    list(fn: typeof readList) {
      readList = fn;
    },
    status(fn: typeof readStatus) {
      readStatus = fn;
    },
    background(next: string) {
      app.currentState = next;
      foreground?.(next);
    },
    back() {
      return hardwareBack?.();
    },
    close: screen.close,
  };
}
const text = (nodes: ScreenElement[]) =>
  nodes
    .flatMap((node) =>
      node.children.filter((child) => typeof child === 'string')
    )
    .join(' ');

test('opening the actual signed-instruction screen lists public metadata locally without status polling or a fake transaction link', async () => {
  const f = fixture();
  try {
    f.render();
    await flush();
    const nodes = f.render();
    assert.equal(f.lists.length, 1);
    assert.deepEqual(f.lists[0]!.options, { maximum: 20 });
    assert.equal(f.checks.length, 0);
    assert(text(nodes).includes(hash(1)));
    assert(text(nodes).includes(row().operationNonce));
    assert(text(nodes).includes(row().payer));
    assert(!f.button(nodes, 'mobile.sendAssetViews.evm.viewTransaction'));
    assert(f.button(nodes, 'transactions.smartAuthorizations.checkStatus'));
    assert(
      f.button(nodes, 'transactions.smartAuthorizations.cancelInstruction')
    );
    assert.equal(f.lists[0]!.signal.aborted, true);
  } finally {
    f.close();
  }
});

for (const kind of ['pending', 'nonce-consumed', 'success', 'failure'] as const)
  test(`manual observation shows honest ${kind} state and preserves real outer identity`, async () => {
    const f = fixture();
    try {
      f.status(async () =>
        kind === 'success' || kind === 'failure'
          ? {
              kind: 'observed',
              success: kind === 'success',
              operationHash: hash(1),
              currentNonce: '8',
              anchor: { number: '100', hash: hash(9) },
              block: { number: '99', hash: hash(8) },
              transactionHash: hash(7),
            }
          : {
              kind,
              operationHash: hash(1),
              currentNonce: '8',
              anchor: { number: '100', hash: hash(9) },
            }
      );
      f.render();
      await flush();
      f.button(
        f.render(),
        'transactions.smartAuthorizations.checkStatus'
      )!.props.onPress();
      await flush();
      const nodes = f.render();
      assert.equal(f.checks.length, 1);
      assert.equal(f.checks[0]!.hash, hash(1));
      assert.equal(f.checks[0]!.signal.aborted, true);
      const expected =
        kind === 'pending'
          ? 'mayExecute'
          : kind === 'nonce-consumed'
          ? 'nonceConsumedUnknown'
          : kind === 'success'
          ? 'observedSuccess'
          : 'observedFailure';
      assert(
        text(nodes).includes(t(`transactions.smartAuthorizations.${expected}`))
      );
      assert.equal(
        !!f.button(nodes, 'transactions.smartAuthorizations.cancelInstruction'),
        kind === 'pending'
      );
      const view = f.button(nodes, 'mobile.sendAssetViews.evm.viewTransaction');
      assert.equal(!!view, kind === 'success' || kind === 'failure');
      if (view) {
        view.props.onPress();
        assert.deepEqual(f.calls, [['transaction', hash(7)]]);
      }
    } finally {
      f.close();
    }
  });

test('cancel forwards only the opaque operation reference once and never authorizes from the list', async () => {
  const f = fixture();
  try {
    f.render();
    await flush();
    const button = f.button(
      f.render(),
      'transactions.smartAuthorizations.cancelInstruction'
    )!;
    button.props.onPress();
    button.props.onPress();
    assert.deepEqual(f.calls, [['cancel', hash(1)]]);
    assert.equal(f.checks.length, 0);
  } finally {
    f.close();
  }
});

test('failed load-more retries its exact cursor, preserves prior rows, and a failed refresh retries the start', async () => {
  const f = fixture();
  try {
    let failMore = true,
      failRefresh = false;
    f.list(async (options) => {
      if (!options.beforeHash) {
        if (failRefresh) throw Error('offline');
        return { entries: [row()], nextCursor: hash(1) };
      }
      if (failMore) throw Error('offline');
      return { entries: [row(), row(2)], nextCursor: null };
    });
    f.render();
    await flush();
    f.button(f.render(), 'buttons.loadMore')!.props.onPress();
    await flush();
    assert(text(f.render()).includes(hash(1)));
    failMore = false;
    f.button(f.render(), 'privacy.retry')!.props.onPress();
    await flush();
    assert.deepEqual(
      f.lists.map((call) => call.options),
      [
        { maximum: 20 },
        { maximum: 20, beforeHash: hash(1) },
        { maximum: 20, beforeHash: hash(1) },
      ]
    );
    const list = f.render().find((node) => node.type === 'FlatList')!;
    assert.equal(
      list.props.data.length,
      2,
      'an overlapping page does not duplicate its existing instruction'
    );
    failRefresh = true;
    f.render()
      .find((node) => node.type === 'IconButton')!
      .props.onPress();
    await flush();
    failRefresh = false;
    f.button(f.render(), 'privacy.retry')!.props.onPress();
    await flush();
    assert.deepEqual(f.lists.at(-1)!.options, { maximum: 20 });
  } finally {
    f.close();
  }
});

test('a replacement read owner rejects late list publication from its previous source', async () => {
  const f = fixture(),
    old = deferred<any>();
  try {
    f.list(() => old.promise);
    f.render();
    await flush();
    const source = {
      ...f.source,
      list: async () => ({ entries: [row(2)], nextCursor: null }),
    };
    f.render({ source });
    await flush();
    old.resolve({ entries: [row(3)], nextCursor: null });
    await flush();
    const nodes = f.render({ source });
    assert(text(nodes).includes(hash(2)));
    assert(!text(nodes).includes(hash(3)));
    assert.equal(f.lists[0]!.signal.aborted, true);
    assert.throws(f.lists[0]!.guard, /CANCELLED/);
  } finally {
    f.close();
  }
});

test('Back aborts a held status request and invalidates both its result and stale cancel handlers', async () => {
  const f = fixture(),
    held = deferred<any>();
  try {
    f.status(() => held.promise);
    f.render();
    await flush();
    const nodes = f.render();
    const cancel = f.button(
      nodes,
      'transactions.smartAuthorizations.cancelInstruction'
    )!;
    f.button(
      nodes,
      'transactions.smartAuthorizations.checkStatus'
    )!.props.onPress();
    await flush();
    assert.equal(f.back(), true);
    assert.equal(f.checks[0]!.signal.aborted, true);
    cancel.props.onPress();
    held.resolve({ kind: 'nonce-consumed' });
    await flush();
    assert.deepEqual(f.calls, [['back']]);
    assert(
      !text(f.render()).includes(
        t('transactions.smartAuthorizations.nonceConsumedUnknown')
      )
    );
  } finally {
    f.close();
  }
});

test('background retirement aborts status; foreground reloads local inventory without restarting RPC observation', async () => {
  const f = fixture(),
    held = deferred<any>();
  try {
    f.status(() => held.promise);
    f.render();
    await flush();
    f.button(
      f.render(),
      'transactions.smartAuthorizations.checkStatus'
    )!.props.onPress();
    await flush();
    f.background('background');
    assert.equal(f.checks[0]!.signal.aborted, true);
    held.resolve({ kind: 'nonce-consumed' });
    await flush();
    f.background('active');
    await flush();
    const nodes = f.render();
    assert.equal(f.lists.length, 2);
    assert.equal(f.checks.length, 1);
    assert(
      text(nodes).includes(t('transactions.smartAuthorizations.mayExecute'))
    );
    assert.equal(
      f.button(nodes, 'transactions.smartAuthorizations.checkStatus')!.props
        .disabled,
      false
    );
  } finally {
    f.close();
  }
});
