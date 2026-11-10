import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { formatBaseUnits, parseDecimalAmount } from '../src/core/amounts.ts';
import { getUtxoNetwork } from '../src/core/utxoNetworks.ts';
import { isAssetAmountEqualToBalance, toEightDecimalBuilderAmount } from '../../../source/utils/syscoinAssetAmount.ts';
import { snapshotUtxoRbf } from '../../../source/shared/utxoTransactionOptions.ts';
import { SYSX_ASSET_GUID, SYSX_ASSET_DECIMALS } from '../../../source/shared/syscoinAssetIds.ts';
import type { NativeUtxoAsset, NativeUtxoReview } from '../src/custody/utxoSend.ts';
import type { NativeOperationCredential } from '../src/custody/types.ts';

type Element = { type: unknown; props: Record<string, any>; children: unknown[] };
type Cell = { value?: any; deps?: readonly unknown[]; cleanup?: () => void; setter?: (value: any) => void };
const all = (value: any): Element[] => Array.isArray(value) ? value.flatMap(all)
  : value && typeof value === 'object' && 'children' in value ? [value, ...value.children.flatMap(all), ...all(value.props.footer)] : [];
const source = readFileSync(new URL('../src/screens/NativeUtxoSend.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function fixture(asset?: NativeUtxoAsset, maximum?: string) {
  let network = getUtxoNetwork(asset ? 'syscoin' : 'bitcoin');
  let availableAmount = '1.25000001';
  const cells: Cell[] = [], effects: (() => void)[] = []; let cursor = 0;
  const cell = () => cells[cursor++] ?? (cells[cursor - 1] = {});
  const react = {
    Fragment: 'Fragment',
    createElement: (type: unknown, props: Record<string, any> | null, ...children: unknown[]) => ({ type, props: props ?? {}, children }),
    useState(initial: unknown) {
      const value = cell(); if (!Object.hasOwn(value, 'value')) value.value = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      value.setter ??= (next: any) => { value.value = typeof next === 'function' ? next(value.value) : next; };
      return [value.value, value.setter];
    },
    useRef(initial: unknown) { const value = cell(); value.value ??= { current: initial }; return value.value; },
    useEffect(run: () => void | (() => void), deps?: readonly unknown[]) {
      const value = cell();
      if (deps && value.deps && deps.length === value.deps.length && deps.every((item, index) => Object.is(item, value.deps![index]))) return;
      value.deps = deps; effects.push(() => { value.cleanup?.(); value.cleanup = run() || undefined; });
    },
    useLayoutEffect(run: () => void | (() => void), deps?: readonly unknown[]): void { react.useEffect(run, deps); },
    useSyncExternalStore(_subscribe: unknown, read: () => unknown) { cell(); return read(); },
  };
  const native = { ...Object.fromEntries(['ActivityIndicator', 'KeyboardAvoidingView', 'Modal', 'View'].map((name) => [name, name])),
    Platform: { OS: 'android' }, Keyboard: { dismiss() {} }, StyleSheet: { create: (value: unknown) => value },
    BackHandler: { addEventListener: () => ({ remove() {} }) } };
  const ui = { ...Object.fromEntries(['Button', 'Card', 'Coin', 'Header', 'IconButton', 'Notice', 'Screen', 'Text'].map((name) => [name, name])), colors: {}, styles: {} };
  const imports: Record<string, unknown> = {
    react, 'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, '../ui': ui,
    '../core/amounts': { formatBaseUnits }, './NativeLedger': { NativeLedgerConnectionModal: 'Ledger' },
    './IdleActivityBoundary': { IdleTextInput: 'Input' },
    './TransactionAuthentication': { TransactionAuthentication: 'TransactionAuthentication' },
    './UtxoRecipientQrScanner': { UtxoRecipientQrScanner: 'UtxoRecipientQrScanner' },
    '../../../../source/shared/syscoinAssetIds': { SYSX_ASSET_GUID, SYSX_ASSET_DECIMALS },
    '../../../../source/utils/syscoinAssetAmount': { isAssetAmountEqualToBalance, toEightDecimalBuilderAmount },
    '../../../../source/shared/utxoTransactionOptions': { snapshotUtxoRbf },
  };
  const module = { exports: {} as any };
  runInNewContext(code, { module, exports: module.exports, Error, require(name: string) { assert(Object.hasOwn(imports, name), name); return imports[name]; } });
  const requests: any[] = []; let cancels = 0, confirmations = 0, networkChanges = 0, gate: Promise<void> | undefined, release: (() => void) | undefined;
  const authorized: { review: NativeUtxoReview; credential: NativeOperationCredential }[] = [];
  const openedTransactions: string[] = [];
  const networkDrafts: unknown[] = [];
  const reviews: NativeUtxoReview[] = [];
  const service = {
    cancel() { cancels++; }, async list() { return []; },
    async prepare(input: any): Promise<NativeUtxoReview> {
      requests.push(structuredClone(input));
      if (gate) await gate; // Deliberately deliver a late result after cancellation.
      const view = { transactionOptions: { rbf: input.rbf, ...(input.asset ? { zdag: !input.rbf } : {}) }, feeSatoshis: '100',
        outputs: [{ address: input.recipient, amountSatoshis: input.asset ? '294' : '10000',
          ...(input.asset ? { asset: { assetGuid: input.asset.assetGuid, rawAmount: parseDecimalAmount(input.amount, input.asset.decimals).toString() } } : {}) }],
        ...(input.asset ? { assetDisplay: input.asset } : {}) };
      reviews.push(view); return view;
    },
    async confirm(review: NativeUtxoReview, credential: NativeOperationCredential) {
      confirmations++; authorized.push({ review, credential }); return { txid: 'ab'.repeat(32) };
    },
  };
  const open = async () => service;
  const render = () => { cursor = 0; const tree = module.exports.NativeUtxoSendScreen({ accountLabel: 'Account', asset,
    authenticationMethod: 'pin', maximumAmount: maximum, availableAmount, network, open, onChangeNetwork(draft: unknown) { networkDrafts.push(draft); networkChanges++; }, onViewTransaction(txid: string) { openedTransactions.push(txid); }, onBack() {} }) as Element;
    effects.splice(0).forEach((run) => run()); return tree; };
  const press = (title: string) => { const button = all(render()).find((node) => node.type === 'Button' && node.props.title === title); assert(button, title); button.props.onPress(); };
  const edit = (label: string, value: string) => { const input = all(render()).find((node) => node.type === 'Input' && node.props.accessibilityLabel === label); assert(input, label); input.props.onChangeText(value); };
  const review = () => { const screen = all(render()).find((node) => node.type === 'Screen')!; screen.props.footer.props.onPress(); };
  const authentication = () => { const modal = all(render()).find(node => node.type === 'TransactionAuthentication'); assert(modal); return modal; };
  return { render, press, edit, review, requests, reviews, authorized, openedTransactions, networkDrafts, authentication, counts: () => ({ cancels, confirmations, networkChanges }),
    changeBalance(value: string) { maximum = value; },
    changeNetwork(id: string) { network = getUtxoNetwork(id); },
    changeAvailable(value: string) { availableAmount = value; },
    hold() { gate = new Promise<void>((resolve) => { release = resolve; }); },
    release() { release?.(); gate = undefined; },
    close() { cells.forEach((value) => value.cleanup?.()); } };
}

test('native options start collapsed, preserve RBF default and bind a changed option to review', async () => {
  const f = fixture(); f.render(); await tick();
  assert(!all(f.render()).some((node) => node.props.title === 'Replace-by-fee enabled'));
  f.edit('Recipient address', 'bc1qfixture'); f.edit('Amount in BTC', '0.1'); f.review(); await tick();
  assert.equal(f.requests[0].rbf, true);
  all(f.render()).find((node) => node.type === 'Header')!.props.onBack(); f.render();
  f.press('Advanced options'); f.press('Replace-by-fee enabled'); f.review(); await tick();
  assert.equal(f.requests[1].rbf, false);
  const text = all(f.render()).flatMap((node) => node.children).join(' '); assert.match(text, /Replace-by-fee/); assert.match(text, /Disabled/);
  f.press('Confirm and send'); f.authentication().props.onConfirm({ method: 'pin', pin: '123456' });
  await tick(); assert.equal(f.counts().confirmations, 1); f.close();
});

test('UTXO confirmation opens authentication and cancel preserves the reviewed transfer', async () => {
  const f = fixture(); f.render(); await tick();
  try {
    f.edit('Recipient address', 'bc1qfixture'); f.edit('Amount in BTC', '0.1'); f.review(); await tick();
    const reviewed = f.reviews[0], cancelledBeforeAuthentication = f.counts().cancels;
    f.press('Confirm and send');
    const authentication = f.authentication();
    assert.equal(authentication.props.method, 'pin'); assert.equal(f.counts().confirmations, 0);
    authentication.props.onCancel();
    assert.equal(all(f.render()).some(node => node.type === 'TransactionAuthentication'), false);
    assert.equal(f.counts().cancels, cancelledBeforeAuthentication);
    f.press('Confirm and send');
    f.authentication().props.onConfirm({ method: 'pin', pin: '123456' }); await tick();
    assert.equal(f.counts().confirmations, 1); assert.strictEqual(f.authorized[0]?.review, reviewed);
    assert.equal(f.authorized[0]?.credential.method, 'pin');
  } finally { f.close(); }
});

for (const replacement of [false, true]) test(`stale UTXO authentication after Back${replacement ? ' and a new review' : ''} cannot confirm`, async () => {
  const f = fixture(); f.render(); await tick();
  try {
    f.edit('Recipient address', 'bc1qfixture'); f.edit('Amount in BTC', '0.1'); f.review(); await tick();
    f.press('Confirm and send'); const authentication = f.authentication();
    all(f.render()).find(node => node.type === 'Header')!.props.onBack(); f.render();
    if (replacement) { f.edit('Amount in BTC', '0.2'); f.review(); await tick(); }
    authentication.props.onConfirm({ method: 'pin', pin: '123456' }); await tick();
    assert.equal(f.counts().confirmations, 0);
    if (replacement) { f.press('Confirm and send'); assert.equal(f.authentication().props.busy, false); }
  } finally { f.close(); }
});

test('SPT Z-DAG uses the inverse RBF option and MAX fills the selected exact total once', async () => {
  const asset = { assetGuid: '123456', decimals: 3, symbol: 'SPT' };
  const f = fixture(asset, '2.125'); f.render(); await tick();
  f.edit('Recipient address', 'sys1qfixture'); f.press('MAX'); f.press('Advanced options'); f.press('Z-DAG disabled');
  assert.equal(all(f.render()).find((node) => node.props.accessibilityLabel === 'Amount in SPT')!.props.value, '2.125');
  f.changeBalance('3.0'); f.render(); f.render();
  f.review(); await tick();
  assert.deepEqual(f.requests[0], { recipient: 'sys1qfixture', amount: '2.125', max: false, asset, rbf: false });
  f.close();
});

test('SPT maximum keeps its explicit flag and fixed quantity when no inventory update occurs', async () => {
  const f = fixture({ assetGuid: '123456', decimals: 0, symbol: 'WHOLE' }, '9007199254740993'); f.render(); await tick();
  f.edit('Recipient address', 'sys1qfixture'); f.press('MAX'); f.review(); await tick();
  assert.equal(f.requests[0].amount, '9007199254740993'); assert.equal(f.requests[0].max, true); f.close();
});

test('an option edit cancels a held quote and its late result cannot become the review', async () => {
  const f = fixture(); f.render(); await tick(); f.edit('Recipient address', 'bc1qfixture'); f.edit('Amount in BTC', '0.1');
  f.press('Advanced options'); const staleToggle = all(f.render()).find((node) => node.props.title === 'Replace-by-fee enabled')!;
  f.hold(); f.review(); await tick(); staleToggle.props.onPress(); f.release(); await tick();
  assert(!all(f.render()).some((node) => node.props.title === 'Confirm and send'));
  assert(f.counts().cancels > 0); f.review(); await tick(); assert.equal(f.requests[1].rbf, false); f.close();
});

test('an unavailable or zero SPT balance cannot select MAX', async () => {
  for (const maximum of [undefined, '0', '-1']) {
    const f = fixture({ assetGuid: '123456', decimals: 0, symbol: 'SPT' }, maximum); f.render(); await tick();
    const button = all(f.render()).find((node) => node.props.title === 'MAX');
    if (maximum === undefined) assert.equal(button, undefined); else assert.equal(button!.props.disabled, true);
    f.close();
  }
});

test('UTXO draft shows the selected network, exact available amount and bordered MAX without preparing', async () => {
  const f = fixture(); f.render(); await tick();
  const elements = all(f.render());
  assert(elements.some(node => node.type === 'Coin' && node.props.id === 'bitcoin'));
  assert(elements.some(node => node.type === 'Text' && node.props.accessibilityLabel === 'Available 1.25000001 BTC'));
  const max = elements.find(node => node.type === 'Button' && node.props.title === 'MAX');
  assert.equal(max?.props.variant, 'secondary'); assert.equal(max?.props.size, 'compact');
  assert.equal(f.requests.length, 0);
  f.changeAvailable('0.99999999');
  assert(all(f.render()).some(node => node.props.accessibilityLabel === 'Available 0.99999999 BTC'));
  f.close();
});

test('UTXO scan fills only the live draft and never prepares or confirms it', async () => {
  const f = fixture(); f.render(); await tick();
  f.edit('Amount in BTC', '0.25');
  const scan = all(f.render()).find(node => node.type === 'IconButton' && node.props.label === 'Scan recipient address');
  assert(scan); scan.props.onPress();
  const scanner = all(f.render()).find(node => node.type === 'UtxoRecipientQrScanner');
  assert(scanner); assert.equal(scanner.props.network.id, 'bitcoin');
  scanner.props.onScan('bc1qpublicrecipient');
  assert.equal(all(f.render()).find(node => node.props.accessibilityLabel === 'Recipient address')?.props.value, 'bc1qpublicrecipient');
  assert.equal(all(f.render()).find(node => node.props.accessibilityLabel === 'Amount in BTC')?.props.value, '0.25');
  assert.equal(f.requests.length, 0); assert.equal(f.counts().confirmations, 0);
  scanner.props.onScan('bc1qstale');
  assert.equal(all(f.render()).find(node => node.props.accessibilityLabel === 'Recipient address')?.props.value, 'bc1qpublicrecipient');
  f.close();
});

test('closed or old-network UTXO scanner callbacks cannot fill a new draft', async () => {
  const f = fixture(); f.render(); await tick();
  const scan = () => all(f.render()).find(node => node.type === 'IconButton' && node.props.label === 'Scan recipient address')!.props.onPress();
  scan(); let scanner = all(f.render()).find(node => node.type === 'UtxoRecipientQrScanner')!;
  scanner.props.onClose(); scanner.props.onScan('bc1qstale');
  assert.equal(all(f.render()).find(node => node.props.accessibilityLabel === 'Recipient address')?.props.value, '');
  scan(); scanner = all(f.render()).find(node => node.type === 'UtxoRecipientQrScanner')!;
  f.changeNetwork('syscoin'); f.render(); scanner.props.onScan('bc1qoldnetwork');
  assert(!all(f.render()).some(node => node.type === 'UtxoRecipientQrScanner'));
  assert.equal(all(f.render()).find(node => node.props.accessibilityLabel === 'Recipient address')?.props.value, '');
  assert.equal(f.requests.length, 0); f.close();
});

test('retired UTXO Scan and Change callbacks cannot reopen navigation', async () => {
  const f = fixture(); f.render(); await tick();
  const before = all(f.render());
  const scan = before.find(node => node.type === 'IconButton' && node.props.label === 'Scan recipient address')!;
  const change = before.find(node => node.type === 'Button' && node.props.title === 'Change')!;
  before.find(node => node.type === 'Header')!.props.onBack();
  scan.props.onPress(); change.props.onPress();
  assert.equal(f.counts().networkChanges, 0);
  assert(!all(f.render()).some(node => node.type === 'UtxoRecipientQrScanner'));
  f.close();
});

test('UTXO Change captures the unsigned amount and options before retiring its controller', async () => {
  const f = fixture(); f.render(); await tick();
  f.edit('Recipient address', 'bc1qfixture'); f.edit('Amount in BTC', '0.12345678');
  f.press('Advanced options'); f.press('Replace-by-fee enabled'); f.press('Change');
  assert.deepEqual(JSON.parse(JSON.stringify(f.networkDrafts)), [{ kind: 'utxo', recipient: 'bc1qfixture', amount: '0.12345678', max: false, rbf: false }]);
  assert.equal(f.requests.length, 0); assert.equal(f.counts().confirmations, 0); assert(f.counts().cancels > 0); f.close();
});

test('submitted UTXO transaction action uses the saved hash and retires with the screen', async () => {
  const f = fixture(); f.render(); await tick();
  f.edit('Recipient address', 'bc1qfixture'); f.edit('Amount in BTC', '0.1'); f.review(); await tick();
  f.press('Confirm and send'); f.authentication().props.onConfirm({ method: 'pin', pin: '123456' }); await tick();
  const shown = all(f.render());
  const view = shown.find(node => node.type === 'Button' && node.props.title === 'View transaction');
  assert(view); view.props.onPress();
  assert.deepEqual(f.openedTransactions, ['ab'.repeat(32)]);
  assert.equal(shown.find(node => node.type === 'Button' && node.props.title === 'Done')?.props.variant, 'secondary');
  shown.find(node => node.type === 'Header')!.props.onBack(); view.props.onPress();
  assert.equal(f.openedTransactions.length, 1); f.close();
});
