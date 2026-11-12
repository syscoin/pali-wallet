import assert from 'node:assert/strict';
import test from 'node:test';
import type { NativeConnectionsSnapshot } from '../src/connections/types.ts';
import { extractPairingUri } from '../src/connections/pairingLinks.ts';
import { englishI18n, languageMessages, nativeTranslationFixture } from './localizationFixture.ts';
import { screenElements, screenFixture, type ScreenElement } from './screenFixture.ts';

const address = `0x${'12'.repeat(20)}`;
const account = { id: 'hd:60:0', label: 'Daily wallet', address };
function fixture(dateLocale?: Intl.LocalesArgument) {
  let now = 100_000, reads = 0, back = 0;
  let clipboard: () => Promise<string> = async () => 'wc:clipboard-link';
  let sessionAction: () => Promise<void> = async () => {};
  let snapshot: NativeConnectionsSnapshot = {
    revision: 7, status: 'ready', pairingExpiresAt: null, accounts: [account], selectedAccountId: account.id,
    network: { id: 'ethereum', label: 'Ethereum', chainId: '1' }, proposals: [], sessions: [],
    preparationReview: null, controlReview: null, psbtReview: null, sentryReview: null,
    signingReview: null, callsStatus: null, error: null,
  };
  const calls: { method: string; args: unknown[] }[] = [];
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const backHandlers = new Set<() => boolean>();
  const controller = {
    getSnapshot: () => snapshot, subscribe: () => () => {},
    async pair(uri: string) { calls.push({ method: 'pair', args: [uri] }); },
    async approve(...args: unknown[]) { calls.push({ method: 'approve', args }); },
    async reject(...args: unknown[]) { calls.push({ method: 'reject', args }); },
    async disconnect(...args: unknown[]) { calls.push({ method: 'disconnect', args }); await sessionAction(); },
    async returnToDapp(...args: unknown[]) { calls.push({ method: 'return', args }); await sessionAction(); },
    async retry() { calls.push({ method: 'retry', args: [] }); },
    cancel() { calls.push({ method: 'cancel', args: [] }); },
  };
  let renderingController = controller;
  const host = screenFixture(new URL('../src/screens/NativeConnections.tsx', import.meta.url), 'NativeConnections', {
    '../platform/localization': nativeTranslationFixture,
    '../connections/pairingLinks': { extractPairingUri },
    'react-native': { ActivityIndicator: 'ActivityIndicator', View: 'View', StyleSheet: { create: (value: unknown) => value },
      BackHandler: { addEventListener: (_event: string, handler: () => boolean) => { backHandlers.add(handler); return { remove: () => backHandlers.delete(handler) }; } } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-clipboard': { async getStringAsync() { reads++; return clipboard(); } },
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Header', 'Icon', 'IconButton', 'Notice', 'Screen', 'Text'].map(name => [name, name])), colors: {} },
    './IdleActivityBoundary': { IdlePressable: 'Pressable' },
    './DappSiteStatus': { DappSiteStatus: 'DappSiteStatus' },
    './ConnectionQrScanner': { ConnectionQrScanner: 'Scanner' },
  }, {
    Date: class extends Date {
      static now() { return now; }
      toLocaleString(locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
        return super.toLocaleString(locales ?? dateLocale, options);
      }
    },
    setTimeout: (callback: () => void) => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: (id: number) => timers.delete(id), queueMicrotask,
  });
  const render = () => screenElements(host.render({ controller: renderingController, onBack() { back++; } }));
  const button = (title: string, elements = render()) => {
    const found = elements.find(value => value.type === 'Button' && value.props.title === title);
    assert(found, title); return found;
  };
  const text = (elements = render()) => elements.filter(value => value.type === 'Text').flatMap(value => value.children).join(' ');
  return { render, button, text, calls, controller, close: host.close,
    get reads() { return reads; }, get back() { return back; },
    setClipboard(value: () => Promise<string>) { clipboard = value; },
    setSessionAction(value: () => Promise<void>) { sessionAction = value; },
    replaceController() { renderingController = { ...controller }; },
    update(value: Partial<NativeConnectionsSnapshot>) { snapshot = { ...snapshot, ...value }; },
    advance(milliseconds: number) { now += milliseconds; const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); },
    hardwareBack() { return [...backHandlers].reverse().some(handler => handler()); },
    get pendingTimers() { return timers.size; },
    proposal(methods = ['eth_accounts', 'eth_sendTransaction']) {
      snapshot = { ...snapshot, proposals: [{ id: 42, name: 'Example app', origin: 'https://example.invalid',
        verification: { validation: 'VALID', isScam: false }, requiredMethods: ['eth_accounts'], expiresAt: now + 120_000,
        canApprove: true, methodsByAccount: [{ accountId: account.id, methods, canApprove: true }] }] };
    },
    session(returnable = false): NativeConnectionsSnapshot['sessions'][number] {
      return { id: 'session-1', name: 'Example app', origin: 'https://example.invalid', accountLabel: account.label,
        networkLabel: 'Ethereum', address, methods: ['eth_accounts', 'eth_sendTransaction'], expiresAt: now + 3_600_000,
        returnTarget: returnable ? { origin: 'https://example.invalid', url: 'https://example.invalid/', verification: { validation: 'UNKNOWN', isScam: false } } : null };
    },
  };
}

