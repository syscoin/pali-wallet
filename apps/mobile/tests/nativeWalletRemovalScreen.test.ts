import assert from 'node:assert/strict';
import test from 'node:test';
import { screenElements, screenFixture, type ScreenElement } from './screenFixture.ts';

function fixture(backupConfirmed: boolean) {
  let authorizations = 0, confirmations = 0, backs = 0, continuations = 0, sequence = 0;
  const timers = new Map<number, () => void>();
  const ticket = Object.freeze({});
  const f = screenFixture(new URL('../src/screens/NativeWalletRemoval.tsx', import.meta.url), 'NativeWalletRemovalScreen', {
    'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
      BackHandler: { addEventListener: () => ({ remove() {} }) }, Keyboard: { dismiss() {} },
      KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'android' },
      StyleSheet: { create: (value: unknown) => value }, View: 'View' },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../custody/walletRemoval': { WalletRemovalError: class extends Error {} },
    '../ui': { styles: {}, colors: {}, ...Object.fromEntries(['Button', 'Header', 'Icon', 'Notice', 'Screen', 'Text'].map(name => [name, name])) },
    './PinEntry': { PinField: 'PinField' },
  }, {
    setTimeout(callback: () => void, milliseconds: number) { assert.equal(milliseconds, 30_000); timers.set(++sequence, callback); return sequence; },
    clearTimeout(id: number) { timers.delete(id); },
  });
  const props = { backupConfirmed, isCurrent: () => true,
    removal: { async authorize(password: string, check: () => void) { check(); assert.equal(password, '123456'); authorizations++; return ticket; }, cancel() {} },
    async confirm(received: object, check: () => void) { check(); assert.strictEqual(received, ticket); confirmations++; return 'removed' as const; },
    onBack() { backs++; }, async onContinue() { continuations++; } };
  return { render: () => f.render(props), close: f.close,
    counts: () => ({ authorizations, confirmations, backs, continuations }),
    expire() { for (const callback of [...timers.values()]) callback(); } };
}
function element(tree: ScreenElement, type: string) {
  const value = screenElements(tree).find(node => node.type === type); assert(value, type); return value;
}
function button(tree: ScreenElement, title: string) {
  const value = screenElements(tree).find(node => node.type === 'Button' && node.props.title === title); assert(value, title); return value;
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
async function authorize(f: ReturnType<typeof fixture>) {
  element(f.render(), 'PinField').props.onChange('123456');
  button(f.render(), 'Continue').props.onPress(); await settle(); return f.render();
}

for (const backupConfirmed of [false, true]) test(`removal footer keeps two-stage consent and reports backup ${backupConfirmed ? 'confirmed' : 'unverified'} honestly`, async () => {
  const f = fixture(backupConfirmed);
  try {
    let tree = f.render(), screen = element(tree, 'Screen');
    assert(button(screen.props.footer, 'Continue')); assert(button(screen.props.footer, 'Cancel'));
    assert.equal(screenElements(screen.children).some(node => node.type === 'Button'), false);
    tree = await authorize(f); screen = element(tree, 'Screen');
    assert.equal(f.counts().authorizations, 1); assert.equal(f.counts().confirmations, 0);
    assert.equal(screenElements(tree).some(node => node.type === 'PinField'), false);
    assert(screenElements(tree).some(node => node.type === 'Icon' && node.props.name === 'trash'));
    assert.equal(screenElements(tree).some(node => node.type === 'Notice' && node.props.title === 'Backup not verified'), !backupConfirmed);
    assert(button(screen.props.footer, 'Remove wallet')); assert(button(screen.props.footer, 'Cancel'));
    assert.equal(screenElements(screen.children).some(node => node.type === 'Button'), false);
    button(tree, 'Remove wallet').props.onPress(); await settle();
    tree = f.render(); assert.equal(f.counts().confirmations, 1);
    assert.equal(element(tree, 'Header').props.onBack, undefined);
    button(tree, 'Continue').props.onPress(); await settle(); assert.equal(f.counts().continuations, 1);
  } finally { f.close(); }
});

test('the existing 30-second timer retires confirmation before a stale Remove callback', async () => {
  const f = fixture(true);
  try {
    const review = await authorize(f), stale = button(review, 'Remove wallet');
    f.expire(); const tree = f.render();
    assert.equal(element(tree, 'PinField').props.value, '');
    assert.equal(screenElements(tree).some(node => node.props.title === 'Remove wallet' && node.type === 'Button'), false);
    stale.props.onPress(); await settle(); assert.equal(f.counts().confirmations, 0);
  } finally { f.close(); }
});
