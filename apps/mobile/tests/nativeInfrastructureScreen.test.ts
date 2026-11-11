import * as privateAuthentication from '../src/custody/privateAuthentication.ts';
import { allowsPrivateAuthenticationInterruption } from '../src/screens/privateAuthenticationLifecycle.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { PALI_INFRASTRUCTURE_METADATA } from '../../../source/utils/smartAccount/deploymentMetadata.ts';
import { projectSmartAccountInfrastructureObservation } from '../../../source/utils/smartAccount/infrastructureObservation.ts';
import type { NativePreparedConnectionTransaction } from '../src/connections/transactionRuntime.ts';
import type { NativeLedgerConnectionView, NativeLedgerSnapshot } from '../src/custody/ledgerAccounts.ts';
import { formatBaseUnits } from '../src/core/amounts.ts';
import type { useOwnedLedgerConnection } from '../src/screens/useDappLedgerConnection';
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
function nativeScreen(clock = { wall: 100_000, monotonic: 0 }) {
  const events = new Map<string, Set<(...values: any[]) => unknown>>();
  const add = (name: string, listener: (...values: any[]) => unknown) => {
    const listeners = events.get(name) ?? new Set(); listeners.add(listener); events.set(name, listeners);
    return { remove() { listeners.delete(listener); } };
  };
  const appState = { currentState: 'active', addEventListener: add };
  const timers = new Set<() => void>();
  const globals = {
    AbortController,
    Date: class extends Date { static now() { return clock.wall; } },
    performance: { now: () => clock.monotonic },
    setTimeout(callback: () => void) { timers.add(callback); return callback; },
    clearTimeout(callback: () => void) { timers.delete(callback); },
  };
  const hook = screenFixture(new URL('../src/screens/useDappLedgerConnection.tsx', import.meta.url), 'useOwnedLedgerConnection', {
    './NativeLedger': { NativeLedgerConnectionModal: 'LedgerModal' },
  }, globals);
  let connectionProps: Parameters<typeof useOwnedLedgerConnection>[0] | undefined;
  const fixture = screenFixture(new URL('../src/screens/NativeInfrastructure.tsx', import.meta.url), 'NativeInfrastructure', {
    '../custody/privateAuthentication': privateAuthentication,
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption },
    '../platform/localization': nativeTranslationFixture,
    '../core/amounts': { formatBaseUnits },
    'react-native': { ActivityIndicator: 'ActivityIndicator', AppState: appState, BackHandler: { addEventListener: add }, Platform: { OS: 'android' }, StyleSheet: { create: (value: unknown) => value } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Header', 'Notice', 'Screen', 'Text'].map(name => [name, name])), colors: {} },
    './NativeTransactionReview': { TransactionDetails: 'TransactionDetails' },
    './useDappLedgerConnection': { useOwnedLedgerConnection(props: Parameters<typeof useOwnedLedgerConnection>[0]) {
      connectionProps = props;
      return hook.render(props);
    } },
  }, globals);
  return {
    render: (props: Parameters<typeof fixture.render>[0]) => screenElements(fixture.render(props)),
    emit(name: string, value?: unknown) {
      if (name === 'change') appState.currentState = value as string;
      for (const listener of events.get(name) ?? []) listener(value);
    },
    get connectionDeadline() { return connectionProps?.expiresAt; },
    close() { fixture.close(); hook.close(); },
  };
}
function button(elements: ReturnType<typeof screenElements>, key: string) {
  const element = elements.find(node => node.type === 'Button' && node.props.title === title(key));
  assert(element, `Missing ${key}`);
  return element;
}
const text = (elements: ReturnType<typeof screenElements>) => elements.flatMap(node => node.children.filter(value => typeof value === 'string')).join(' ');
function runtime(signal: AbortSignal, assertCurrent: () => void, mode: 'missing' | 'optional-only' | 'all-present' | 'pending-optional' = 'missing', create2Deployed = true, now = () => 0, resumeId: string | null = null) {
  const transaction = Object.freeze({ chainId: '1', from: payer, to: '0x4e59b44847b379578588920cA78FbF26c0B4956C', nonce: '0', value: '0', data: '0xab', gasLimit: '21000', type: 2 as const, maxFeePerGas: '2', maxPriorityFeePerGas: '1', accessList: [] });
  let signatures = 0, wires = 0, submissions = 0, disposed = 0;
  let observations = 0;
  const backgrounds: boolean[] = [];
  let refuseSubmission = false, unknownSubmission = false;
  let quoteWait: Promise<void> = Promise.resolve(), sendWait: Promise<void> = Promise.resolve();
  let broadcastWait: Promise<void> = Promise.resolve();
  const prepared: NativePreparedConnectionTransaction = Object.freeze({
    feeComparison: { recommendationOnly: false },
    transaction, maximumFeeUnits: '42000', coveredFeeUnits: '0', maximumTotalUnits: '42000', approval: null,
    expiresAtMonotonicMilliseconds: 60000,
    async submit(guard: () => void, broadcast: (hash: string) => void) {
      submissions++;
      await sendWait; guard(); signatures++;
      if (refuseSubmission) throw Object.assign(new Error('refused'), { transactionNotBroadcast: true });
      if (unknownSubmission) throw Error('Uncertain synthetic submission');
      await broadcastWait; guard(); broadcast(hash); wires++;
      return hash;
    },
  });
  const observation = projectSmartAccountInfrastructureObservation(1, [create2Deployed ? '0x01' : '0x', ...PALI_INFRASTRUCTURE_METADATA.map(entry => mode === 'all-present' || mode !== 'missing' && !entry.optional ? '0x01' : '0x')])!;
  const status = { observation, pending: mode === 'pending-optional' ? { contractId: 'multicall3' as const, transactionHash: resumeId === null ? hash : null } : null };
  const controller = new NativeInfrastructureController({
    origin: resumeId === null ? { kind: 'new' } : { kind: 'suite-resume', id: resumeId, async prepare(requestSignal) {
      assertCurrent(); if (requestSignal.aborted) throw Error('CANCELLED');
      return { status, contractId: 'multicall3', prepared };
    } },
    background() { backgrounds.push(signal.aborted); },
    networkLabel: 'Ethereum', currencySymbol: 'ETH', payerLabel: 'Fee wallet', payerAddress: payer,
    assertCurrent,
    dispose() { disposed++; },
    async observe() { assertCurrent(); observations++; return status; },
    async prepare() { await quoteWait; assertCurrent(); return prepared; },
    submissionFailure(error: unknown) {
      return error && typeof error === 'object' && 'transactionNotBroadcast' in error ? { transactionNotBroadcast: true } : undefined;
    },
  }, signal, now);
  return {
    controller, transaction,
    holdQuote(promise: Promise<void>) { quoteWait = promise; },
    holdSigning(promise: Promise<void>) { sendWait = promise; },
    holdBroadcast(promise: Promise<void>) { broadcastWait = promise; },
    failSubmission() { refuseSubmission = true; },
    failUnknownSubmission() { unknownSubmission = true; },
    async prepareResume() { await controller.reviewResume(controller.getSnapshot().revision); },
    backgrounds,
    reconcileOriginal() {
      status.pending = null;
      status.observation = projectSmartAccountInfrastructureObservation(1, ['0x01', ...PALI_INFRASTRUCTURE_METADATA.map(entry => entry.id === 'factory' ? '0x' : '0x01')])!;
    },
    get counts() { return { disposed, signatures, wires, submissions, observations }; },
  };
}