const click = (element: ScreenElement) => element.props.onPress();
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const settled = () => new Promise<void>(resolve => setImmediate(resolve));
function openSession(f: ReturnType<typeof fixture>) {
  click(f.render().find(element => element.type === 'Pressable' && element.props.accessibilityLabel?.startsWith('Example app,'))!);
  return f.render();
}

test('always shows active connections and an empty state, with scan primary and tap-only clipboard', async () => {
  const f = fixture();
  assert.match(f.text(), /Active connections.*No active connections/);
  assert.equal(f.reads, 0);
  assert.equal(f.button('Scan QR code').props.variant, undefined);
  assert.equal(f.button('Paste connection link').props.variant, 'secondary');
  await click(f.button('Paste connection link'));
  assert.equal(f.reads, 1);
  assert.deepEqual(f.calls, [{ method: 'pair', args: ['wc:clipboard-link'] }]);
  assert(!f.calls.some(call => call.method === 'approve'));
  f.close();
});

test('QR and pasted links reach the same proposal review and only explicit Connect approves', async () => {
  const f = fixture();
  click(f.button('Scan QR code'));
  const scanner = f.render().find(element => element.type === 'Scanner');
  assert(scanner); scanner.props.onScan('wc:qr-link');
  await flush();
  assert.deepEqual(f.calls, [{ method: 'pair', args: ['wc:qr-link'] }]);
  f.proposal();
  const elements = f.render();
  assert.match(f.text(elements), /Example app.*https:\/\/example.invalid.*2:00/);
  assert.match(f.text(elements), /View your selected account address.*Request transactions for your approval/);
  assert(!f.text(elements).includes('eth_sendTransaction'));
  assert.equal(elements.find(value => value.type === 'Header')!.props.title, 'Connect Request');
  assert(!f.calls.some(call => call.method === 'approve'));
  click(f.button('Connect', elements)); await flush();
  assert.deepEqual(f.calls.at(-1), { method: 'approve', args: [42, account.id, 'ethereum', 7] });
  f.close();
});

test('pasted Pali links use the same WalletConnect URI as scanned links', async () => {
  const f = fixture();
  try {
    const uri = `wc:${'ab'.repeat(32)}@2?relay-protocol=irn&symKey=${'cd'.repeat(32)}`;
    f.setClipboard(async () => `pali://wc?uri=${encodeURIComponent(uri)}`);
    await click(f.button('Paste connection link'));
    assert.deepEqual(f.calls, [{ method: 'pair', args: [uri] }]);
    assert(!f.calls.some(call => call.method === 'approve'));
    f.setClipboard(async () => 'https://invalid.example/');
    await click(f.button('Paste connection link'));
    assert.deepEqual(f.calls.at(-1), { method: 'pair', args: ['https://invalid.example/'] });
  } finally { f.close(); }
});

