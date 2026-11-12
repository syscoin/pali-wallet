import { AUTOMATIC_FEE, snapshotUtxoFeeChoice } from '../../../source/shared/transactionFeeChoice.ts';
import { trezorResumeDraft } from '../src/screens/trezorResumeDraft.ts';
import { languageMessages, nativeTranslationFixture } from './localizationFixture.ts';
import { createInstance } from 'i18next';
import { normalizeDecimalInput } from '../../../source/shared/decimalInput.ts';
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

function fixture(asset?: NativeUtxoAsset, maximum?: string, localization = nativeTranslationFixture) {
  let initialDraft: Extract<ReturnType<typeof trezorResumeDraft>, { kind: 'utxo' }>['draft'] | undefined;
  let network = getUtxoNetwork(asset ? 'syscoin' : 'bitcoin');
  let availableAmount: string | undefined = '1.25000001';
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
    '../platform/localization': localization,
    '../../../../source/shared/transactionFeeChoice': { AUTOMATIC_FEE, snapshotUtxoFeeChoice },
    './NetworkFeeSheet': { NetworkFeeSheet: 'NetworkFeeSheet' },
    '../../../../source/shared/decimalInput': { normalizeDecimalInput },
    react, 'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, '../ui': ui,
    '../core/amounts': { formatBaseUnits }, './NativeLedger': { NativeLedgerConnectionModal: 'Ledger' },
    './IdleActivityBoundary': { IdleTextInput: 'Input' },
    './UtxoRecipientQrScanner': { UtxoRecipientQrScanner: 'UtxoRecipientQrScanner' },
    '../../../../source/shared/syscoinAssetIds': { SYSX_ASSET_GUID, SYSX_ASSET_DECIMALS },
    '../../../../source/utils/syscoinAssetAmount': { isAssetAmountEqualToBalance, toEightDecimalBuilderAmount },
    '../../../../source/shared/utxoTransactionOptions': { snapshotUtxoRbf },
  };
  const module = { exports: {} as any };
  runInNewContext(code, { module, exports: module.exports, Error, require(name: string) { assert(Object.hasOwn(imports, name), name); return imports[name]; } });
  const requests: any[] = []; let cancels = 0, confirmations = 0, networkChanges = 0, gate: Promise<void> | undefined, release: (() => void) | undefined;
  let confirmationFailure: Error | undefined, confirmationGate: Promise<void> | undefined, signatures = 0;
  let retryReview: NativeUtxoReview | undefined;
  const authorized: { review: NativeUtxoReview; credential: NativeOperationCredential }[] = [];
  const openedTransactions: string[] = [];
  const networkDrafts: unknown[] = [];
  const reviews: NativeUtxoReview[] = [];
  let saved: { accepted: boolean; txid: string }[] = [], listReads = 0, refreshReads = 0;
  const service = {
    cancel() { cancels++; }, async list() { listReads++; return saved; },
    async refreshSaved() { refreshReads++; return service.list(); },
    async check() { saved = []; return 'confirmed' as const; },
    async prepareRetry(txid: string) {
      assert(retryReview);
      return { ...retryReview, retryTxid: txid };
    },
    async prepare(input: any): Promise<NativeUtxoReview> {
      requests.push(structuredClone(input));
      if (gate) await gate; // Deliberately deliver a late result after cancellation.
      const view = { transactionOptions: { rbf: input.rbf, ...(input.asset ? { zdag: !input.rbf } : {}) }, feeSatoshis: '100',
        outputs: [{ address: input.recipient, amountSatoshis: input.asset ? '294' : parseDecimalAmount(input.amount, network.decimals).toString(),
          ...(input.asset ? { asset: { assetGuid: input.asset.assetGuid, rawAmount: parseDecimalAmount(input.amount, input.asset.decimals).toString() } } : {}) }],
        ...(input.asset ? { assetDisplay: input.asset } : {}) };
      reviews.push(view); return view;
    },
    async confirm(review: NativeUtxoReview, credential: NativeOperationCredential) {
      const cancelAtStart = cancels; confirmations++; authorized.push({ review, credential });
      if (confirmationFailure) { const failure = confirmationFailure; confirmationFailure = undefined; throw failure; }
      if (confirmationGate) await confirmationGate;
      if (cancels !== cancelAtStart) throw Error('CANCELLED');
      signatures++; return { txid: 'ab'.repeat(32) };
    },
  };
  const open = async () => service;
  const render = () => { cursor = 0; const tree = module.exports.NativeUtxoSendScreen({ accountLabel: 'Account', asset,
    initialDraft, maximumAmount: maximum, availableAmount, network, open, onChangeNetwork(draft: unknown) { networkDrafts.push(draft); networkChanges++; }, onViewTransaction(txid: string) { openedTransactions.push(txid); }, onBack() {} }) as Element;
    effects.splice(0).forEach((run) => run()); return tree; };
  const press = (title: string) => { const button = all(render()).find((node) => node.type === 'Button' && node.props.title === title); assert(button, title); button.props.onPress(); };
  const edit = (label: string, value: string) => { const input = all(render()).find((node) => node.type === 'Input' && node.props.accessibilityLabel === label); assert(input, label); input.props.onChangeText(value); };
  const review = () => { const screen = all(render()).find((node) => node.type === 'Screen')!; screen.props.footer.props.onPress(); };
  return { render, press, edit, review, requests, reviews, authorized, openedTransactions, networkDrafts, counts: () => ({ cancels, confirmations, networkChanges }),
    seedDraft(draft: NonNullable<typeof initialDraft>) { initialDraft = draft; },
    seedSaved(records: typeof saved) { saved = records; }, listReads: () => listReads, refreshReads: () => refreshReads,
    holdConfirmation(wait: Promise<void>) { confirmationGate = wait; }, signatures: () => signatures,
    failConfirmation(message: string) { confirmationFailure = new Error(message); },
    failSubmissionUnknown() { confirmationFailure = Object.assign(new Error('UTXO_SUBMISSION_UNKNOWN'), { code: 'UTXO_SUBMISSION_UNKNOWN', txid: 'ab'.repeat(32) }); },
    seedRetryReview(review: NativeUtxoReview) { retryReview = review; },
    changeBalance(value: string) { maximum = value; },
    changeNetwork(id: string) { network = getUtxoNetwork(id); },
    changeAvailable(value: string | undefined) { availableAmount = value; },
    hold() { gate = new Promise<void>((resolve) => { release = resolve; }); },
    release() { release?.(); gate = undefined; },
    close() { cells.forEach((value) => value.cleanup?.()); } };
}