function ledgerConnection(connected = false) {
  let closes = 0;
  const actions: string[] = [];
  const snapshot: NativeLedgerSnapshot = Object.freeze({ phase: 'idle', networkId: 'ethereum', networkLabel: 'Ethereum',
    address: payer, devices: [], selectedName: null, error: null });
  const source: NativeLedgerConnectionView = {
    purpose: 'connect', getSnapshot: () => snapshot, subscribe: () => () => {}, isConnected: () => connected,
    async start() { actions.push('start'); },
    async select(id) { actions.push(`select:${id}`); },
    async finishConnection() { actions.push('finish'); connected = true; },
    async close() { closes++; },
  };
  return { source, actions, disconnect() { connected = false; }, get closes() { return closes; } };
}
const footer = (tree: ReturnType<typeof screenElements>) => screenElements(tree.find(node => node.type === 'Screen')!.props.footer);
function connectLedger(tree: ReturnType<typeof screenElements>) {
  const action = footer(tree).find(node => node.type === 'Button' && node.props.title === 'Connect Ledger');
  assert(action, 'Missing Connect Ledger');
  return action;
}
function ledgerPicker(tree: ReturnType<typeof screenElements>) {
  const modal = tree.find(node => node.type === 'LedgerModal');
  assert(modal, 'Missing Ledger picker');
  return modal;
}