test('pairing uses the authoritative countdown without claiming app identity; no deadline invents none', () => {
  const f = fixture();
  f.update({ status: 'pairing', pairingExpiresAt: 220_000 });
  assert.match(f.text(), /Waiting for app request.*2:00/);
  assert(!f.text().includes('Example app'));
  assert(f.render().some(element => element.type === 'ActivityIndicator'));
  f.advance(61_000);
  assert.match(f.text(), /0:59/);
  click(f.button('Cancel'));
  assert.equal(f.calls.at(-1)!.method, 'cancel');
  f.update({ pairingExpiresAt: null });
  assert(!f.text().includes('Request expires'));
  f.close(); assert.equal(f.pendingTimers, 0);
});

test('proposal expiry disables approval, and account selection changes the disclosed method scope', () => {
  const f = fixture();
  const second = { id: 'hd:60:1', label: 'Savings', address: `0x${'34'.repeat(20)}` };
  f.proposal();
  const proposal = f.controller.getSnapshot().proposals[0]!;
  f.update({ accounts: [account, second], proposals: [{ ...proposal, methodsByAccount: [
    ...proposal.methodsByAccount, { accountId: second.id, methods: ['eth_accounts', 'personal_sign'], canApprove: true },
  ] }] });
  click(f.render().find(element => element.type === 'Pressable' && element.props.accessibilityLabel?.startsWith('Savings,'))!);
  assert.match(f.text(), /Request signatures for your approval/);
  assert(!f.text().includes('Request transactions for your approval'));
  f.advance(120_001);
  assert.equal(f.button('Connect').props.disabled, true);
  click(f.button('Connect'));
  assert(!f.calls.some(call => call.method === 'approve'));
  f.close();
});

test('required calls cannot connect through an incompatible selected Ledger account', () => {
  const f = fixture();
  try {
    const ledger = { id: 'ledger:60:0', label: 'Ledger', address: `0x${'34'.repeat(20)}` };
    f.proposal(['eth_accounts', 'wallet_sendCalls']);
    const proposal = f.controller.getSnapshot().proposals[0]!;
    f.update({ accounts: [account, ledger], proposals: [{ ...proposal, requiredMethods: ['wallet_sendCalls'], methodsByAccount: [
      ...proposal.methodsByAccount, { accountId: ledger.id, methods: ['eth_accounts'], canApprove: false },
    ] }] });
    click(f.render().find(element => element.type === 'Pressable' && element.props.accessibilityLabel?.startsWith('Ledger,'))!);
    assert.equal(f.button('Connect').props.disabled, true);
    assert(!f.text().includes('Request transactions for your approval'));
    assert(f.render().some(element => element.type === 'Notice'));
    click(f.button('Connect'));
    assert(!f.calls.some(call => call.method === 'approve'));
    click(f.render().find(element => element.type === 'Pressable' && element.props.accessibilityLabel?.startsWith('Daily wallet,'))!);
    assert.equal(f.button('Connect').props.disabled, false);
    assert(f.text().includes('Request transactions for your approval'));
  } finally { f.close(); }
});

test('a proposal without a supplied deadline never inherits the pairing timeout', () => {
  const f = fixture();
  f.proposal();
  const proposal = f.controller.getSnapshot().proposals[0]!;
  f.update({ status: 'pairing', pairingExpiresAt: 220_000, proposals: [{ ...proposal, expiresAt: null }] });
  assert(!f.text().includes('Request expires'));
  assert.equal(f.pendingTimers, 0);
  f.close();
});

