import assert from 'node:assert/strict';
import test from 'node:test';
import { screenElements, screenFixture } from './screenFixture.ts';

function fixture() {
  const listeners = new Map<string, (...args: any[]) => void>(), calls: unknown[][] = [], rejected: string[] = [], copies: string[] = [];
  let preview: Promise<string> = Promise.resolve(' \n plaintext ');
  const review = { kind: 'encryption', id: 'encryption-1', revision: 7, method: 'eth_decrypt', appName: 'App', origin: 'https://example.invalid', address: '0x123', accountLabel: 'Account', networkLabel: 'Network', chainId: '99', busy: false, dispatched: false, needsAccountSwitch: false, error: null, ciphertext: '0xab', verification: { validation: 'UNKNOWN', isScam: false } };
  const controller = {
    async previewEncryption(...args: unknown[]) { calls.push(['preview', ...args]); return preview; },
    async approveRequest(...args: unknown[]) { calls.push(['approve', ...args]); },
    async activateRequestAccount(...args: unknown[]) { calls.push(['switch', ...args]); },
    async rejectRequest(id: string) { rejected.push(id); },
  };
  const add = (event: string, listener: (...args: any[]) => void) => { listeners.set(event, listener); return { remove() { if (listeners.get(event) === listener) listeners.delete(event); } }; };
  const f = screenFixture(new URL(process.env.PALI_ENCRYPTION_REVIEW_SOURCE ?? '../src/screens/NativeEncryptionReview.tsx', import.meta.url), 'NativeEncryptionReviewScreen', {
    'react-native': { StyleSheet: { create: (v: unknown) => v }, AppState: { addEventListener: add }, BackHandler: { addEventListener: add } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-clipboard': { async setStringAsync(text: string) { copies.push(text); return true; } },
    '../platform/localization': { useNativeTranslation: () => ({ t: (key: string) => key }) },
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Header', 'Notice', 'Screen', 'Text'].map(name => [name, name])), colors: {} },
    './DappSiteStatus': { DappSiteStatus: 'SiteStatus' },
  });
  const render = () => screenElements(f.render({ review, controller }));
  const button = (title: string) => render().find(e => e.type === 'Button' && e.props.title === title)!;
  return { review, calls, rejected, copies, render, button, close: f.close, emit: (name: string, ...args: unknown[]) => listeners.get(name)?.(...args), hold(value: Promise<string>) { preview = value; }, async tick() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); } };
}

test('native encryption preview is optional, preserves whitespace, copies exact plaintext and confirms only identifiers', async () => {
  const f = fixture();
  f.button('transactions.decryptMessage').props.onPress(); await f.tick();
  assert(f.render().some(e => e.type === 'Text' && e.children.includes(' \n plaintext ')));
  f.button('transactions.copyMessage').props.onPress(); await f.tick();
  assert.deepEqual(f.copies, [' \n plaintext ']);
  f.button('buttons.confirm').props.onPress(); await f.tick();
  assert.deepEqual(f.calls, [['preview', 'encryption-1', 7], ['approve', 'encryption-1', 7, false]]);
  assert(!f.render().some(e => e.children.includes(' \n plaintext ')));
  f.close();
});

test('native encryption confirms without preview and treats empty preview as a value', async () => {
  const f = fixture();
  f.button('buttons.confirm').props.onPress(); await f.tick();
  assert.deepEqual(f.calls, [['approve', 'encryption-1', 7, false]]);
  f.hold(Promise.resolve('')); f.button('transactions.decryptMessage').props.onPress(); await f.tick();
  assert(f.button('transactions.copyMessage')); assert(!f.render().some(e => e.props.title === 'transactions.decryptMessage'));
  f.close();
});

for (const event of ['background', 'blur', 'back', 'unmount', 'source']) test(`late native plaintext is suppressed after ${event}`, async () => {
  const f = fixture(); let release!: (text: string) => void;
  f.hold(new Promise(resolve => { release = resolve; }));
  f.button('transactions.decryptMessage').props.onPress();
  if (event === 'background') f.emit('change', 'background');
  else if (event === 'blur') f.emit('blur');
  else if (event === 'back') assert.equal(f.emit('hardwareBackPress'), true);
  else if (event === 'source') { f.review.id = 'successor'; f.render(); }
  else f.close();
  release('Late plaintext'); await f.tick();
  if (event !== 'unmount') assert(!f.render().some(e => e.children.includes('Late plaintext')));
  if (event === 'background' || event === 'blur' || event === 'back') assert.deepEqual(f.rejected, ['encryption-1']);
  else assert.deepEqual(f.rejected, []);
  f.close();
});

test('same-ID scope round trip releases cached plaintext and requires a fresh preview', async () => {
  const f = fixture();
  f.button('transactions.decryptMessage').props.onPress(); await f.tick();
  assert(f.render().some(e => e.children.includes(' \n plaintext ')));
  f.review.needsAccountSwitch = true; f.render();
  assert(!f.render().some(e => e.children.includes(' \n plaintext ')));
  f.review.needsAccountSwitch = false; f.render();
  assert(!f.render().some(e => e.children.includes(' \n plaintext ')));
  assert(!f.render().some(e => e.props.title === 'transactions.copyMessage'));
  assert(f.button('transactions.decryptMessage'));
  f.close();
});

test('same-ID scope changes clear local crypto errors instead of reviving them', async () => {
  const f = fixture();
  f.hold(Promise.reject(new Error('Synthetic crypto error')));
  f.button('transactions.decryptMessage').props.onPress(); await f.tick();
  assert(f.render().some(e => e.type === 'Notice' && e.props.body === 'Synthetic crypto error'));
  f.review.needsAccountSwitch = true; f.render(); f.render();
  f.review.needsAccountSwitch = false; f.render();
  assert(!f.render().some(e => e.type === 'Notice' && e.props.body === 'Synthetic crypto error'));
  f.close();
});