for (const action of ['close', 'back', 'background', 'blur', 'unmount'] as const)
  test(`the ${action} path retires an opening and disposes its late controller`, async () => {
    const screen = nativeScreen(), held = deferred<NativeInfrastructureController>();
    let check!: () => void, signal!: AbortSignal, backs = 0;
    const props = { mode: {kind:'new' as const}, open(parent: AbortSignal, assertCurrent: () => void) { signal = parent; check = assertCurrent; return held.promise; }, onBack() { backs++; } };
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
  const oldProps = { mode: {kind:'new' as const}, open(signal: AbortSignal, check: () => void) { firstSignal = signal; firstCheck = check; return first.promise; }, onBack };
  const oldTree = screen.render(oldProps);
  const staleClose = button(oldTree, 'buttons.close').props.onPress;
  const newProps = { mode: {kind:'new' as const}, open(signal: AbortSignal, check: () => void) { secondSignal = signal; secondCheck = check; return second.promise; }, onBack };
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
  const props = { mode: {kind:'new' as const}, async open(signal: AbortSignal, check: () => void) { value = runtime(signal, check); return value.controller; }, onBack() {} };
  try {
    screen.render(props); await tick();
    let tree = screen.render(props);
    assert.match(text(tree), /Ethereum/); assert.match(text(tree), /Fee wallet/); assert.match(text(tree), new RegExp(payer));
    assert.notEqual(button(tree, 'mobile.infrastructure.reviewNext').props.disabled, true);
    button(tree, 'mobile.infrastructure.reviewNext').props.onPress(); await tick();
    tree = screen.render(props);
    assert.equal(value.counts.submissions, 0);
    assert.match(text(tree), /0\.000000000000042\s+ETH/);
    assert(!text(tree).includes(PALI_INFRASTRUCTURE_METADATA[0]!.address));
    button(tree, 'send.showDetails').props.onPress();
    tree = screen.render(props);
    assert.match(text(tree), new RegExp(PALI_INFRASTRUCTURE_METADATA[0]!.address));
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
  const props = { mode: {kind:'new' as const}, async open(signal: AbortSignal, check: () => void) { value = runtime(signal, check); return value.controller; }, onBack() {} };
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
  const props = { mode: {kind:'new' as const}, async open(signal: AbortSignal, check: () => void) { value = runtime(signal, check); return value.controller; }, onBack() {} };
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
    assert.doesNotMatch(text(scrolling), new RegExp(PALI_INFRASTRUCTURE_METADATA[0]!.address));
    assert.match(text(scrolling), /Process smart-account transactions/);
    assert.match(text(scrolling), /Ethereum/); assert.match(text(scrolling), /Fee wallet/);
    assert.match(text(scrolling), /0\.000000000000042\s+ETH/);
    button(fixed, 'buttons.confirm').props.onPress(); await tick();
    assert.equal(value.counts.submissions, 1);
  } finally { screen.close(); }
});

test('status and result actions stay in a two-button footer and failure text precedes inventory', async () => {
  const screen = nativeScreen(); let value!: ReturnType<typeof runtime>;
  const props = { mode: {kind:'new' as const}, async open(signal: AbortSignal, check: () => void) { value = runtime(signal, check); return value.controller; }, onBack() {} };
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
    assert.equal(tree.some(node => node.children.includes(title('mobile.infrastructure.create2Deployer'))), false);
    tree.find(node => node.type === 'Button' && node.props.title === 'View setup details')!.props.onPress();
    tree = screen.render(props);
    const alert = tree.findIndex(node => node.props.accessibilityRole === 'alert');
    const inventory = tree.findIndex(node => node.children.includes(title('mobile.infrastructure.create2Deployer')));
    assert(alert >= 0 && inventory > alert);
  } finally { screen.close(); }
});

test('optional-only status remains visibly ready and offers a labelled optional fee review', async () => {
  const screen = nativeScreen(); let value!: ReturnType<typeof runtime>;
  const props = { mode: {kind:'new' as const}, async open(signal: AbortSignal, check: () => void) { value = runtime(signal, check, 'optional-only'); return value.controller; }, onBack() {} };
  const fixed = (tree: ReturnType<typeof screenElements>) => screenElements(tree.find(node => node.type === 'Screen')!.props.footer);
  try {
    screen.render(props); await tick();
    let tree = screen.render(props);
    assert.equal(value.controller.getSnapshot().phase, 'complete');
    assert(text(tree).includes(title('settings.smartAccountInfrastructureReady')));
    assert.equal(text(tree).includes(title('settings.smartAccountCreate2Missing')), false);
    assert(text(tree).includes(title('settings.optional')));
    assert.equal(fixed(tree).filter(node => node.type === 'Button').length, 2);
    button(fixed(tree), 'mobile.infrastructure.reviewOptional');
    assert.equal(tree.some(node => node.type === 'Button' && node.props.title === title('mobile.infrastructure.reviewNext')), false);
    button(tree, 'mobile.infrastructure.reviewOptional').props.onPress(); await tick();
    tree = screen.render(props);
    assert.equal(value.controller.getSnapshot().feeReview!.contract.optional, true);
    assert(text(tree).includes('Multicall3 read aggregator'));
    assert(text(tree).includes(title('settings.optional')));
    assert.equal(value.counts.submissions, 0);
    button(fixed(tree), 'buttons.confirm').props.onPress(); await tick();
    assert.equal(value.counts.submissions, 1);
  } finally { screen.close(); }
});