test('explicit saved status check reloads the filtered recovery list', async () => {
  const f = fixture();
  f.seedSaved([{ accepted: true, txid: 'ab'.repeat(32) }]);
  f.render(); await tick();
  assert.equal(f.listReads(), 1);
  assert.equal(f.refreshReads(), 1);
  f.press('Submitted abababab…'); await tick();
  assert.equal(f.listReads(), 2);
  assert.equal(f.refreshReads(), 1, 'Explicit status reload must not observe the network again');
  assert.equal(all(f.render()).some(node => node.props.title === 'Submitted abababab…'), false);
  assert.equal(f.counts().confirmations, 0);
  f.close();
});

test('device refusal keeps the exact UTXO review available for retry', async () => {
  const f = fixture(); f.render(); await tick();
  try {
    f.edit('Recipient address', 'bc1qfixture'); f.edit('Amount in BTC', '0.1'); f.review(); await tick();
    const reviewed = f.reviews[0]; f.failConfirmation('DEVICE_UNLOCK_UNAVAILABLE');
    f.press('Confirm and send'); await tick();
    assert.equal(f.counts().confirmations, 1); assert.equal(f.signatures(), 0);
    assert(all(f.render()).some(node => node.props.accessibilityRole === 'alert'));
    f.press('Confirm and send'); await tick();
    assert.deepEqual(f.authorized.map(value => value.credential.method), ['device', 'device']);
    assert.strictEqual(f.authorized[0]?.review, reviewed); assert.strictEqual(f.authorized[1]?.review, reviewed);
    assert.equal(f.signatures(), 1);
  } finally { f.close(); }
});

