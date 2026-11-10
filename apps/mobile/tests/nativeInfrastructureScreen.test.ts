import assert from 'node:assert/strict';
import test from 'node:test';
import { PALI_INFRASTRUCTURE_METADATA } from '../../../source/utils/smartAccount/deploymentMetadata.ts';
import { projectSmartAccountInfrastructureObservation } from '../../../source/utils/smartAccount/infrastructureObservation.ts';
import type { NativePreparedConnectionTransaction } from '../src/connections/transactionRuntime.ts';
import { formatBaseUnits } from '../src/core/amounts.ts';
import { NativeInfrastructureController } from '../src/smartAccount/infrastructure.ts';
import { englishI18n, nativeTranslationFixture } from './localizationFixture.ts';
import { screenElements, screenFixture } from './screenFixture.ts';

const payer = '0x1111111111111111111111111111111111111111';
const hash = `0x${'ab'.repeat(32)}`;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const title = (key: string) => englishI18n.t(key);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}
function nativeScreen() {
  const events = new Map<string, Set<(...values: any[]) => unknown>>();
  const add = (name: string, listener: (...values: any[]) => unknown) => {
    const listeners = events.get(name) ?? new Set(); listeners.add(listener); events.set(name, listeners);
    return { remove() { listeners.delete(listener); } };
  };
  const appState = { currentState: 'active', addEventListener: add };
  const fixture = screenFixture(new URL('../src/screens/NativeInfrastructure.tsx', import.meta.url), 'NativeInfrastructure', {
    '../platform/localization': nativeTranslationFixture,
    '../core/amounts': { formatBaseUnits },
    'react-native': { ActivityIndicator: 'ActivityIndicator', AppState: appState, BackHandler: { addEventListener: add }, Platform: { OS: 'android' }, StyleSheet: { create: (value: unknown) => value } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Header', 'Notice', 'Screen', 'Text'].map(name => [name, name])), colors: {} },
    './NativeTransactionReview': { TransactionDetails: 'TransactionDetails' },
  }, { AbortController });
  return {
    render: (props: Parameters<typeof fixture.render>[0]) => screenElements(fixture.render(props)),
    emit(name: string, value?: unknown) {
      if (name === 'change') appState.currentState = value as string;
      for (const listener of events.get(name) ?? []) listener(value);
    },
    close: fixture.close,
  };
}
function button(elements: ReturnType<typeof screenElements>, key: string) {
  const element = elements.find(node => node.type === 'Button' && node.props.title === title(key));
  assert(element, `Missing ${key}`);
  return element;
}
const text = (elements: ReturnType<typeof screenElements>) => elements.flatMap(node => node.children.filter(value => typeof value === 'string')).join(' ');
function runtime(signal: AbortSignal, assertCurrent: () => void) {
  const transaction = Object.freeze({ chainId: '1', from: payer, to: '0x4e59b44847b379578588920cA78FbF26c0B4956C', nonce: '0', value: '0', data: '0xab', gasLimit: '21000', type: 2 as const, maxFeePerGas: '2', maxPriorityFeePerGas: '1', accessList: [] });
  let signatures = 0, wires = 0, submissions = 0, disposed = 0;
  let refuseSubmission = false;
  let quoteWait: Promise<void> = Promise.resolve(), sendWait: Promise<void> = Promise.resolve();
  let broadcastWait: Promise<void> = Promise.resolve();
  const prepared = Object.freeze({
    transaction, maximumFeeUnits: '42000', coveredFeeUnits: '0', maximumTotalUnits: '42000', approval: null,
    expiresAtMonotonicMilliseconds: 60000,
    async submit(guard: () => void, broadcast: (hash: string) => void) {
      submissions++;
      await sendWait; guard(); signatures++;
      if (refuseSubmission) throw Object.assign(new Error('refused'), { transactionNotBroadcast: true });
      await broadcastWait; guard(); broadcast(hash); wires++;
      return hash;
    },
  }) as unknown as NativePreparedConnectionTransaction;
  const observation = projectSmartAccountInfrastructureObservation(1, ['0x01', ...PALI_INFRASTRUCTURE_METADATA.map(() => '0x')])!;
  const controller = new NativeInfrastructureController({
    networkLabel: 'Ethereum', currencySymbol: 'ETH', payerLabel: 'Fee wallet', payerAddress: payer,
    assertCurrent,
    dispose() { disposed++; },
    async observe() { assertCurrent(); return { observation, pending: null }; },
    async prepare() { await quoteWait; assertCurrent(); return prepared; },
    submissionFailure(error: unknown) {
      return error && typeof error === 'object' && 'transactionNotBroadcast' in error ? { transactionNotBroadcast: true } : undefined;
    },
  }, signal, () => 0);
  return {
    controller, transaction,
    holdQuote(promise: Promise<void>) { quoteWait = promise; },
    holdSigning(promise: Promise<void>) { sendWait = promise; },
    holdBroadcast(promise: Promise<void>) { broadcastWait = promise; },
    failSubmission() { refuseSubmission = true; },
    get counts() { return { disposed, signatures, wires, submissions }; },
  };
}

for (const action of ['close', 'back', 'background', 'blur', 'unmount'] as const)
  test(`the ${action} path retires an opening and disposes its late controller`, async () => {
    const screen = nativeScreen(), held = deferred<NativeInfrastructureController>();
    let check!: () => void, signal!: AbortSignal, backs = 0;
    const props = { open(parent: AbortSignal, assertCurrent: () => void) { signal = parent; check = assertCurrent; return held.promise; }, onBack() { backs++; } };
    const tree = screen.render(props);
    if (action === 'close') button(tree, 'buttons.close').props.onPress();
    if (action === 'back') screen.emit('hardwareBackPress');
    if (action === 'background') screen.emit('change', 'background');
    if (action === 'blur') screen.emit('blur');
    if (action === 'unmount') screen.close();
    assert(signal.aborted); assert.throws(check, /CANCELLED/);
    const late = runtime(signal, check);
    held.resolve(late.controller); await tick();
    assert.equal(late.counts.disposed, 1);
    assert.equal(late.counts.signatures, 0);
    assert.equal(backs, action === 'unmount' ? 0 : 1);
    screen.close();
  });

test('old opening guards and close callbacks cannot adopt the next screen owner', async () => {
  const screen = nativeScreen(), first = deferred<NativeInfrastructureController>(), second = deferred<NativeInfrastructureController>();
  let firstSignal!: AbortSignal, firstCheck!: () => void, secondSignal!: AbortSignal, secondCheck!: () => void, backs = 0;
  const onBack = () => { backs++; };
  const oldProps = { open(signal: AbortSignal, check: () => void) { firstSignal = signal; firstCheck = check; return first.promise; }, onBack };
  const oldTree = screen.render(oldProps);
  const staleClose = button(oldTree, 'buttons.close').props.onPress;
  const newProps = { open(signal: AbortSignal, check: () => void) { secondSignal = signal; secondCheck = check; return second.promise; }, onBack };
  screen.render(newProps);
  staleClose();
  assert.equal(backs, 0); assert.throws(firstCheck, /CANCELLED/); secondCheck();
  const retired = runtime(firstSignal, firstCheck), active = runtime(secondSignal, secondCheck);
  first.resolve(retired.controller); second.resolve(active.controller); await tick();
  assert.equal(retired.counts.disposed, 1);
  assert.equal(active.counts.disposed, 0);
  staleClose(); assert.equal(active.counts.disposed, 0);
  screen.close(); assert.equal(active.counts.disposed, 1);
});

test('the real controller screen separates Review from Confirm and displays the exact prepared transaction', async () => {
  const screen = nativeScreen(); let value!: ReturnType<typeof runtime>;
  const props = { async open(signal: AbortSignal, check: () => void) { value = runtime(signal, check); return value.controller; }, onBack() {} };
  try {
    screen.render(props); await tick();
    let tree = screen.render(props);
    assert.match(text(tree), /Ethereum/); assert.match(text(tree), /Fee wallet/); assert.match(text(tree), new RegExp(payer));
    assert.notEqual(button(tree, 'mobile.infrastructure.reviewNext').props.disabled, true);
    button(tree, 'mobile.infrastructure.reviewNext').props.onPress(); await tick();
    tree = screen.render(props);
    assert.equal(value.counts.submissions, 0);
    assert.match(text(tree), /0\.000000000000042\s+ETH/);
    assert.match(text(tree), new RegExp(PALI_INFRASTRUCTURE_METADATA[0]!.address));
    button(tree, 'send.showDetails').props.onPress();
    tree = screen.render(props);
    assert.equal(tree.find(node => node.type === 'TransactionDetails')!.props.transaction, value.transaction);
    button(tree, 'buttons.confirm').props.onPress(); await tick();
    tree = screen.render(props);
    assert.equal(value.counts.submissions, 1); assert.equal(value.counts.wires, 1);
    assert.match(text(tree), new RegExp(hash));
    assert.equal(tree.some(node => node.type === 'Button' && node.props.title === title('mobile.infrastructure.reviewNext')), false);
    assert.notEqual(button(tree, 'mobile.infrastructure.refresh').props.disabled, true);
    assert.equal(tree.some(node => node.type === 'Button' && node.props.title === title('buttons.confirm')), false);
  } finally { screen.close(); }
});

test('a stale rendered Confirm cannot approve a review created after Refresh', async () => {
  const screen = nativeScreen(); let value!: ReturnType<typeof runtime>;
  const props = { async open(signal: AbortSignal, check: () => void) { value = runtime(signal, check); return value.controller; }, onBack() {} };
  try {
    screen.render(props); await tick();
    button(screen.render(props), 'mobile.infrastructure.reviewNext').props.onPress(); await tick();
    const oldTree = screen.render(props), oldConfirm = button(oldTree, 'buttons.confirm').props.onPress;
    await value.controller.refresh(value.controller.getSnapshot().revision); await tick();
    button(screen.render(props), 'mobile.infrastructure.reviewNext').props.onPress(); await tick();
    oldConfirm(); await tick(); assert.equal(value.counts.submissions, 0);
    button(screen.render(props), 'buttons.confirm').props.onPress(); await tick();
    assert.equal(value.counts.submissions, 1);
  } finally { screen.close(); }
});

test('the review keeps its sole primary action in the fixed footer for a short 320px screen', async () => {
  const screen = nativeScreen(); let value!: ReturnType<typeof runtime>;
  const props = { async open(signal: AbortSignal, check: () => void) { value = runtime(signal, check); return value.controller; }, onBack() {} };
  try {
    screen.render(props); await tick();
    const before = screen.render(props).find(node => node.type === 'Screen')!;
    button(screen.render(props), 'mobile.infrastructure.reviewNext').props.onPress(); await tick();
    const tree = screen.render(props), container = tree.find(node => node.type === 'Screen');
    assert(container);
    assert.notEqual(container.props.key, before.props.key, 'new review resets the inventory scroll position');
    // Screen renders this footer outside its body ScrollView, without a scrollable footer.
    // This remains the same structure at 320px width and short viewport heights.
    assert.notEqual(container.props.footerScrollable, true);
    const fixed = screenElements(container.props.footer), scrolling = screenElements(container.children);
    assert.equal(fixed.filter(node => node.type === 'Button' && node.props.title === title('buttons.confirm')).length, 1);
    assert.equal(button(fixed, 'buttons.confirm').props.disabled, false);
    assert.equal(button(fixed, 'buttons.close').props.disabled, undefined);
    assert.equal(scrolling.some(node => node.type === 'Button' && node.props.title === title('buttons.confirm')), false);
    assert.equal(scrolling.some(node => node.type === 'Button' && node.props.title === title('buttons.close')), false);
    assert.doesNotMatch(text(scrolling), new RegExp(PALI_INFRASTRUCTURE_METADATA[1]!.address));
    assert.doesNotMatch(text(scrolling), /0x4e59b44847b379578588920cA78FbF26c0B4956C/);
    assert.match(text(scrolling), new RegExp(PALI_INFRASTRUCTURE_METADATA[0]!.address));
    assert.match(text(scrolling), /Ethereum/); assert.match(text(scrolling), /Fee wallet/);
    assert.match(text(scrolling), /0\.000000000000042\s+ETH/);
    button(fixed, 'buttons.confirm').props.onPress(); await tick();
    assert.equal(value.counts.submissions, 1);
  } finally { screen.close(); }
});

test('status and result actions stay in a two-button footer and failure text precedes inventory', async () => {
  const screen = nativeScreen(); let value!: ReturnType<typeof runtime>;
  const props = { async open(signal: AbortSignal, check: () => void) { value = runtime(signal, check); return value.controller; }, onBack() {} };
  const footer = (tree: ReturnType<typeof screenElements>) => screenElements(tree.find(node => node.type === 'Screen')!.props.footer);
  try {
    screen.render(props); await tick();
    let tree = screen.render(props);
    assert.equal(footer(tree).filter(node => node.type === 'Button').length, 2);
    button(footer(tree), 'mobile.infrastructure.reviewNext'); button(footer(tree), 'buttons.close');
    value.failSubmission();
    button(tree, 'mobile.infrastructure.reviewNext').props.onPress(); await tick();
    button(screen.render(props), 'buttons.confirm').props.onPress(); await tick();
    tree = screen.render(props);
    assert.equal(footer(tree).filter(node => node.type === 'Button').length, 2);
    button(footer(tree), 'mobile.infrastructure.refresh'); button(footer(tree), 'buttons.close');
    assert.equal(tree.some(node => node.type === 'Button' && node.props.title === title('mobile.infrastructure.reviewNext')), false);
    const alert = tree.findIndex(node => node.props.accessibilityRole === 'alert');
    const inventory = tree.findIndex(node => node.children.includes(title('mobile.infrastructure.create2Deployer')));
    assert(alert >= 0 && inventory > alert);
  } finally { screen.close(); }
});

for (const stage of ['quote', 'signing', 'broadcast'] as const)
  test(`background while awaiting ${stage} prevents the next signing or publication boundary`, async () => {
    const screen = nativeScreen(), held = deferred<void>(); let value!: ReturnType<typeof runtime>;
    const props = { async open(signal: AbortSignal, check: () => void) { value = runtime(signal, check); return value.controller; }, onBack() {} };
    try {
      screen.render(props); await tick();
      if (stage === 'quote') value.holdQuote(held.promise);
      if (stage === 'signing') value.holdSigning(held.promise);
      if (stage === 'broadcast') value.holdBroadcast(held.promise);
      button(screen.render(props), 'mobile.infrastructure.reviewNext').props.onPress(); await tick();
      if (stage !== 'quote') { button(screen.render(props), 'buttons.confirm').props.onPress(); await tick(); }
      screen.emit('change', 'background'); held.resolve(); await tick();
      assert.equal(value.counts.disposed, 1);
      assert.equal(value.counts.wires, 0);
      assert.equal(value.counts.signatures, stage === 'broadcast' ? 1 : 0);
      assert.equal(value.controller.getSnapshot().feeReview, null);
    } finally { held.resolve(); screen.close(); }
  });