for (const mode of ['missing', 'optional-only', 'all-present', 'pending-optional'] as const)
  test(`missing CREATE2 explains unavailable setup instead of showing Ready with ${mode} contracts`, async () => {
    const screen = nativeScreen(); let value!: ReturnType<typeof runtime>;
    const props = { mode: {kind:'new' as const}, async open(signal: AbortSignal, check: () => void) { value = runtime(signal, check, mode, false); return value.controller; }, onBack() {} };
    try {
      screen.render(props); await tick();
      let tree = screen.render(props); const fixed = screenElements(tree.find(node => node.type === 'Screen')!.props.footer);
      assert.equal(value.controller.getSnapshot().status!.observation.create2Deployer.deployed, false);
      assert.equal(value.controller.getSnapshot().status!.observation.ready, mode !== 'missing');
      assert(text(tree).includes(title('settings.smartAccountCreate2Missing')));
      assert.equal(text(tree).includes(title('settings.smartAccountInfrastructureReady')), false);
      assert.equal(text(tree).includes('Required setup complete'), false);
      tree.find(node => node.type === 'Button' && node.props.title === 'View setup details')!.props.onPress();
      tree = screen.render(props);
      const explanation = tree.findIndex(node => node.children.includes(title('settings.smartAccountCreate2Missing')));
      const inventory = tree.findIndex(node => node.children.includes(title('mobile.infrastructure.create2Deployer')));
      assert(explanation >= 0 && inventory > explanation);
      assert.equal(fixed.filter(node => node.type === 'Button').length, 2);
      assert.notEqual(button(fixed, 'mobile.infrastructure.refresh').props.disabled, true);
      button(fixed, 'buttons.close');
      for (const key of ['mobile.infrastructure.reviewNext', 'mobile.infrastructure.reviewOptional', 'buttons.confirm'])
        assert.equal(tree.some(node => node.type === 'Button' && node.props.title === title(key)), false);
      assert.equal(value.counts.submissions, 0); assert.equal(value.counts.signatures, 0); assert.equal(value.counts.wires, 0);
      if (mode === 'pending-optional') assert(tree.some(node => node.type === 'Notice' && node.props.body === title('mobile.infrastructure.pending')));
    } finally { screen.close(); }
  });

for (const mode of ['missing', 'all-present', 'pending-optional'] as const)
  test(`${mode} keeps the appropriate status and two-button footer`, async () => {
    const screen = nativeScreen(); let value!: ReturnType<typeof runtime>;
    const props = { mode: {kind:'new' as const}, async open(signal: AbortSignal, check: () => void) { value = runtime(signal, check, mode); return value.controller; }, onBack() {} };
    try {
      screen.render(props); await tick();
      let tree = screen.render(props); const fixed = screenElements(tree.find(node => node.type === 'Screen')!.props.footer);
      assert.equal(fixed.filter(node => node.type === 'Button').length, 2);
      button(fixed, mode === 'missing' ? 'mobile.infrastructure.reviewNext' : 'mobile.infrastructure.refresh');
      assert.equal(tree.some(node => node.type === 'Button' && node.props.title === title('mobile.infrastructure.reviewOptional')), false);
      assert.equal(text(tree).includes(title('settings.smartAccountInfrastructureReady')), mode === 'all-present');
      assert.equal(text(tree).includes(title('settings.smartAccountCreate2Missing')), false);
      assert.equal(value.counts.submissions, 0);
      assert.equal(value.controller.getSnapshot().phase, mode === 'all-present' ? 'complete' : mode === 'pending-optional' ? 'pending' : 'ready');
    } finally { screen.close(); }
  });