test('connected app details are isolated, show the actual scope, and Back returns to the active list', () => {
  const f = fixture();
  f.update({ sessions: [f.session()] });
  click(f.render().find(element => element.type === 'Pressable' && element.props.accessibilityLabel?.startsWith('Example app,'))!);
  const elements = f.render(), copy = f.text(elements);
  assert.equal(elements.find(value => value.type === 'Header')!.props.title, 'Connected app');
  assert.match(copy, /Example app.*Connected.*Network.*Ethereum.*Account.*Daily wallet.*Permissions.*Expires/);
  assert(!copy.includes('Connect with WalletConnect'));
  assert(!copy.includes('Active connections'));
  assert(!copy.includes('Last used'));
  assert.equal(f.hardwareBack(), true);
  assert.match(f.text(), /Active connections/);
  assert.equal(f.back, 0);
  f.close();
});

test('connection expiry follows the selected Pali language instead of the device locale', async () => {
  const f = fixture('en-US');
  const expiresAt = Date.UTC(2030, 3, 5, 16, 7, 8);
  try {
    englishI18n.addResourceBundle('de', 'translation', languageMessages('de'), true, true);
    await englishI18n.changeLanguage('de');
    f.update({ sessions: [{ ...f.session(), expiresAt }] });
    const copy = f.text(openSession(f));
    assert(copy.includes(new Date(expiresAt).toLocaleString('de')));
    assert(!copy.includes(new Date(expiresAt).toLocaleString('en-US')));
    await englishI18n.changeLanguage('en');
    assert(f.text().includes(new Date(expiresAt).toLocaleString('en')));
    assert.equal(f.controller.getSnapshot().sessions[0]!.expiresAt, expiresAt);
    assert.equal(f.reads, 0);
    assert.deepEqual(f.calls, []);
  } finally {
    await englishI18n.changeLanguage('en');
    f.close();
  }
});

test('retired session actions cannot disconnect a successor and disappearance returns to empty list', async () => {
  const f = fixture();
  const session = f.session(); f.update({ sessions: [session] });
  click(f.render().find(element => element.type === 'Pressable' && element.props.accessibilityLabel?.startsWith('Example app,'))!);
  const staleDisconnect = f.button('Disconnect');
  f.update({ sessions: [{ ...session, name: 'Replacement app' }] });
  click(staleDisconnect); await flush();
  assert(!f.calls.some(call => call.method === 'disconnect'));
  f.update({ sessions: [] });
  assert.match(f.text(), /Active connections.*No active connections/);
  f.close();
});

for (const action of ['Open website', 'Disconnect'] as const) test(`session details show ${action} failure after public session objects refresh`, async () => {
  const f = fixture(), session = f.session(true);
  try {
    f.update({ sessions: [session] }); openSession(f);
    f.setSessionAction(async () => {
      f.update({ revision: 8, sessions: [{ ...session }], error: 'CONNECTION_UNAVAILABLE' });
      throw Object.assign(new Error('Private failure details'), { code: action === 'Open website' ? 'BLOCKED_SITE' : 'CONNECTION_UNAVAILABLE' });
    });
    click(f.button(action)); await settled();
    const notice = f.render().find(element => element.type === 'Notice');
    assert(notice, 'The visible details screen must explain a failed action');
    assert.match(String(notice.props.body), action === 'Open website' ? /known phishing list/ : /service is unavailable/);
    assert(!JSON.stringify(f.render()).includes('Private failure details'));
    assert.equal(f.button(action).props.disabled, false);
  } finally { f.close(); }
});

test('session action failures use a localized generic fallback for unknown errors', async () => {
  const f = fixture();
  try {
    f.update({ sessions: [f.session(true)] }); openSession(f);
    f.setSessionAction(async () => { throw Object.assign(new Error('Private URL or native error'), { code: 'ARBITRARY_INTERNAL_CODE' }); });
    click(f.button('Open website')); await settled();
    const notice = f.render().find(element => element.type === 'Notice');
    assert(notice); assert.equal(notice.props.body, 'The connection service is unavailable. Try again.');
    assert(!JSON.stringify(f.render()).includes('ARBITRARY_INTERNAL_CODE'));
  } finally { f.close(); }
});

