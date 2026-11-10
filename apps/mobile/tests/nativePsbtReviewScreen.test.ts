import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import test from 'node:test';
import { screenElements, screenFixture } from './screenFixture.ts';
import { formatBaseUnits } from '../src/core/amounts.ts';
import type { NativePsbtReview } from '../src/connections/psbtRequests.ts';

const english = JSON.parse(readFileSync(new NodeURL('../../../source/assets/locales/en.json', import.meta.url), 'utf8'));
const translation = (key: string, args: Record<string, unknown> = {}) => {
  const value = key.split('.').reduce((v, field) => v?.[field], english);
  assert.equal(typeof value, 'string', `Missing canonical message ${key}`);
  return value.replace(/{{(.*?)}}/g, (_: string, field: string) => String(args[field]));
};
function fixture(method: 'sys_sign' | 'sys_signAndSend' = 'sys_sign') {
  let clock = 100, serial = 0, back: (() => boolean) | undefined, app: ((state: string) => void) | undefined;
  const timers = new Map<number, () => void>(), approvals: unknown[][] = [], rejections: string[] = [];
  const native = { AppState: { currentState: 'active', addEventListener(_event: string, handler: (state: string) => void) { app = handler; return { remove() { app = undefined; } }; } },
    BackHandler: { addEventListener(_event: string, handler: () => boolean) { back = handler; return { remove() { back = undefined; } }; } },
    StyleSheet: { create: (value: unknown) => value } };
  const review: NativePsbtReview = { id: 'psbt-1', revision: 7, method, appName: 'Untrusted display name', origin: 'https://reported.example',
    verification: { validation: 'UNKNOWN', isScam: false }, accountLabel: 'Approved account', address: 'bc1qapproved',
    networkLabel: 'Bitcoin', chainId: 'bip122:' + 'ab'.repeat(16), symbol: 'BTC', decimals: 8,
    expiresAt: 1000, busy: false, attempted: false, txid: null, error: null,
    details: { method, origin: 'https://reported.example', unsignedHash: 'ab'.repeat(32), feeSatoshis: '123', transactionType: 'bitcoin',
      transactionOptions: { rbf: true }, complete: false, sentry: null,
      inputs: [{ txid: 'cd'.repeat(32), vout: 0, valueSatoshis: '1000', scriptHex: '51' }],
      outputs: [{ index: 0, address: 'bc1qrecipient', scriptHex: '0014' + '11'.repeat(20), valueSatoshis: '877',
        assets: [{ assetGuid: '123456', amount: '1.25', rawAmount: '125000000', symbol: 'SYSX', isBurn: false }] }] } };
  let approveWait = Promise.resolve();
  const controller = { backgroundSigning() { rejections.push(review.id); }, getSnapshot: () => ({ psbtReview: review }), async approvePsbt(...args: unknown[]) { approvals.push(args); await approveWait; },
    async rejectPsbt(id: string) { rejections.push(id); } };
  const screen = screenFixture(new NodeURL('../src/screens/NativePsbtReview.tsx', import.meta.url), 'NativePsbtReview', {
    'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Header', 'Notice', 'Screen', 'Text'].map(name => [name, name])), colors: {} },
    './useDappLedgerConnection': { useDappLedgerConnection: () => ({ blocked: false, canApprove: () => true, showConnect: false, modal: null }) },
    './DappSiteStatus': { DappSiteStatus: 'Site' }, '../core/amounts': { formatBaseUnits },
    '../platform/localization': { useNativeTranslation: () => ({ t: translation }) },
  }, { Date: { now: () => clock }, setTimeout: (fn: () => void) => { timers.set(++serial, fn); return serial; }, clearTimeout: (id: number) => timers.delete(id) });
  const render = () => screenElements(screen.render({ review, controller }));
  const button = () => render().find(element => element.props.testID === 'native-psbt-approve')!;
  return { review, controller, render, button, approvals, rejections, close: screen.close,
    hold: (wait: Promise<void>) => { approveWait = wait; }, back: () => back?.(),
    expire() { clock = 1001; [...timers.values()].forEach(run => run()); },
    background() { native.AppState.currentState = 'background'; app?.('background'); } };
}
const text = (elements: ReturnType<ReturnType<typeof fixture>['render']>) => elements.flatMap(element => element.children.filter(value => typeof value === 'string')).join(' ');

for (const method of ['sys_sign', 'sys_signAndSend'] as const) test(`${method} renders verified outputs, exact fee and origin with an explicit action`, async () => {
  const f = fixture(method);
  try {
    const elements = f.render(), output = text(elements);
    assert(output.includes('https://reported.example')); assert(output.includes('bc1qapproved')); assert(output.includes('bc1qrecipient'));
    assert(output.includes('0.00000123')); assert(output.includes('SYSX')); assert(output.includes('123456'));
    assert.equal(f.button().props.title, method === 'sys_sign' ? 'Sign only' : 'Sign and send');
    assert.equal(f.button().props.disabled, false);
    assert.equal(output.includes(translation('mobile.connections.psbt.partialBody')), method === 'sys_sign');
    assert.deepEqual(elements.find(element => element.type === 'Site')!.props.verification, { validation: 'UNKNOWN', isScam: false });
    assert(!elements.some(element => element.type === 'Input' || element.type === 'TextInput'));
    await f.button().props.onPress(); assert.deepEqual(f.approvals, [['psbt-1', 7]]);
  } finally { f.close(); }
});