for (const stage of ['quote', 'signing', 'broadcast'] as const)
  test(`background while awaiting ${stage} prevents the next signing or publication boundary`, async () => {
    const screen = nativeScreen(), held = deferred<void>(); let value!: ReturnType<typeof runtime>;
    const props = { mode: {kind:'new' as const}, async open(signal: AbortSignal, check: () => void) { value = runtime(signal, check); return value.controller; }, onBack() {} };
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

test('infrastructure connects Ledger in the fixed footer and requires a separate fresh Confirm', async () => {
  const screen = nativeScreen(), ledger = ledgerConnection(); let value!: ReturnType<typeof runtime>;
  const props = { mode: {kind:'new' as const}, ledgerConnection: ledger.source, async open(signal: AbortSignal, check: () => void) {
    value = runtime(signal, check); return value.controller;
  }, onBack() {} };
  try {
    screen.render(props); await tick();
    let tree = screen.render(props);
    assert.equal(tree.some(node => node.props.title === 'Connect Ledger'), false);
    button(tree, 'mobile.infrastructure.reviewNext').props.onPress(); await tick();
    tree = screen.render(props);
    assert.equal(footer(tree).filter(node => node.type === 'Button').length, 2);
    button(footer(tree), 'buttons.close');
    assert.equal(tree.some(node => node.props.title === title('buttons.confirm')), false);
    assert.equal(screenElements(tree.find(node => node.type === 'Screen')!.children).some(node => node.props.title === 'Connect Ledger'), false);
    connectLedger(tree).props.onPress();
    const picker = ledgerPicker(screen.render(props)), owned = picker.props.controller;
    await owned.start(); await owned.select('verified-device'); await owned.finishConnection();
    tree = screen.render(props);
    assert.equal(button(footer(tree), 'buttons.confirm').props.disabled, true, 'the picker must finish before confirmation');
    button(footer(tree), 'buttons.confirm').props.onPress(); await tick();
    assert.equal(value.counts.submissions, 0);
    picker.props.onFinished(); tree = screen.render(props);
    assert.equal(button(footer(tree), 'buttons.confirm').props.disabled, false);
    assert.equal(value.counts.signatures, 0); assert.equal(value.counts.wires, 0);
    assert.deepEqual(ledger.actions, ['start', 'select:verified-device', 'finish']);
    button(footer(tree), 'buttons.confirm').props.onPress(); await tick();
    assert.equal(value.counts.submissions, 1); assert.equal(value.counts.signatures, 1); assert.equal(value.counts.wires, 1);
    assert.equal(screen.render(props).some(node => node.props.title === 'Connect Ledger'), false);
  } finally { screen.close(); }
});

test('Ledger disconnect makes a held infrastructure Confirm inert and restores Connect', async () => {
  const screen = nativeScreen(), ledger = ledgerConnection(true); let value!: ReturnType<typeof runtime>;
  const props = { mode: {kind:'new' as const}, ledgerConnection: ledger.source, async open(signal: AbortSignal, check: () => void) {
    value = runtime(signal, check); return value.controller;
  }, onBack() {} };
  try {
    screen.render(props); await tick();
    button(screen.render(props), 'mobile.infrastructure.reviewNext').props.onPress(); await tick();
    const confirm = button(footer(screen.render(props)), 'buttons.confirm');
    assert.equal(confirm.props.disabled, false);
    ledger.disconnect(); confirm.props.onPress(); await tick();
    assert.equal(value.counts.submissions, 0);
    const tree = screen.render(props);
    connectLedger(tree); button(footer(tree), 'buttons.close');
    assert.equal(footer(tree).filter(node => node.type === 'Button').length, 2);
  } finally { screen.close(); }
});

test('a replacement infrastructure review retires its old Ledger picker without closing its successor', async () => {
  const screen = nativeScreen(), ledger = ledgerConnection(); let value!: ReturnType<typeof runtime>;
  const props = { mode: {kind:'new' as const}, ledgerConnection: ledger.source, async open(signal: AbortSignal, check: () => void) {
    value = runtime(signal, check); return value.controller;
  }, onBack() {} };
  try {
    screen.render(props); await tick();
    button(screen.render(props), 'mobile.infrastructure.reviewNext').props.onPress(); await tick();
    const connect = connectLedger(screen.render(props)); connect.props.onPress();
    const original = ledgerPicker(screen.render(props)), owned = original.props.controller;
    await value.controller.refresh(value.controller.getSnapshot().revision); screen.render(props);
    assert.equal(ledger.closes, 1);
    button(screen.render(props), 'mobile.infrastructure.reviewNext').props.onPress(); await tick();
    let tree = screen.render(props);
    connect.props.onPress();
    assert.equal(screen.render(props).some(node => node.type === 'LedgerModal'), false);
    await assert.rejects(owned.start()); await assert.rejects(owned.select('stale-device')); await assert.rejects(owned.finishConnection());
    connectLedger(tree).props.onPress(); tree = screen.render(props);
    const successor = ledgerPicker(tree);
    original.props.onFinished();
    assert.equal(ledgerPicker(screen.render(props)).props.controller, successor.props.controller);
    assert.equal(ledger.closes, 1); assert.deepEqual(ledger.actions, []);
    assert.equal(value.counts.submissions, 0);
  } finally { screen.close(); }
});

test('monotonic quote expiry rejects held Ledger callbacks before any expiry timer runs', async () => {
  const clock = { wall: 100_000, monotonic: 100 }, screen = nativeScreen(clock), ledger = ledgerConnection();
  let value!: ReturnType<typeof runtime>;
  const props = { mode: {kind:'new' as const}, ledgerConnection: ledger.source, async open(signal: AbortSignal, check: () => void) {
    value = runtime(signal, check, 'missing', true, () => clock.monotonic); return value.controller;
  }, onBack() {} };
  try {
    screen.render(props); await tick();
    button(screen.render(props), 'mobile.infrastructure.reviewNext').props.onPress(); await tick();
    connectLedger(screen.render(props)).props.onPress();
    const owned = ledgerPicker(screen.render(props)).props.controller;
    const deadline = screen.connectionDeadline;
    clock.wall += 10_000; clock.monotonic += 1_000; screen.render(props);
    assert.equal(screen.connectionDeadline, deadline, 'rerenders must not renew the wall-clock adaptation');
    clock.wall = 1; clock.monotonic = 60_000;
    await assert.rejects(owned.start()); await assert.rejects(owned.finishConnection());
    const tree = screen.render(props);
    assert.equal(screen.connectionDeadline, deadline);
    assert.equal(tree.some(node => node.type === 'LedgerModal'), false);
    assert.equal(tree.some(node => node.props.title === 'Connect Ledger'), false);
    const confirm = button(footer(tree), 'buttons.confirm'); assert.equal(confirm.props.disabled, true);
    confirm.props.onPress(); await tick();
    assert.equal(value.counts.submissions, 0); assert.deepEqual(ledger.actions, []); assert.equal(ledger.closes, 1);
  } finally { screen.close(); }
});

test('a connected Ledger cannot use a held Confirm after monotonic expiry even if the wall clock moves backwards', async () => {
  const clock = { wall: 100_000, monotonic: 0 }, screen = nativeScreen(clock), ledger = ledgerConnection(true);
  let value!: ReturnType<typeof runtime>;
  const props = { mode: {kind:'new' as const}, ledgerConnection: ledger.source, async open(signal: AbortSignal, check: () => void) {
    value = runtime(signal, check, 'missing', true, () => clock.monotonic); return value.controller;
  }, onBack() {} };
  try {
    screen.render(props); await tick();
    button(screen.render(props), 'mobile.infrastructure.reviewNext').props.onPress(); await tick();
    const confirm = button(footer(screen.render(props)), 'buttons.confirm');
    assert.equal(confirm.props.disabled, false);
    clock.wall = 1; clock.monotonic = 60_000;
    confirm.props.onPress(); await tick();
    assert.equal(value.counts.submissions, 0); assert.equal(value.counts.signatures, 0); assert.equal(value.counts.wires, 0);
    assert.equal(button(footer(screen.render(props)), 'buttons.confirm').props.disabled, true);
  } finally { screen.close(); }
});

test('background retires infrastructure and its Ledger picker before retained device callbacks can act', async () => {
  const screen = nativeScreen(), ledger = ledgerConnection(); let value!: ReturnType<typeof runtime>;
  const props = { mode: {kind:'new' as const}, ledgerConnection: ledger.source, async open(signal: AbortSignal, check: () => void) {
    value = runtime(signal, check); return value.controller;
  }, onBack() {} };
  try {
    screen.render(props); await tick();
    button(screen.render(props), 'mobile.infrastructure.reviewNext').props.onPress(); await tick();
    const connect = connectLedger(screen.render(props)); connect.props.onPress();
    const owned = ledgerPicker(screen.render(props)).props.controller;
    screen.emit('change', 'background');
    await assert.rejects(owned.start()); await assert.rejects(owned.select('late-device')); await assert.rejects(owned.finishConnection());
    connect.props.onPress(); screen.render(props);
    assert.equal(ledger.closes, 1); assert.deepEqual(ledger.actions, []);
    assert.equal(value.counts.disposed, 1); assert.equal(value.counts.submissions, 0);
  } finally { screen.close(); }
});

for (const mode of ['all-present', 'pending-optional', 'missing-create2'] as const)
  test(`Ledger connection is not offered for ${mode} infrastructure status`, async () => {
    const screen = nativeScreen(), ledger = ledgerConnection(); let value!: ReturnType<typeof runtime>;
    const props = { mode: {kind:'new' as const}, ledgerConnection: ledger.source, async open(signal: AbortSignal, check: () => void) {
      value = runtime(signal, check, mode === 'missing-create2' ? 'optional-only' : mode, mode !== 'missing-create2'); return value.controller;
    }, onBack() {} };
    try {
      screen.render(props); await tick();
      const tree = screen.render(props);
      assert.equal(tree.some(node => node.props.title === 'Connect Ledger' || node.type === 'LedgerModal'), false);
      assert.equal(footer(tree).filter(node => node.type === 'Button').length, 2);
      button(footer(tree), 'mobile.infrastructure.refresh'); button(footer(tree), 'buttons.close');
      assert.equal(value.counts.submissions, 0);
    } finally { screen.close(); }
  });

for (const boundary of ['back', 'background', 'unmount', 'foreign-prompt'] as const) test(`infrastructure keeps only its own OS interruption and retires on ${boundary}`, async () => {
  const screen = nativeScreen();
  let scope!: privateAuthentication.NativePrivateAuthenticationScope, guard!: () => void, value!: ReturnType<typeof runtime>, returned = 0;
  const props = { mode: {kind:'new' as const}, async open(signal: AbortSignal, check: () => void, authentication: privateAuthentication.NativePrivateAuthenticationScope) {
    scope = authentication; guard = check; value = runtime(signal, check); return value.controller;
  }, onBack() { returned++; } };
  screen.render(props); await tick(); screen.render(props);
  const held = Promise.withResolvers<void>();
  const promptScope = boundary === 'foreign-prompt' ? privateAuthentication.createNativePrivateAuthenticationScope() : scope;
  let promptActive = true;
  const binding = privateAuthentication.bindNativePrivateAuthentication(promptScope, { assertCurrent() {}, isPromptActive: () => promptActive });
  const proof = privateAuthentication.withNativePrivateAuthentication(binding, new AbortController().signal, () => {}, () => held.promise);
  try {
    if (boundary !== 'foreign-prompt') {
      screen.emit('change', 'inactive'); screen.emit('blur'); guard(); assert.equal(returned, 0);
      screen.emit('change', 'active');
    }
    if (boundary === 'background') promptActive = false;
    if (boundary === 'unmount') screen.close();
    else screen.emit(boundary === 'back' ? 'hardwareBackPress' : 'change', boundary === 'background' ? 'background' : 'inactive');
    assert.throws(guard, /CANCELLED/); assert.equal(scope.isAuthenticating(), false);
    assert.equal(returned, boundary === 'unmount' ? 0 : 1);
  } finally { held.resolve(); await proof.catch(() => undefined); promptScope.retire(); screen.close(); }
});

for (const outcome of ['pending', 'unknown'] as const)
  test(`an exact Suite resume adopts the fresh fee review without refresh, then restores the ${outcome} notice after Confirm`, async () => {
    const screen = nativeScreen(); let value!: ReturnType<typeof runtime>;
    const props = { mode: { kind: 'suite-resume' as const, id: 'original-infrastructure-job' },
      async open(signal: AbortSignal, check: () => void) {
        value = runtime(signal, check, 'pending-optional', true, () => 0, 'original-infrastructure-job');
        await value.prepareResume(); return value.controller;
      }, onBack() {} };
    try {
      screen.render(props); await tick();
      let tree = screen.render(props);
      assert.equal(value.counts.observations, 0, 'opening a verified resume must not replace it with a generic pending refresh');
      assert.equal(value.controller.origin.kind, 'suite-resume');
      assert.equal(value.controller.getSnapshot().feeReview?.kind, 'suite-resume');
      assert(value.controller.getSnapshot().status?.pending);
      assert.equal(tree.some(node => node.type === 'Notice'), false, 'only the trusted owned resume review suppresses generic pending guidance');
      assert.equal(footer(tree).filter(node => node.type === 'Button').length, 2);
      assert.equal(button(footer(tree), 'buttons.confirm').props.disabled, false);
      assert.equal(value.counts.submissions, 0); assert.equal(value.counts.signatures, 0);
      assert(text(tree).includes(title('settings.optional')));
      assert.equal(text(tree).split('Multicall3').length - 1, 1, 'the pending summary must not duplicate the contract during its fresh review');
      if (outcome === 'unknown') value.failUnknownSubmission();
      button(footer(tree), 'buttons.confirm').props.onPress(); await tick();
      tree = screen.render(props);
      assert.equal(value.counts.submissions, 1);
      assert.equal(tree.some(node => node.type === 'Button' && node.props.title === title('buttons.confirm')), false);
      assert(tree.some(node => node.type === 'Notice' && node.props.body === title(`mobile.infrastructure.${outcome}`)));
      assert.equal(value.controller.getSnapshot().phase, outcome);
    } finally { screen.close(); }
  });

for (const mismatch of ['request', 'origin', 'unprepared'] as const)
  test(`Suite resume rejects a ${mismatch} controller before adopting or refreshing it`, async () => {
    const screen = nativeScreen(); let value!: ReturnType<typeof runtime>;
    const props = { mode: { kind: 'suite-resume' as const, id: 'expected-infrastructure-job' },
      async open(signal: AbortSignal, check: () => void) {
        value = runtime(signal, check, 'pending-optional', true, () => 0,
          mismatch === 'origin' ? null : mismatch === 'request' ? 'different-infrastructure-job' : 'expected-infrastructure-job');
        if (mismatch !== 'unprepared' && mismatch !== 'origin') await value.prepareResume();
        return value.controller;
      }, onBack() {} };
    try {
      screen.render(props); await tick();
      const tree = screen.render(props);
      assert.equal(value.counts.disposed, 1); assert.equal(value.counts.observations, 0);
      assert.equal(value.counts.submissions, 0);
      assert(tree.some(node => node.props.accessibilityRole === 'alert'));
      assert.equal(tree.some(node => node.props.title === title('buttons.confirm')), false);
    } finally { screen.close(); }
  });

for (const boundary of ['background', 'blur', 'close', 'back'] as const)
  test(`the infrastructure ${boundary} path distinguishes Suite capture from explicit cancellation before abort`, async () => {
    const screen = nativeScreen(); let value!: ReturnType<typeof runtime>;
    const props = { mode: { kind: 'suite-resume' as const, id: 'original-infrastructure-job' },
      async open(signal: AbortSignal, check: () => void) {
        value = runtime(signal, check, 'pending-optional', true, () => 0, 'original-infrastructure-job');
        await value.prepareResume(); return value.controller;
      }, onBack() {} };
    try {
      screen.render(props); await tick();
      const tree = screen.render(props), confirm = button(footer(tree), 'buttons.confirm').props.onPress;
      if (boundary === 'background') screen.emit('change', 'background');
      if (boundary === 'blur') screen.emit('blur');
      if (boundary === 'close') button(footer(tree), 'buttons.close').props.onPress();
      if (boundary === 'back') screen.emit('hardwareBackPress');
      assert.deepEqual(value.backgrounds, boundary === 'background' || boundary === 'blur' ? [false] : [], 'capture runs before the view AbortSignal retires');
      confirm(); await tick();
      assert.equal(value.counts.disposed, 1); assert.equal(value.counts.submissions, 0);
    } finally { screen.close(); }
  });

test('changing the explicit resume id retires old Confirm and Close handlers even when the opener is unchanged', async () => {
  const screen = nativeScreen();
  const values: ReturnType<typeof runtime>[] = [];
  let id = 'first-infrastructure-job', backs = 0;
  const open = async (signal: AbortSignal, check: () => void) => {
    const value = runtime(signal, check, 'pending-optional', true, () => 0, id);
    values.push(value); await value.prepareResume(); return value.controller;
  };
  const onBack = () => { backs++; };
  try {
    const first = { mode: { kind: 'suite-resume' as const, id }, open, onBack };
    screen.render(first); await tick();
    const tree = screen.render(first), oldConfirm = button(footer(tree), 'buttons.confirm').props.onPress,
      oldClose = button(footer(tree), 'buttons.close').props.onPress;
    id = 'second-infrastructure-job';
    const second = { mode: { kind: 'suite-resume' as const, id }, open, onBack };
    screen.render(second); await tick();
    oldConfirm(); oldClose(); await tick();
    assert.equal(values[0]!.counts.disposed, 1); assert.equal(values[0]!.counts.submissions, 0);
    assert.equal(values[1]!.counts.disposed, 0); assert.equal(values[1]!.counts.submissions, 0); assert.equal(backs, 0);
    button(footer(screen.render(second)), 'buttons.confirm').props.onPress(); await tick();
    assert.equal(values[1]!.counts.submissions, 1);
  } finally { screen.close(); }
});

for (const outcome of ['pending', 'unknown'] as const) test(`reconciled ${outcome} Suite deployment opens a fresh controller before the next fee review`, async () => {
  const screen = nativeScreen(); let value!: ReturnType<typeof runtime>, fresh!: ReturnType<typeof runtime>, resumes = true, transitions = 0;
  const continueSetup = () => { transitions++; resumes = false; };
  const openResume = async (signal: AbortSignal, check: () => void) => {
    value = runtime(signal, check, 'pending-optional', true, () => 0, 'settled-suite-job');
    await value.prepareResume(); return value.controller;
  };
  const openFresh = async (signal: AbortSignal, check: () => void) => {
    fresh = runtime(signal, check); return fresh.controller;
  };
  const props = () => resumes
    ? {mode:{kind:'suite-resume' as const,id:'settled-suite-job',onContinue:continueSetup},open:openResume,onBack() {}}
    : {mode:{kind:'new' as const,reviewNext:true},open:openFresh,onBack() {}};
  try {
    screen.render(props()); await tick();
    if (outcome === 'unknown') value.failUnknownSubmission();
    button(footer(screen.render(props())), 'buttons.confirm').props.onPress(); await tick();
    assert.equal(value.controller.getSnapshot().phase, outcome);
    assert.equal(footer(screen.render(props())).some(node => node.props.title === title('buttons.continue')), false);
    assert.equal(transitions, 0);
    value.reconcileOriginal();
    button(footer(screen.render(props())), 'mobile.infrastructure.refresh').props.onPress(); await tick();
    const tree = screen.render(props());
    const continueButton = button(footer(tree), 'buttons.continue');
    assert.equal(value.counts.submissions, 1); assert.equal(transitions, 0);
    continueButton.props.onPress();
    screen.render(props()); await tick();
    assert.equal(transitions, 1); assert.equal(value.counts.disposed, 1);
    assert.equal(fresh.controller.origin.kind, 'new'); assert.equal(fresh.counts.submissions, 0);
    assert.equal(fresh.controller.getSnapshot().phase, 'review', 'the explicit Continue action opens the fresh next review directly');
    assert.equal(fresh.controller.getSnapshot().feeReview?.kind, 'deployment');
    assert.equal(fresh.counts.submissions, 0, 'Continue and Review never automatically sign');
    continueButton.props.onPress(); assert.equal(transitions, 1, 'stale Continue cannot reopen its retired route');
  } finally {screen.close();}
});