test('session actions exclude synchronous duplicates and retry after a current failure', async () => {
  const f = fixture(), pending = Promise.withResolvers<void>();
  try {
    f.update({ sessions: [f.session(true)] }); openSession(f);
    f.setSessionAction(() => pending.promise);
    const open = f.button('Open website'), disconnect = f.button('Disconnect');
    click(open); click(open); click(disconnect);
    assert.equal(f.calls.filter(call => call.method === 'return').length, 1);
    assert.equal(f.calls.filter(call => call.method === 'disconnect').length, 0);
    assert.equal(f.button('Open website').props.disabled, true);
    assert.equal(f.button('Disconnect').props.disabled, true);
    assert(f.render().some(element => element.type === 'ActivityIndicator'));
    pending.reject(new Error('Unavailable')); await settled();
    f.setSessionAction(async () => {});
    click(f.button('Open website')); await settled();
    assert.equal(f.calls.filter(call => call.method === 'return').length, 2);
    assert.equal(f.render().filter(element => element.type === 'Notice').length, 0);
  } finally { pending.resolve(); f.close(); }
});

test('Back and reopening the same session retire old results without clearing a newer action', async () => {
  const f = fixture(), old = Promise.withResolvers<void>(), next = Promise.withResolvers<void>();
  try {
    f.update({ sessions: [f.session(true)] }); openSession(f);
    f.setSessionAction(() => old.promise);
    const stale = f.button('Open website'); click(stale);
    f.render().find(element => element.type === 'Header')!.props.onBack();
    openSession(f);
    f.setSessionAction(() => next.promise);
    click(stale);
    assert.equal(f.calls.filter(call => call.method === 'return').length, 1, 'Old callbacks cannot act after reopening');
    click(f.button('Open website'));
    old.reject(Object.assign(new Error('Old error'), { code: 'BLOCKED_SITE' })); await settled();
    assert.equal(f.button('Open website').props.disabled, true, 'Old completion cannot clear the new pending action');
    assert.equal(f.render().filter(element => element.type === 'Notice').length, 0);
    next.resolve(); await settled();
    assert.equal(f.button('Open website').props.disabled, false);
  } finally { old.resolve(); next.resolve(); f.close(); }
});

for (const retirement of ['replacement', 'controller', 'lock', 'unmount'] as const) test(`session action ignores late failure after ${retirement}`, async () => {
  const f = fixture(), pending = Promise.withResolvers<void>();
  let closed = false;
  try {
    const session = f.session(true); f.update({ sessions: [session] }); openSession(f);
    f.setSessionAction(() => pending.promise);
    const stale = f.button('Open website'); click(stale);
    if (retirement === 'replacement') f.update({ sessions: [{ ...session, name: 'Replacement app' }] });
    else if (retirement === 'controller') f.replaceController();
    else if (retirement === 'lock') f.update({ status: 'locked', sessions: [] });
    else { f.close(); closed = true; }
    if (!closed) f.render();
    click(stale);
    assert.equal(f.calls.filter(call => call.method === 'return').length, 1);
    pending.reject(Object.assign(new Error('Old error'), { code: 'BLOCKED_SITE' })); await settled();
    if (!closed) assert.equal(f.render().filter(element => element.type === 'Notice' && /known phishing list/.test(String(element.props.body))).length, 0);
  } finally { pending.resolve(); if (!closed) f.close(); }
});

test('leaving while a clipboard read is pending never starts pairing', async () => {
  const f = fixture();
  let resolve!: (value: string) => void;
  f.setClipboard(() => new Promise(done => { resolve = done; }));
  const paste = click(f.button('Paste connection link'));
  f.render().find(value => value.type === 'Header')!.props.onBack();
  resolve('wc:late-link'); await paste;
  assert(!f.calls.some(call => call.method === 'pair'));
  f.close();
});
