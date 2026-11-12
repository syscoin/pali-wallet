import { nativeTranslationFixture } from './localizationFixture.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { screenElements, screenFixture } from './screenFixture.ts';
import { decodeSentryPayoutAddress } from '../src/screens/sentryPayoutAddress.ts';

function fixture(kind: 'control' | 'sentry') {
  let clock = 100, serial = 0, back: (() => boolean) | undefined, app: ((state: string) => void) | undefined;
  const timers = new Map<number, () => void>(), approvals: unknown[][] = [], rejections: string[] = [];
  const native = { Platform: { OS: 'ios' }, KeyboardAvoidingView: 'KeyboardAvoidingView', AppState: { currentState: 'active', addEventListener(_event: string, handler: (state: string) => void) { app = handler; return { remove() { app = undefined; } }; } },
    BackHandler: { addEventListener(_event: string, handler: () => boolean) { back = handler; return { remove() { back = undefined; } }; } },
    Keyboard: { dismiss() {} }, StyleSheet: { create: (v: unknown) => v }, View: 'View' };
  let review: any = { id: 'request-1', revision: 1, appName: 'Example', origin: 'https://example.test', accountLabel: 'Wallet', address: '0x123',
    networkLabel: 'Test network', chainId: '1', expiresAt: 1000, busy: false, error: null,
    verification: { validation: 'UNKNOWN', isScam: false }, details: kind === 'control'
      ? { kind: 'network-switch', name: 'Chain', chainId: '99', symbol: 'COIN', rpcUrl: 'https://rpc.example.test' }
      : { kind: 'operation', approval: { network: 'mainnet', keys: [{ id: 'owner', label: 'Owner', role: 'owner', scheme: 'secp256k1', authorizationId: 'owner' },
        { id: 'new', label: 'New owner', role: 'owner', scheme: 'secp256k1', authorizationId: 'newOwner' }],
      serviceUrl: 'https://node.example.test', review: { operation: 'register', feeSatoshis: '50', fields: { payout: 'script' }, outputs: [], authorizations: [] } } } };
  const controller = { approveControl: async (...args: unknown[]) => { approvals.push(args); }, rejectControl: async (id: string) => { rejections.push(id); },
    approveSentry: async (...args: unknown[]) => { approvals.push(structuredClone(args)); }, rejectSentry: async (id: string) => { rejections.push(id); } };
  const f = screenFixture(new URL(`../src/screens/${kind === 'control' ? 'NativeDappControlReview' : 'NativeSentryReview'}.tsx`, import.meta.url),
    kind === 'control' ? 'NativeDappControlReview' : 'NativeSentryReview', {
      '../platform/localization': nativeTranslationFixture,
      'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      '../ui': { ...Object.fromEntries(['Button', 'Card', 'Header', 'Icon', 'Notice', 'Row', 'Screen', 'Text'].map(name => [name, name])), colors: {} },
      './DappSiteStatus': { DappSiteStatus: 'SiteStatus' }, './IdleActivityBoundary': { IdleTextInput: 'Input' },
      './PinEntry': { PinField: 'Input' },
      './sentryPayoutAddress': { decodeSentryPayoutAddress },
    }, { Date: class extends Date { static now() { return clock; } },
      setTimeout(callback: () => void) { timers.set(++serial, callback); return serial; }, clearTimeout(id: number) { timers.delete(id); } });
  const render = () => screenElements(f.render({ review, controller }));
  const button = () => screenElements(render().find(e => e.type === 'Screen')!.props.footer).find(e => e.type === 'Button' && e.props.title !== 'Reject')!;
  const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
  return { get review() { return review; }, replaceReview(update: Record<string, unknown>) { review = Object.freeze({ ...review, ...update }); }, controller, render, button, approvals, rejections, tick,
    expire() { clock = 1001; [...timers.values()].forEach(run => run()); },
    background() { native.AppState.currentState = 'background'; app?.('background'); },
    back: () => back?.(), close: f.close };
}

test('network control uses only request ID/revision, rejects Back and explains blocked sites', async () => {
  const f = fixture('control');
  assert(f.render().some(node => node.type === 'Icon' && node.props.name === 'globe'));
  await f.button().props.onPress();
  assert.deepEqual(f.approvals, [['request-1', 1]]); assert.equal(f.back(), true); await f.tick();
  assert.deepEqual(f.rejections, ['request-1']);
  f.review.error = 'BLOCKED_SITE';
  assert(f.button().props.disabled); assert(f.render().some(e => e.type === 'Notice' && e.props.title === 'Known security risk'));
  f.close();
});

test('expired control cannot become a new asset consent without a new current review', () => {
  const f = fixture('control'); f.render(); f.expire(); assert(f.button().props.disabled);
  f.review.id = 'request-2'; f.review.expiresAt = 2000; f.render(); assert(!f.button().props.disabled); f.close();
});

