import assert from 'node:assert/strict';
import test from 'node:test';
import type { useDappLedgerConnection } from '../src/screens/useDappLedgerConnection';
import { formatBaseUnits } from '../src/core/amounts.ts';
import { screenElements, screenFixture, type ScreenElement } from './screenFixture.ts';

type LedgerState = ReturnType<typeof useDappLedgerConnection>;
function fixture(kind: 'message' | 'transaction' | 'psbt' = 'message') {
  let clock = 100, connected = false, closes = 0, timerId = 0, current: object | null;
  const timers = new Map<number, () => void>(), approvals: unknown[][] = [], deviceActions: string[] = [];
  const review: any = { kind, id: 'exact-request', revision: 7, expiresAt: 1000, busy: false, dispatched: false,
    error: null, needsAccountSwitch: false, appName: 'App', origin: 'https://app.example', accountLabel: 'Ledger account',
    address: `0x${'12'.repeat(20)}`, chainId: '1', networkLabel: 'Ethereum', symbol: 'ETH', decimals: 18,
    verification: { validation: 'VALID', isScam: false }, advisories: [], requiresWarningAcknowledgement: false,
    method: kind === 'message' ? 'personal_sign' : 'eth_sendTransaction', message: 'Exact message', order: null,
    transaction: { from: `0x${'12'.repeat(20)}`, to: `0x${'34'.repeat(20)}`, value: '1', data: '0x', nonce: '3' },
    maximumFeeUnits: '1', maximumTotalUnits: '2', feeChoice: null, feeComparison: null, approval: null, broadcastHash: null };
  if (kind === 'psbt') Object.assign(review, { attempted: false, details: {} });
  current = review;
  const controller: any = { getSnapshot: () => ({ signingReview: kind === 'psbt' ? null : current, psbtReview: kind === 'psbt' ? current : null }),
    async approveRequest(...args: unknown[]) { approvals.push(args); }, async rejectRequest() {}, async activateRequestAccount() {} };
  const ledgerConnection: any = { purpose: 'connect', subscribe: () => () => {}, isConnected: () => connected,
    async close() { closes++; }, async start() { deviceActions.push('start'); },
    async select(id: string) { deviceActions.push(`select:${id}`); }, async finishConnection() { deviceActions.push('finish'); } };
  const globals = { Date: class extends Date { static now() { return clock; } },
    setTimeout(callback: () => void) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id: number) { timers.delete(id); } };
  const hook = screenFixture(new URL('../src/screens/useDappLedgerConnection.tsx', import.meta.url), 'useDappLedgerConnection', {
    './NativeLedger': { NativeLedgerConnectionModal: 'LedgerModal' },
  }, globals);
  const state = () => hook.render({ review, controller, ledgerConnection }) as unknown as LedgerState;
  const screen = screenFixture(new URL(`../src/screens/${kind === 'message' ? 'NativeMessageReview' : 'NativeTransactionReview'}.tsx`, import.meta.url),
    kind === 'message' ? 'NativeMessageReviewScreen' : 'NativeTransactionReviewScreen', {
      './useDappLedgerConnection': { useDappLedgerConnection: state },
      'react-native': { ActivityIndicator: 'ActivityIndicator', View: 'View', KeyboardAvoidingView: 'KeyboardAvoidingView',
        Platform: { OS: 'ios' }, StyleSheet: { create: (value: unknown) => value }, BackHandler: { addEventListener: () => ({ remove() {} }) } },
      'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      '../ui': { ...Object.fromEntries(['Button', 'Card', 'Header', 'Notice', 'Screen', 'Text'].map(name => [name, name])), colors: {} },
      './IdleActivityBoundary': { IdlePressable: 'Pressable' }, './DappSiteStatus': { DappSiteStatus: 'DappSiteStatus' },
      '../core/amounts': { formatBaseUnits }, './ApprovalReview': { ApprovalReview: 'ApprovalReview' },
    }, globals);
  return { review, controller, ledgerConnection, state, approvals, deviceActions,
    render: () => screenElements(screen.render({ review, controller, ledgerConnection })),
    connect(value = true) { connected = value; }, closes: () => closes,
    current(value: object | null) { current = value; },
    expire() { clock = 1001; [...timers.values()].forEach(run => run()); },
    close() { screen.close(); hook.close(); },
  };
}
const modal = (state: LedgerState) => { assert(state.modal); return state.modal as unknown as ScreenElement; };

