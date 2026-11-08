import { normalizeNftTokenId } from '../../../source/utils/nftTokenId.ts';
import type { SavedCollectible } from '../src/portfolio/tokenRegistry.ts';
import { parseErc20Units, formatTokenUnits, type Erc20Metadata } from '../../../source/shared/erc20.ts';
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
function fixture(open: (...args: any[]) => Promise<any>, token?: Erc20Metadata, collectible?: SavedCollectible) {
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
    '../../../../source/shared/erc20': { formatTokenUnits, parseErc20Units },
    '../../../../source/utils/nftTokenId': { normalizeNftTokenId },
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
      token, collectible, tokenView: token ? { subscribe: () => () => {}, connect: () => () => {},
        getSnapshot: () => ({ items: [{ metadata: token, status: 'available', units: '100' }] }) } : undefined,
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
    assert.deepEqual(JSON.parse(JSON.stringify(requests[0]!.slice(0, 2))), [
      '0x2222222222222222222222222222222222222222',
      { kind: 'exact', amount: '0.000000000000000009' },
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


for (const editAmount of [false, true]) test(`MAX selection ${editAmount ? 'clears when amount is edited' : 'uses the explicit maximum request'}`, async () => {
  let selected: any;
  const f = fixture(async (_recipient, amount) => { selected = amount; return { dispose() {} }; });
  try {
    f.edit('Recipient address', '0x2222222222222222222222222222222222222222');
    const maximum = all(f.render()).find(node => node.type === 'Button' && node.props.title === 'MAX')!;
    assert.equal(maximum.props.disabled, false);
    maximum.props.onPress();
    assert(all(f.render()).some(node => node.type === 'Button' && node.props.title === 'MAX selected'));
    if (editAmount) f.edit('Amount (ETH)', '1');
    f.press(); await tick();
    assert.equal(selected.kind, editAmount ? 'exact' : 'maximum');
    if (editAmount) assert.equal(selected.amount, '1');
  } finally { f.close(); }
});


test('Smart token form presents the selected contract and routes exact decimal input', async () => {
  const token = { contractAddress: '0x5555555555555555555555555555555555555555', decimals: 255, name: 'Exact token', symbol: 'EXACT' };
  let request: any;
  const f = fixture(async (_recipient, amount) => { request = amount; return { dispose() {} }; }, token);
  try {
    assert(all(f.render()).some(node => node.children.includes(token.contractAddress)));
    assert.equal(all(f.render()).filter(node => node.type === 'Button' && String(node.props.title).startsWith('MAX')).length, 0);
    f.edit('Recipient address', '0x2222222222222222222222222222222222222222');
    const amount = '0.' + '0'.repeat(254) + '9';
    f.edit('Amount (EXACT)', amount);
    f.press(); await tick();
    assert.equal(request.kind, 'erc20');
    assert.equal(request.contractAddress, token.contractAddress);
    assert.equal(request.amount, amount);
  } finally { f.close(); }
});


for (const standard of ['ERC-721', 'ERC-1155'] as const) test(`Smart ${standard} form binds saved item and exact quantity`, async () => {
  const contractAddress = '0x6666666666666666666666666666666666666666';
  const collectible: SavedCollectible = standard === 'ERC-721' ? { contractAddress, tokenStandard: standard } : { contractAddress, tokenStandard: standard, tokenId: '7' };
  let sent: any;
  const f = fixture(async (_recipient, request) => { sent = request; return { dispose() {} }; }, undefined, collectible);
  try {
    f.edit('Recipient address', '0x2222222222222222222222222222222222222222');
    if (standard === 'ERC-721') f.edit('Token ID', '7');
    else f.edit('Quantity', '9007199254740993');
    f.press(); await tick();
    assert.equal(sent.kind, 'nft');
    assert.equal(sent.collectible, collectible);
    assert.equal(sent.tokenId, '7');
    assert.equal(sent.amountUnits, standard === 'ERC-721' ? '1' : '9007199254740993');
  } finally { f.close(); }
});


test('invalid NFT identifiers stay in the form with a specific field message', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return { dispose() {} }; }, undefined,
    { contractAddress: '0x6666666666666666666666666666666666666666', tokenStandard: 'ERC-721' });
  try {
    f.edit('Recipient address', '0x2222222222222222222222222222222222222222');
    f.edit('Token ID', '-1'); f.press(); await tick();
    assert.equal(calls, 0);
    assert.equal(all(f.render()).find(node => node.type === 'Notice')!.props.body, 'Enter a valid token ID.');
  } finally { f.close(); }
});