test('Sentry signature requests shared authorization for the displayed role/slot only once', async () => {
  const f = fixture('sentry'); f.render(); f.render().find(e => e.type === 'Row' && e.props.title.startsWith('New owner'))!.props.onPress();
  const held = Promise.withResolvers<void>();
  f.controller.approveSentry = async (...args: unknown[]) => { f.approvals.push(structuredClone(args)); await held.promise; };
  assert(!f.render().some(e => e.type === 'Input'));
  const submit = f.button().props.onPress;
  submit(); submit(); await f.tick();
  assert.deepEqual(f.approvals, [['request-1', 1, { kind: 'operation', keyId: 'new', authorizationId: 'newOwner' }]]);
  assert(f.button().props.disabled); held.resolve(); await f.tick(); f.close();
});

test('immutable Sentry busy/error snapshots settle pending feedback without re-enabling terminal errors', async () => {
  const f = fixture('sentry'), held = Promise.withResolvers<void>();
  try {
    f.controller.approveSentry = async (...args: unknown[]) => { f.approvals.push(args); await held.promise; };
    const submit = f.button().props.onPress;
    submit(); submit();
    f.replaceReview({ revision: 2, busy: true }); f.render();
    assert.equal(f.button().props.title, 'Authorizing…');
    submit(); assert.equal(f.approvals.length, 1);
    f.replaceReview({ revision: 3, busy: false, error: 'SENTRY_UNAVAILABLE' }); f.render();
    held.reject(new Error('Authentication cancelled')); await f.tick();
    assert.equal(f.button().props.title, 'Authorize Sentry update');
    assert(f.button().props.disabled);
    assert(f.render().some(node => node.type === 'Notice' && node.props.title === 'Request unavailable'));
    assert(!f.render().some(node => node.type === 'Notice' && node.props.title === 'Authorization unsuccessful'));
    f.button().props.onPress(); assert.equal(f.approvals.length, 1);
    assert.equal(f.back(), true); await f.tick();
    assert.deepEqual(f.rejections, ['request-1']);
  } finally { held.resolve(); f.close(); }
});

test('replacing Sentry request details retires the old pending completion without clearing a new attempt', async () => {
  const f = fixture('sentry'), first = Promise.withResolvers<void>(), second = Promise.withResolvers<void>();
  try {
    f.controller.approveSentry = async (...args: unknown[]) => {
      f.approvals.push(args); await (f.approvals.length === 1 ? first.promise : second.promise);
    };
    f.button().props.onPress();
    f.replaceReview({ revision: 2, details: structuredClone(f.review.details) }); f.render();
    assert(!f.button().props.disabled);
    f.button().props.onPress();
    assert.equal(f.approvals.length, 2);
    first.reject(new Error('Old request retired')); await f.tick();
    assert(f.button().props.disabled);
    assert(!f.render().some(node => node.type === 'Notice' && node.props.title === 'Authorization unsuccessful'));
    second.resolve(); await f.tick();
    assert(!f.button().props.disabled);
  } finally { first.resolve(); second.resolve(); f.close(); }
});

test('Sentry expiry, background and replaced review cannot launch stale authorization', () => {
  const f = fixture('sentry'); f.render();
  const stale = f.button().props.onPress;
  f.expire(); assert(f.button().props.disabled); stale();
  f.replaceReview({ id: 'request-2', expiresAt: 2000 }); f.render(); stale();
  f.background(); f.button().props.onPress();
  assert.deepEqual(f.approvals, []);
  assert.equal(f.back(), true); f.close();
});

test('an unmounted Sentry review cannot start authorization', () => {
  const f = fixture('sentry');
  const submit = f.button().props.onPress;
  f.close(); submit();
  assert.deepEqual(f.approvals, []);
});

test('linking uses no password and sends no UI-authored node or transaction payload', async () => {
  const f = fixture('sentry'); f.review.details = { kind: 'link', approval: { node: { proTxHash: 'ab'.repeat(32), collateralOutpoint: { txid: 'cd'.repeat(32), vout: 0 } }, serviceUrl: 'https://node.example.test' } };
  f.render(); assert(!f.render().some(e => e.type === 'Input')); f.button().props.onPress(); await f.tick();
  assert.deepEqual(f.approvals, [['request-1', 1, { kind: 'link' }]]); f.close();
});

test('a produced signature with uncertain response delivery cannot be retried as a password failure', async () => {
  const f = fixture('sentry');
  f.controller.approveSentry = async () => { f.review.error = 'DELIVERY_UNCERTAIN'; throw Error('Lost response'); };
  f.render(); f.button().props.onPress(); await f.tick();
  assert(f.button().props.disabled);
  assert(f.render().some(e => e.type === 'Notice' && e.props.title === 'Authorization delivery uncertain'));
  assert(!f.render().some(e => e.type === 'Notice' && e.props.title === 'Authorization unsuccessful'));
  assert(!f.render().some(e => e.type === 'Input')); f.close();
});