test('busy double tap admits exactly one identifier-only approval', async () => {
  const held = Promise.withResolvers<void>(), f = fixture(); f.hold(held.promise);
  try {
    const stalePress = f.button().props.onPress;
    const pending = stalePress(); stalePress();
    assert.deepEqual(f.approvals, [['psbt-1', 7]]); assert(f.button().props.disabled);
    held.resolve(); await pending;
  } finally { f.close(); }
});

test('Back, background and expiry retire consent before any late approval', () => {
  for (const action of ['back', 'background', 'expire'] as const) {
    const f = fixture(); const stalePress = f.button().props.onPress;
    try {
      if (action === 'back') assert.equal(f.back(), true); else f[action]();
      assert(f.button().props.disabled); stalePress();
      assert.deepEqual(f.approvals, []); assert.deepEqual(f.rejections, ['psbt-1']);
    } finally { f.close(); }
  }
});

test('replacement and unmount make stale screen callbacks inert', async () => {
  const f = fixture(), previous = f.button().props.onPress;
  Object.assign(f.review, { id: 'psbt-2', expiresAt: 2000, revision: 8 }); f.render();
  await previous(); assert.deepEqual(f.approvals, []);
  const current = f.button().props.onPress; f.close(); await current(); assert.deepEqual(f.approvals, []);
});

test('uncertain submission and response delivery remain distinct and cannot expose a retry-sign action', () => {
  for (const [error, title] of [['SUBMISSION_UNCERTAIN', 'Submission unverified'], ['DELIVERY_UNCERTAIN', 'Result delivery uncertain']] as const) {
    const f = fixture('sys_signAndSend');
    Object.assign(f.review, { error, attempted: true, txid: 'ef'.repeat(32) });
    try {
      assert(f.button().props.disabled);
      const elements = f.render(); assert(elements.some(element => element.type === 'Notice' && element.props.title === title));
      assert(text(elements).includes('ef'.repeat(32)));
      assert(!elements.some(element => element.type === 'Button' && /retry|resign/i.test(element.props.title)));
    } finally { f.close(); }
  }
});

test('verified review failure blocks consent without reflecting private service error text', async () => {
  const f = fixture(); Object.assign(f.review, { details: null, error: 'PSBT_UNAVAILABLE' });
  try {
    assert(f.button().props.disabled); await f.button().props.onPress(); assert.deepEqual(f.approvals, []);
    assert(f.render().some(element => element.type === 'Notice' && element.props.body === translation('mobile.connections.psbt.unavailableBody')));
  } finally { f.close(); }
});

test('all nine canonical locales contain the same nonempty PSBT copy and interpolation fields', () => {
  const expected = english.mobile.connections.psbt;
  for (const language of ['en', 'es', 'pt', 'fr', 'de', 'zh', 'ja', 'ko', 'ru']) {
    const dictionary = JSON.parse(readFileSync(new NodeURL(`../../../source/assets/locales/${language}.json`, import.meta.url), 'utf8'));
    const actual = dictionary.mobile.connections.psbt;
    assert.deepEqual(Object.keys(actual), Object.keys(expected));
    for (const key of Object.keys(expected)) {
      assert.equal(typeof actual[key], 'string'); assert(actual[key].trim());
      assert.deepEqual([...actual[key].matchAll(/{{(.*?)}}/g)].map(match => match[1]), [...expected[key].matchAll(/{{(.*?)}}/g)].map(match => match[1]));
    }
  }
});


test('a child fee review shows the verified original Sentry changes alongside exact network fee and explicit sign-only consent', () => {
  const f = fixture();
  const sentry = { operation: 'updateService', proTxHash: 'ab'.repeat(32),
    changes: { service: { previous: 'old.node:8369', next: 'new.node:8369' }, nevmAddress: { previous: '', next: '' }, operatorPayoutScript: { previous: '', next: '' } } };
  Object.assign(f.review.details!, { sentry });
  try {
    const output = text(f.render());
    for (const value of [translation('sentry.feeTitle'), translation('sentry.feeHelp'), translation('sentry.feeOperations.updateService'), sentry.proTxHash, 'old.node:8369', 'new.node:8369', '0.00000123']) assert(output.includes(value));
    assert.equal(f.button().props.title, 'Sign only');
    assert(!f.render().some(element => element.type === 'Input' || element.type === 'TextInput'));
  } finally { f.close(); }
});
