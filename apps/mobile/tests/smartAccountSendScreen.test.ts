import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { formatBaseUnits } from '../src/core/amounts.ts';
import { getNativeSendContext } from '../src/custody/networkContext.ts';

type Element = {
  type: unknown;
  props: Record<string, any>;
  children: unknown[];
};
const all = (node: any): Element[] =>
  Array.isArray(node)
    ? node.flatMap(all)
    : node && typeof node === 'object' && 'children' in node
    ? [node, ...node.children.flatMap(all)]
    : [];
const source = readFileSync(
  new URL('../src/screens/NativeSmartAccountSend.tsx', import.meta.url),
  'utf8'
);
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.React,
    esModuleInterop: true,
  },
}).outputText;
function fixture(open: (...args: any[]) => Promise<any>) {
  const cells: any[] = [],
    cleanups: (() => void)[] = [];
  let index = 0;
  const cell = (initial: () => any) => {
    const at = index++;
    return cells[at] ?? (cells[at] = initial());
  };
  const react = {
    createElement: (type: unknown, props: any, ...children: unknown[]) => ({
      type,
      props: props ?? {},
      children,
    }),
    useState(initial: unknown) {
      const value = cell(() => ({ value: initial }));
      return [
        value.value,
        (next: unknown) => {
          value.value = next;
        },
      ];
    },
    useRef(initial: unknown) {
      return cell(() => ({ current: initial }));
    },
    useMemo(create: () => unknown) {
      return cell(create);
    },
    useEffect(run: () => (() => void) | undefined) {
      cell(() => {
        const close = run();
        if (close) cleanups.push(close);
        return {};
      });
    },
    useLayoutEffect(run: () => (() => void) | undefined) {
      cell(() => {
        const close = run();
        if (close) cleanups.push(close);
        return {};
      });
    },
    useSyncExternalStore(_subscribe: unknown, get: () => unknown) {
      return get();
    },
  };
  const imports: Record<string, any> = {
    react,
    'react-native': {
      ActivityIndicator: 'ActivityIndicator',
      KeyboardAvoidingView: 'KeyboardAvoidingView',
      Platform: { OS: 'android' },
    },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../portfolio/nativePortfolio': {
      NativePortfolioController: class {
        subscribe() {
          return () => {};
        }
        getSnapshot() {
          return { status: 'available', units: '5000000000000000000' };
        }
        connect() {
          return () => {};
        }
      },
    },
    '../core/amounts': { formatBaseUnits },
    './NativeSend': {
      NativeSendInput: 'Input',
      nativeTransferFailure: (error: Error) =>
        error.message === 'INVALID_INPUT'
          ? 'Check recipient and amount'
          : 'This request could not be completed',
    },
    './NativeSmartAccountOperation': {
      NativeSmartAccountOperationScreen: 'Operation',
    },
    '../ui': {
      Button: 'Button',
      Header: 'Header',
      Notice: 'Notice',
      Screen: 'Screen',
      Text: 'Text',
      colors: {},
      styles: {},
    },
  };
  const module = { exports: {} as any };
  runInNewContext(code, {
    module,
    exports: module.exports,
    require(name: string) {
      assert(Object.hasOwn(imports, name), name);
      return imports[name];
    },
  });
  const render = () => {
    index = 0;
    return module.exports.NativeSmartAccountSend({
      open,
      context: getNativeSendContext('ethereum'),
      accountLabel: 'Smart account',
      source: {},
      reader: {},
      onBack() {},
    }) as Element;
  };
  const edit = (label: string, value: string) => {
    const field = all(render()).find(
      (node) => node.type === 'Input' && node.props.label === label
    );
    assert(field);
    field.props.onChange(value);
  };
  const press = () => {
    const button = all(render()).find(
      (node) => node.type === 'Button' && node.props.title === 'Review transfer'
    );
    assert(button);
    button.props.onPress();
  };
  return {
    render,
    edit,
    press,
    close: () => cleanups.forEach((close) => close()),
  };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('Smart send form displays the shared balance and binds exact fields to its operation', async () => {
  const requests: any[][] = [];
  const operation = { dispose() {} };
  const f = fixture(async (...args) => {
    requests.push(args);
    return operation;
  });
  try {
    assert(
      all(f.render()).some((node) =>
        node.children.some((value) => String(value).includes('Balance 5.0 ETH'))
      )
    );
    f.edit('Recipient address', '0x2222222222222222222222222222222222222222');
    f.edit('Amount (ETH)', '0.000000000000000009');
    f.press();
    await tick();
    assert.deepEqual(requests[0]!.slice(0, 2), [
      '0x2222222222222222222222222222222222222222',
      '0.000000000000000009',
    ]);
    assert.equal(f.render().type, 'Operation');
    assert.equal(f.render().props.controller, operation);
  } finally {
    f.close();
  }
});

test('leaving during Smart operation opening disposes the late result', async () => {
  let resolve!: (value: any) => void,
    disposed = 0;
  const f = fixture(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  f.edit('Recipient address', '0x2222222222222222222222222222222222222222');
  f.edit('Amount (ETH)', '1');
  f.press();
  assert(
    all(f.render())
      .filter((node) => node.type === 'Input')
      .every((node) => node.props.busy)
  );
  f.close();
  resolve({
    dispose() {
      disposed++;
    },
  });
  await tick();
  assert.equal(disposed, 1);
  assert.notEqual(f.render().type, 'Operation');
});

for (const message of ['INVALID_INPUT', 'NOT_READY'])
  test(`opening failure has appropriate feedback (${message})`, async () => {
    const f = fixture(async () => {
      throw new Error(message);
    });
    try {
      f.edit('Recipient address', '0x2222222222222222222222222222222222222222');
      f.edit('Amount (ETH)', '1');
      f.press();
      await tick();
      const notice = all(f.render()).find((node) => node.type === 'Notice');
      assert(notice);
      assert.equal(
        notice.props.body,
        message === 'INVALID_INPUT'
          ? 'Check recipient and amount'
          : 'This request could not be completed'
      );
    } finally {
      f.close();
    }
  });