for (const kind of ['message', 'transaction'] as const) test(`${kind} consent connects Ledger without automatically signing, then requires a fresh approval press`, async () => {
  const f = fixture(kind);
  const approveTitle = kind === 'message' ? 'Sign message' : 'Confirm transaction';
  let values = f.render();
  const oldApprove = values.find(value => value.type === 'Button' && value.props.title === approveTitle)!;
  assert(oldApprove.props.disabled); oldApprove.props.onPress(); assert.deepEqual(f.approvals, []);
  values.find(value => value.type === 'Button' && value.props.title === 'Connect Ledger')!.props.onPress();
  const picker = modal(f.state());
  f.connect(); values = f.render();
  assert(values.find(value => value.type === 'Button' && value.props.title === approveTitle)!.props.disabled);
  assert.deepEqual(f.approvals, []); picker.props.onFinished(); values = f.render();
  const approve = values.find(value => value.type === 'Button' && value.props.title === approveTitle)!;
  assert(!approve.props.disabled); assert.deepEqual(f.approvals, []); approve.props.onPress(); await Promise.resolve();
  assert.deepEqual(f.approvals, [['exact-request', 7, false]]); f.close();
});

test('expiry closes the original picker and held connection/approval callbacks fail before a new UI commit', () => {
  const f = fixture(), old = f.state(); old.connect(); const picker = modal(f.state());
  f.expire(); old.connect(); assert(!old.canApprove()); assert.equal(f.closes(), 1);
  assert.equal(f.state().modal, null); assert(!f.state().showConnect);
  picker.props.onFinished(); assert.equal(f.closes(), 1); f.close();
});

test('request retirement and same-id revision replacement cannot reuse a held connect action', () => {
  const f = fixture(), old = f.state();
  f.current(null); old.connect(); assert.equal(f.state().modal, null);
  f.current({ ...f.review, revision: 8 }); old.connect(); assert.equal(f.state().modal, null);
  f.current(f.review); f.review.revision = 8; f.state(); old.connect(); assert.equal(f.state().modal, null); f.close();
});

test('a late old picker completion cannot close a successor during an A-B-A review transition', () => {
  const f = fixture(), old = f.state(); old.connect(); const first = modal(f.state());
  f.review.revision = 8; f.state(); assert.equal(f.closes(), 1);
  f.review.revision = 7; f.state(); old.connect(); assert.equal(f.state().modal, null);
  f.state().connect(); const next = modal(f.state()); first.props.onFinished();
  assert.equal(f.closes(), 1); assert.equal(modal(f.state()).props.controller, next.props.controller);
  next.props.onClose(); assert.equal(f.closes(), 2); f.close();
});

test('retained inner modal methods cannot start, select, finish or close a successor shared scan', async () => {
  const f = fixture(); f.state().connect(); const original = modal(f.state()).props.controller;
  await original.start(); await original.select('exact-device');
  assert.deepEqual(f.deviceActions, ['start', 'select:exact-device']);
  f.review.revision = 8; f.state(); f.review.revision = 7; f.state().connect(); const successor = modal(f.state()).props.controller;
  await original.close(); await assert.rejects(original.start()); await assert.rejects(original.select('wrong-device'));
  await assert.rejects(original.finishConnection()); assert.equal(f.closes(), 1);
  await successor.start(); assert.deepEqual(f.deviceActions, ['start', 'select:exact-device', 'start']);
  f.expire(); await successor.close(); await assert.rejects(successor.start());
  await assert.rejects(successor.select('expired-device')); await assert.rejects(successor.finishConnection());
  assert.equal(f.closes(), 2); f.close();
});

for (const field of ['busy', 'dispatched', 'needsAccountSwitch', 'error'] as const) test(`${field} retires connection controls without adopting the held device flow`, () => {
  const f = fixture(), old = f.state(); old.connect(); modal(f.state());
  f.review[field] = field === 'error' ? 'DELIVERY_UNCERTAIN' : true;
  assert.equal(f.state().modal, null); assert.equal(f.closes(), 1); old.connect(); assert(!old.canApprove()); f.close();
});

test('unmount closes its original picker and makes held handlers inert', () => {
  const f = fixture(), old = f.state(); old.connect(); const picker = modal(f.state()); f.close();
  old.connect(); picker.props.onFinished(); assert.equal(f.closes(), 1); assert(!old.canApprove());
});

test('PSBT connection is review-owned, needs a fresh approval after connect and retires on attempted signing', () => {
  const f = fixture('psbt');
  try {
    const original = f.state(); assert(original.showConnect); assert(!original.canApprove()); original.connect();
    const picker = modal(f.state()); f.connect(); assert(f.state().blocked); assert.deepEqual(f.approvals, []);
    picker.props.onFinished(); assert(f.state().canApprove()); assert.deepEqual(f.approvals, []);
    f.review.attempted = true; const retired = f.state(); assert(!retired.canApprove()); assert(!retired.showConnect);
    original.connect(); assert.equal(f.state().modal, null);
  } finally { f.close(); }
});