test('native options start collapsed, preserve RBF default and bind a changed option to review', async () => {
  const f = fixture(); f.render(); await tick();
  assert(!all(f.render()).some((node) => node.props.title === 'Replace-by-fee enabled'));
  f.edit('Recipient address', 'bc1qfixture'); f.edit('Amount in BTC', '0.1'); f.review(); await tick();
  assert.equal(f.requests[0].rbf, true);
  all(f.render()).find((node) => node.type === 'Header')!.props.onBack(); f.render();
  f.press('Advanced options'); f.press('Replace-by-fee enabled'); f.review(); await tick();
  assert.equal(f.requests[1].rbf, false);
  const text = all(f.render()).flatMap((node) => node.children).join(' '); assert.match(text, /Replace-by-fee/); assert.match(text, /Disabled/);
  f.press('Confirm and send');
  await tick(); assert.equal(f.counts().confirmations, 1); f.close();
});

test('UTXO confirmation directly requests device authorization once without a local PIN page', async () => {
  const f = fixture(), held = Promise.withResolvers<void>(); f.render(); await tick();
  try {
    f.edit('Recipient address', 'bc1qfixture'); f.edit('Amount in BTC', '0.1'); f.review(); await tick();
    const reviewed = f.reviews[0]; f.holdConfirmation(held.promise);
    f.press('Confirm and send'); f.press('Confirm and send');
    assert.equal(f.counts().confirmations, 1); assert.equal(f.signatures(), 0);
    assert.equal(f.authorized[0]?.credential.method, 'device'); assert.strictEqual(f.authorized[0]?.review, reviewed);
    assert.equal(all(f.render()).some(node => node.type === 'TransactionAuthentication'), false);
    held.resolve(); await tick(); assert.equal(f.signatures(), 1);
  } finally { held.resolve(); f.close(); }
});

for (const replacement of [false, true]) test(`stale UTXO confirmation after Back${replacement ? ' and a new review' : ''} cannot authorize`, async () => {
  const f = fixture(); f.render(); await tick();
  try {
    f.edit('Recipient address', 'bc1qfixture'); f.edit('Amount in BTC', '0.1'); f.review(); await tick();
    const confirm = all(f.render()).find(node => node.type === 'Button' && node.props.title === 'Confirm and send')!;
    all(f.render()).find(node => node.type === 'Header')!.props.onBack(); f.render();
    if (replacement) { f.edit('Amount in BTC', '0.2'); f.review(); await tick(); }
    confirm.props.onPress(); await tick(); assert.equal(f.counts().confirmations, 0);
    if (replacement) { f.press('Confirm and send'); await tick(); assert.equal(f.counts().confirmations, 1); }
  } finally { f.close(); }
});

test('UTXO unmount during device authorization discards the late result', async () => {
  const f = fixture(), held = Promise.withResolvers<void>(); f.render(); await tick();
  f.edit('Recipient address', 'bc1qfixture'); f.edit('Amount in BTC', '0.1'); f.review(); await tick();
  f.holdConfirmation(held.promise); f.press('Confirm and send'); assert.equal(f.counts().confirmations, 1);
  f.close(); held.resolve(); await tick(); assert.equal(f.signatures(), 0);
});

test('SPT Z-DAG uses the inverse RBF option and MAX fills the selected exact total once', async () => {
  const asset = { assetGuid: '123456', decimals: 3, symbol: 'SPT' };
  const f = fixture(asset, '2.125'); f.render(); await tick();
  f.edit('Recipient address', 'sys1qfixture'); f.press('MAX'); f.press('Advanced options'); f.press('Z-DAG disabled');
  assert.equal(all(f.render()).find((node) => node.props.accessibilityLabel === 'Amount in SPT')!.props.value, '2.125');
  f.changeBalance('3.0'); f.render(); f.render();
  f.review(); await tick();
  assert.deepEqual(f.requests[0], { recipient: 'sys1qfixture', amount: '2.125', max: false, asset, rbf: false, feeChoice: AUTOMATIC_FEE });
  f.close();
});

