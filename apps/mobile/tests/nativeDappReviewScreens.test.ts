import assert from 'node:assert/strict';
import test from 'node:test';
import { screenElements, screenFixture } from './screenFixture.ts';

function fixture(kind: 'control' | 'sentry') {
  let clock = 100, serial = 0, back: (() => boolean) | undefined, app: ((state: string) => void) | undefined;
  const timers = new Map<number, () => void>(), approvals: unknown[][] = [], rejections: string[] = [];
  const native = { AppState: { currentState: 'active', addEventListener(_event: string, handler: (state: string) => void) { app = handler; return { remove() { app = undefined; } }; } },
    BackHandler: { addEventListener(_event: string, handler: () => boolean) { back = handler; return { remove() { back = undefined; } }; } },
    Keyboard: { dismiss() {} }, StyleSheet: { create: (v: unknown) => v } };
  const review: any = { id: 'request-1', revision: 1, appName: 'Example', origin: 'https://example.test', accountLabel: 'Wallet', address: '0x123',
    networkLabel: 'Test network', chainId: '1', expiresAt: 1000, busy: false, error: null,
    verification: { validation: 'UNKNOWN', isScam: false }, details: kind === 'control'
      ? { kind: 'network-switch', name: 'Chain', chainId: '99', symbol: 'COIN', rpcUrl: 'https://rpc.example.test' }
      : { kind: 'operation', approval: { keys: [{ id: 'owner', label: 'Owner', role: 'owner', scheme: 'secp256k1', authorizationId: 'owner' },
        { id: 'new', label: 'New owner', role: 'owner', scheme: 'secp256k1', authorizationId: 'newOwner' }],
      serviceUrl: 'https://node.example.test', review: { operation: 'register', feeSatoshis: '50', fields: { payout: 'script' }, outputs: [], authorizations: [] } } } };
  const controller = { approveControl: async (...args: unknown[]) => { approvals.push(args); }, rejectControl: async (id: string) => { rejections.push(id); },
    approveSentry: async (...args: unknown[]) => { approvals.push(structuredClone(args)); }, rejectSentry: async (id: string) => { rejections.push(id); } };
  const f = screenFixture(new URL(`../src/screens/${kind === 'control' ? 'NativeDappControlReview' : 'NativeSentryReview'}.tsx`, import.meta.url),
    kind === 'control' ? 'NativeDappControlReview' : 'NativeSentryReview', {
      'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      '../ui': { ...Object.fromEntries(['Button', 'Card', 'Header', 'Notice', 'Row', 'Screen', 'Text'].map(name => [name, name])), colors: {} },
      './DappSiteStatus': { DappSiteStatus: 'SiteStatus' }, './IdleActivityBoundary': { IdleTextInput: 'Input' },
    }, { Date: class extends Date { static now() { return clock; } },
      setTimeout(callback: () => void) { timers.set(++serial, callback); return serial; }, clearTimeout(id: number) { timers.delete(id); } });
  const render = () => screenElements(f.render({ review, controller }));
  const button = () => render().find(e => e.type === 'Button' && e.props.title !== 'Reject')!;
  const password = () => render().find(e => e.type === 'Input')!;
  const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
  return { review, controller, render, button, password, approvals, rejections, tick,
    expire() { clock = 1001; [...timers.values()].forEach(run => run()); },
    background() { native.AppState.currentState = 'background'; app?.('background'); },
    back: () => back?.(), close: f.close };
}

test('network control uses only request ID/revision, rejects Back and explains blocked sites', async () => {
  const f = fixture('control'); f.render(); await f.button().props.onPress();
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

test('Sentry signature uses the displayed role/slot and clears password before asynchronous signing', async () => {
  const f = fixture('sentry'); f.render(); f.render().find(e => e.type === 'Row' && e.props.title.startsWith('New owner'))!.props.onPress();
  f.password().props.onChangeText('fresh-password'); const submit = f.button().props.onPress;
  submit(); submit(); await f.tick();
  assert.deepEqual(f.approvals, [['request-1', 1, { kind: 'operation', password: 'fresh-password', keyId: 'new', authorizationId: 'newOwner' }]]);
  assert.equal(f.password().props.value, ''); assert(f.button().props.disabled); f.close();
});

test('Sentry expiry, background, review replacement and authority-key edits require fresh password entry', () => {
  const f = fixture('sentry'); f.render();
  f.password().props.onChangeText('secret'); f.expire(); assert.equal(f.password().props.value, ''); assert(f.button().props.disabled);
  f.review.id = 'request-2'; f.review.expiresAt = 2000; f.render(); assert.equal(f.password().props.value, '');
  f.password().props.onChangeText('secret'); f.background(); assert.equal(f.password().props.value, '');
  f.password().props.onChangeText('secret'); f.render().find(e => e.type === 'Row')!.props.onPress(); assert.equal(f.password().props.value, '');
  assert.equal(f.back(), true); f.close();
});

test('linking uses no password and sends no UI-authored node or transaction payload', async () => {
  const f = fixture('sentry'); f.review.details = { kind: 'link', approval: { node: { proTxHash: 'ab'.repeat(32), collateralOutpoint: { txid: 'cd'.repeat(32), vout: 0 } }, serviceUrl: 'https://node.example.test' } };
  f.render(); assert(!f.render().some(e => e.type === 'Input')); f.button().props.onPress(); await f.tick();
  assert.deepEqual(f.approvals, [['request-1', 1, { kind: 'link' }]]); f.close();
});

test('a produced signature with uncertain response delivery cannot be retried as a password failure', async () => {
  const f = fixture('sentry');
  f.controller.approveSentry = async () => { f.review.error = 'DELIVERY_UNCERTAIN'; throw Error('Lost response'); };
  f.render(); f.password().props.onChangeText('fresh-password'); f.button().props.onPress(); await f.tick();
  assert(f.button().props.disabled);
  assert(f.render().some(e => e.type === 'Notice' && e.props.title === 'Authorization delivery uncertain'));
  assert(!f.render().some(e => e.type === 'Notice' && e.props.title === 'Authorization unsuccessful'));
  assert.equal(f.password().props.value, ''); f.close();
});