test('a replacement Sentry review revision requires its own current approval callback', async () => {
  const f = fixture('sentry');
  try {
    const original = f.button().props.onPress;
    f.replaceReview({ revision: 2 }); f.render(); original();
    assert.deepEqual(f.approvals, []);
    f.button().props.onPress(); await f.tick();
    assert.equal(f.approvals.length, 1);
    assert.equal(f.approvals[0]![1], 2);
  } finally { f.close(); }
});


test('Sentry service review shows payout and address changes before opening technical details', () => {
  const f = fixture('sentry');
  try {
    f.review.details.approval.review = { operation: 'updateService', proTxHash: 'ab'.repeat(32), feeSatoshis: '50', outputs: [], changes: {
      service: { previous: 'old.example:8369', next: 'new.example:8369' },
      operatorPayoutScript: { previous: '0014' + '11'.repeat(20), next: '0014' + '22'.repeat(20) },
      nevmAddress: { previous: '0x' + '33'.repeat(20), next: '0x' + '44'.repeat(20) },
    } };
    const fields = f.render().filter(node => typeof node.type === 'function' && (node.type as Function).name === 'Field');
    for (const [name, value] of Object.entries(f.review.details.approval.review.changes) as [string, { previous: string; next: string }][]) {
      assert(fields.some(node => node.props.name === 'Current' && node.props.value === (name === 'operatorPayoutScript' ? decodeSentryPayoutAddress(value.previous, 'mainnet') : value.previous)));
      assert(fields.some(node => node.props.name === 'Proposed' && node.props.value === (name === 'operatorPayoutScript' ? decodeSentryPayoutAddress(value.next, 'mainnet') : value.next)));
    }
    assert(!fields.some(node => node.props.value === f.review.details.approval.review.changes.operatorPayoutScript.next));
    const nodes = f.render();
    assert(nodes.findIndex(node => node.props.testID === 'sentry-proposed-changes') < nodes.findIndex(node => node.props.name === 'Registered node'));
    assert(nodes.some(node => node.children.includes(f.review.origin)));
    assert(fields.findIndex(node => node.props.name === 'Proposed') < fields.findIndex(node => node.props.name === 'Current'));
    assert(fields.some(node => node.props.name === 'Transaction fee' && node.props.value === '50 satoshis'));
    f.render().find(node => node.type === 'Button' && node.props.title === 'View request details')!.props.onPress();
    const details = f.render().filter(node => node.props.name?.includes('payout script'));
    assert(details.some(node => node.props.name === 'Current operator payout script' && node.props.value === f.review.details.approval.review.changes.operatorPayoutScript.previous));
    assert(details.some(node => node.props.name === 'Proposed operator payout script' && node.props.value === f.review.details.approval.review.changes.operatorPayoutScript.next));
  } finally { f.close(); }
});

test('Sentry undecodable or unset payout remains explicit and raw bytes stay in Details', () => {
  const f = fixture('sentry');
  try {
    f.review.details.approval.review = { operation: 'updateService', feeSatoshis: '50', outputs: [], changes: {
      service: { previous: 'old.example:8369', next: 'new.example:8369' }, nevmAddress: { previous: '', next: '' },
      operatorPayoutScript: { previous: '', next: '6a02abcd' },
    } };
    const fields = f.render().filter(node => node.props.name);
    assert(fields.some(node => node.props.name === 'Proposed' && node.props.value === 'Address unavailable · See script in Details'));
    assert(fields.some(node => node.props.name === 'Current' && node.props.value === ''));
    assert(!fields.some(node => node.props.value === '6a02abcd'));
    f.render().find(node => node.type === 'Button' && node.props.title === 'View request details')!.props.onPress();
    assert(f.render().some(node => node.props.name === 'Proposed operator payout script' && node.props.value === '6a02abcd'));
  } finally { f.close(); }
});

test('Sentry registration review keeps payout and authority changes visible while technical material is collapsed', () => {
  const f = fixture('sentry');
  try {
    f.review.details.approval.network = 'testnet';
    f.review.details.approval.review = { operation: 'updateRegistrar', feeSatoshis: '75', outputs: [], authorizations: [], fields: {
      previousPayoutAddress: 'old-payout', payoutAddress: 'new-payout', previousVotingKeyId: 'old-vote', votingKeyId: 'new-vote',
      previousOperatorPublicKey: 'old-operator', operatorPublicKey: 'new-operator', childKeyCommitment: 'technical-commitment', operatorPayoutScript: '0014' + '11'.repeat(20),
    } };
    const values = () => f.render().filter(node => typeof node.type === 'function' && (node.type as Function).name === 'Field').map(node => node.props.value);
    for (const value of ['old-payout', 'new-payout', 'old-vote', 'new-vote', 'old-operator', 'new-operator']) assert(values().includes(value));
    assert(!values().includes('technical-commitment'));
    assert(values().includes('tsys1qzyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3g9m666'));
    assert(!values().includes('0014' + '11'.repeat(20)));
    f.render().find(node => node.type === 'Button' && node.props.title === 'View request details')!.props.onPress();
    assert(values().includes('technical-commitment'));
    assert(values().includes('0014' + '11'.repeat(20)));
  } finally { f.close(); }
});