test('SPT review binds artwork to network and GUID rather than issuer symbol', async () => {
  const f = fixture({ assetGuid: '987654321', decimals: 3, symbol: 'BTC' }, '2.125');
  try {
    f.render(); await tick(); f.edit('Recipient address', 'sys1qfixture'); f.press('MAX'); f.review(); await tick();
    const icon = all(f.render()).find(node => node.type === 'Coin' && node.props.asset);
    assert(icon); assert.equal(icon.props.id, 'spt');
    assert.deepEqual(JSON.parse(JSON.stringify(icon.props.asset)), { kind: 'spt', chainId: 57, assetGuid: '987654321', decimals: 3 });
    assert.equal(icon.props.fallbackSymbol, 'BTC');
  } finally { f.close(); }
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

test('resumed SPT without an observed token balance displays unavailable and does not offer MAX', async () => {
  const f = fixture({ assetGuid: '123456', decimals: 3, symbol: 'SPT' });
  f.changeAvailable(undefined); f.render(); await tick();
  try {
    const elements = all(f.render());
    const balance = elements.find(node => node.type === 'Text' && node.props.accessibilityLabel === 'Available unavailable SPT');
    assert(balance); assert.equal(balance.children.join(''), 'Available — SPT');
    assert(!elements.some(node => node.props.title === 'MAX'));
    assert.equal(f.requests.length, 0);
  } finally { f.close(); }
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
  f.press('Confirm and send'); await tick();
  const shown = all(f.render());
  const view = shown.find(node => node.type === 'Button' && node.props.title === 'View transaction');
  assert(view); view.props.onPress();
  assert.deepEqual(f.openedTransactions, ['ab'.repeat(32)]);
  assert.equal(shown.find(node => node.type === 'Button' && node.props.title === 'Done')?.props.variant, 'secondary');
  shown.find(node => node.type === 'Header')!.props.onBack(); view.props.onPress();
  assert.equal(f.openedTransactions.length, 1); f.close();
});

test('successful native UTXO outcome retains the exact reviewed amount, recipient and fee', async () => {
  const f = fixture();
  try {
    f.render(); await tick();
    f.edit('Recipient address', 'bc1qreviewedrecipient'); f.edit('Amount in BTC', '0.12345678');
    f.review(); await tick();
    f.press('Confirm and send'); await tick();
    const shown = all(f.render());
    assert.equal(shown.find(node => node.props.testID === 'native-utxo-outcome-amount')?.children.join(''), '0.12345678 BTC');
    assert.equal(shown.find(node => node.props.testID === 'native-utxo-outcome-recipient')?.children.join(''), 'bc1qreviewedrecipient');
    assert.equal(shown.find(node => node.props.testID === 'native-utxo-outcome-fee')?.children.join(''), '0.000001 BTC');
    assert(shown.some(node => node.type === 'Coin' && node.props.id === 'bitcoin'));
    assert(shown.some(node => node.type === 'Notice' && node.props.title === 'Submitted'));
    assert(!shown.some(node => node.type === 'TransactionAuthentication'));
  } finally { f.close(); }
});

test('unknown SPT submission retains its exact public summary through a status check', async () => {
  const asset = { assetGuid: '987654321', decimals: 3, symbol: 'SPT' };
  const f = fixture(asset);
  try {
    f.render(); await tick();
    f.edit('Recipient address', 'sys1qreviewedrecipient'); f.edit('Amount in SPT', '9007199254740.993');
    f.review(); await tick(); f.failSubmissionUnknown();
    f.press('Confirm and send'); await tick();
    const assertSummary = (title: string) => {
      const shown = all(f.render());
      assert.equal(shown.find(node => node.props.testID === 'native-utxo-outcome-amount')?.children.join(''), '9007199254740.993 SPT');
      assert.equal(shown.find(node => node.props.testID === 'native-utxo-outcome-recipient')?.children.join(''), 'sys1qreviewedrecipient');
      assert.equal(shown.find(node => node.props.testID === 'native-utxo-outcome-carrier')?.children.join(''), '0.00000294 SYS');
      assert.equal(shown.find(node => node.props.testID === 'native-utxo-outcome-fee')?.children.join(''), '0.000001 SYS');
      assert(shown.some(node => node.type === 'Text' && node.children.join('') === asset.assetGuid));
      const icon = shown.find(node => node.type === 'Coin' && node.props.asset);
      assert.deepEqual(JSON.parse(JSON.stringify(icon?.props.asset)), { kind: 'spt', chainId: 57, assetGuid: asset.assetGuid, decimals: 3 });
      assert(shown.some(node => node.type === 'Notice' && node.props.title === title));
      assert(!shown.some(node => node.type === 'TransactionAuthentication'));
    };
    assertSummary('Submission unverified');
    f.press('Check status'); await tick();
    assertSummary('Confirmed');
    assert.equal(f.counts().confirmations, 1);
    assert.equal(f.requests.length, 1);
  } finally { f.close(); }
});

test('saved UTXO replay outcome keeps Output 1 without identifying it as the recipient', async () => {
  const f = fixture();
  try {
    f.seedRetryReview({ transactionOptions: { rbf: true }, feeSatoshis: '100', outputs: [
      { address: 'bc1qfirstoutput', amountSatoshis: '900001' },
      { address: 'bc1qotheroutput', amountSatoshis: '12345678' },
    ] });
    f.render(); await tick();
    f.edit('Recipient address', 'bc1qreviewedrecipient'); f.edit('Amount in BTC', '0.12345678');
    f.review(); await tick(); f.failSubmissionUnknown();
    f.press('Confirm and send'); await tick();
    f.press('Review saved transfer'); await tick();
    f.press('Resend saved transfer'); await tick();
    const assertSummary = () => {
      const shown = all(f.render());
      assert(shown.some(node => node.type === 'Text' && node.children.join('') === 'Output 1'));
      assert(!shown.some(node => node.type === 'Text' && node.children.join('') === 'Recipient'));
      assert.equal(shown.find(node => node.props.testID === 'native-utxo-outcome-recipient')?.children.join(''), 'bc1qfirstoutput');
      assert.equal(shown.find(node => node.props.testID === 'native-utxo-outcome-amount')?.children.join(''), '0.00900001 BTC');
    };
    assertSummary();
    f.press('Check status'); await tick(); assertSummary();
    assert.equal(f.counts().confirmations, 2);
  } finally { f.close(); }
});

test('UTXO amount entry normalizes the selected language decimal before exact preparation', async () => {
  const i18n = createInstance();
  await i18n.init({ initImmediate: false, lng: 'de', fallbackLng: false,
    resources: { de: { translation: languageMessages('de') } }, interpolation: { escapeValue: false } });
  const f = fixture(undefined, undefined, { nativeI18n: i18n, useNativeTranslation: () => ({ t: i18n.t.bind(i18n), i18n }) });
  try {
    f.render(); await tick();
    f.edit(i18n.t('blacklist.recipientDescription'), 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
    f.edit(i18n.t('mobile.smartSendViews.amountInSymbol', { symbol: 'BTC' }), '0,25');
    f.review(); await tick();
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].amount, '0.25');
    assert.equal(f.reviews[0]!.outputs[0]!.amountSatoshis, '25000000');
    assert.equal(f.signatures(), 0);
  } finally { f.close(); }
});


test('UTXO fee sheet selection reaches a fresh prepare and cannot reuse consent', async () => {
  const f = fixture(); f.render(); await tick();
  f.edit('Recipient address', 'bc1qfixture'); f.edit('Amount in BTC', '0.1');
  f.press('Network Fee · Automatic');
  const sheet = all(f.render()).find(node => node.type === 'NetworkFeeSheet'); assert(sheet);
  sheet.props.onApply({ kind: 'custom', satPerVbyte: '7' });
  assert(f.counts().cancels > 0);
  f.review(); await tick();
  assert.deepEqual(f.requests[0].feeChoice, { kind: 'custom', satPerVbyte: '7' });
  f.close();
});

test('Trezor UTXO resume keeps custom seven sat/vB, MAX and RBF in the actual form', async () => {
  const resumed = trezorResumeDraft({ id: 'resume', kind: 'utxo', accountId: 'trezor:0:0', networkId: 'bitcoin',
    recipient: 'bc1qfixture', amount: '', max: true, rbf: false, feeChoice: { kind: 'custom', satPerVbyte: '7' } });
  assert.equal(resumed.kind, 'utxo');
  if (resumed.kind !== 'utxo') throw Error('Unexpected resume');
  const f = fixture();
  try {
    f.seedDraft(resumed.draft); f.render(); await tick();
    assert(all(f.render()).some(node => node.props.title === 'Network Fee · Custom'));
    f.review(); await tick();
    assert.deepEqual(f.requests[0], { recipient: 'bc1qfixture', amount: '', max: true, asset: undefined, rbf: false,
      feeChoice: { kind: 'custom', satPerVbyte: '7' } });
    assert.equal(f.signatures(), 0);
  } finally { f.close(); }
});
