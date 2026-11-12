import { nativeTranslationFixture } from './localizationFixture.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import * as privateAuthentication from '../src/custody/privateAuthentication.ts';
import { operationAuthenticationCancellation, isOperationAuthenticationCancellation } from '../src/core/operationAuthentication.ts';
import { credentialPromptActivityState } from '../src/platform/credentialPort.ts';
import { allowsPrivateAuthenticationInterruption } from '../src/screens/privateAuthenticationLifecycle.ts';
import { screenElements, screenFixture, type ScreenElement } from './screenFixture.ts';

function fixture(backupConfirmed = true) {
  let authorizations = 0, tickets = 0, confirmations = 0, backs = 0, continuations = 0, sequence = 0;
  let holdProof = false, proofActive = false, holdCommit = false;
  let operationSignal: AbortSignal | undefined;
  let prompt: { approve(): void; cancel(): void; refuse(): void } | null = null;
  let nativeWindow = false;
  const requests: { signal: AbortSignal; authentication: privateAuthentication.NativePrivateAuthenticationScope; check(): void }[] = [];
  const proof = Promise.withResolvers<void>(), commit = Promise.withResolvers<'removed' | 'unchanged' | 'unconfirmed'>();
  const timers = new Map<number, () => void>(), listeners = new Map<string, Set<(state: string) => void>>();
  const ticket = Object.freeze({}), appState = { currentState: 'active', addEventListener };
  function addEventListener(event: string, listener: (state: string) => void) {
    const group = listeners.get(event) ?? new Set(); group.add(listener); listeners.set(event, group);
    return { remove() { group.delete(listener); } };
  }
  const f = screenFixture(new URL('../src/screens/NativeWalletRemoval.tsx', import.meta.url), 'NativeWalletRemovalScreen', {
    '../platform/localization': nativeTranslationFixture,
    'react-native': { AppState: appState,
      BackHandler: { addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'android' },
      StyleSheet: { create: (value: unknown) => value }, View: 'View' },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../custody/walletRemoval': { WalletRemovalError: class extends Error {} },
    '../ui': { styles: {}, colors: {}, ...Object.fromEntries(['Button', 'Header', 'Icon', 'Notice', 'Screen', 'Text'].map(name => [name, name])) },
    '../custody/privateAuthentication': privateAuthentication,
    '../core/operationAuthentication': { isOperationAuthenticationCancellation },
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption },
  }, {
    AbortController,
    setTimeout(callback: () => void, milliseconds: number) { assert.equal(milliseconds, 30_000); timers.set(++sequence, callback); return sequence; },
    clearTimeout(id: number) { timers.delete(id); },
  });
  const props = { backupConfirmed, isCurrent: () => true,
    removal: {
      async authorize(signal: AbortSignal, authentication: privateAuthentication.NativePrivateAuthenticationScope, check: () => void) {
        check(); authorizations++; requests.push({ signal, authentication, check });
        const binding = privateAuthentication.bindNativePrivateAuthentication(authentication, {
          assertCurrent: check, isPromptActive: owner => proofActive && owner === operationSignal &&
            credentialPromptActivityState('android', appState.currentState, { isCredentialPromptActive: () => nativeWindow }) !== 'background',
        });
        await privateAuthentication.withNativePrivateAuthentication(binding, signal, check, async owner => {
          operationSignal = owner;
          proofActive = true; nativeWindow = true;
          try {
            await new Promise<void>((resolve, reject) => {
              let complete = false;
              const done = (error?: Error) => {
                if (complete) return; complete = true; owner.removeEventListener('abort', abort); prompt = null;
                if (error) reject(error); else resolve();
              };
              const abort = () => done(Error('CANCELLED'));
              prompt = { approve: () => done(), cancel: () => done(operationAuthenticationCancellation()), refuse: () => done(Error('DEVICE_UNLOCK_UNAVAILABLE')) };
              owner.addEventListener('abort', abort, { once: true }); if (owner.aborted) abort();
            });
            if (holdProof) await proof.promise;
            check();
          } finally { proofActive = false; nativeWindow = false; }

        });
        check(); tickets++; return ticket;
      },
      cancel() {},
    },
    async confirm(received: object, check: () => void) {
      check(); assert.strictEqual(received, ticket); confirmations++;
      return holdCommit ? commit.promise : 'removed' as const;
    },
    onBack() { backs++; }, async onContinue() { continuations++; } };
  return { render: () => f.render(props), requests,
    close() { proof.resolve(); commit.resolve('unconfirmed'); f.close(); },
    counts: () => ({ authorizations, tickets, confirmations, backs, continuations }),
    get prompt() { return prompt; },
    expire() { for (const callback of [...timers.values()]) callback(); },
    retireNativePrompt() { proofActive = false; nativeWindow = false; },
    holdProof() { holdProof = true; }, releaseProof() { proof.resolve(); },
    holdCommit() { holdCommit = true; }, finishCommit(outcome: 'removed' | 'unchanged' | 'unconfirmed') { commit.resolve(outcome); },
    emit(state: string) {
      if (state !== 'blur' && state !== 'focus') appState.currentState = state;
      for (const listener of [...listeners.get(state === 'blur' || state === 'focus' ? state : 'change') ?? []]) listener(state);
    },
  };
}
function element(tree: ScreenElement, type: string) {
  const value = screenElements(tree).find(node => node.type === type); assert(value, type); return value;
}
function button(tree: ScreenElement, title: string) {
  const value = screenElements(tree).find(node => node.type === 'Button' && node.props.title === title); assert(value, title); return value;
}
function hasText(tree: ScreenElement, value: string) {
  return screenElements(tree).some(node => node.children.includes(value));
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
async function authorize(f: ReturnType<typeof fixture>) {
  button(f.render(), 'Continue').props.onPress();
  assert(f.prompt); f.prompt.approve();
  await settle(); return f.render();
}

for (const backupConfirmed of [false, true]) test(`removal footer keeps two-stage consent and reports backup ${backupConfirmed ? 'confirmed' : 'unverified'} honestly`, async () => {
  const f = fixture(backupConfirmed);
  try {
    let tree = f.render(), screen = element(tree, 'Screen');
    assert.equal(f.prompt, null); assert.equal(f.counts().authorizations, 0);
    assert(button(screen.props.footer, 'Continue')); assert(button(screen.props.footer, 'Cancel'));
    assert.equal(screenElements(tree).some(node => node.type === 'PinField'), false);
    assert.equal(screenElements(screen.children).some(node => node.type === 'Button'), false);
    tree = await authorize(f); screen = element(tree, 'Screen');
    assert.equal(f.counts().authorizations, 1); assert.equal(f.counts().confirmations, 0);
    assert.equal(screenElements(tree).some(node => node.type === 'PinField'), false);
    assert(screenElements(tree).some(node => node.type === 'Icon' && node.props.name === 'trash'));
    assert.equal(screenElements(tree).some(node => node.type === 'Notice' && node.props.title === 'Backup not verified'), !backupConfirmed);
    assert(button(screen.props.footer, 'Remove wallet')); assert(button(screen.props.footer, 'Cancel'));
    assert.equal(screenElements(screen.children).some(node => node.type === 'Button'), false);
    assert.equal(f.requests[0]!.signal.aborted, false);
    button(tree, 'Remove wallet').props.onPress(); await settle();
    tree = f.render(); assert.equal(f.counts().confirmations, 1);
    assert.equal(f.requests[0]!.signal.aborted, true);
    assert.equal(element(tree, 'Header').props.onBack, undefined);
    button(tree, 'Continue').props.onPress(); await settle(); assert.equal(f.counts().continuations, 1);
  } finally { f.close(); }
});

test('the existing 30-second timer retires confirmation before a stale Remove callback', async () => {
  const f = fixture(true);
  try {
    const review = await authorize(f), stale = button(review, 'Remove wallet');
    f.expire(); const tree = f.render();
    assert.equal(f.requests[0]!.signal.aborted, true);
    assert(hasText(tree, 'Confirmation expired. Authorize again to continue.'));
    assert(button(tree, 'Continue'));
    assert.equal(screenElements(tree).some(node => node.props.title === 'Remove wallet' && node.type === 'Button'), false);
    stale.props.onPress(); await settle(); assert.equal(f.counts().confirmations, 0);
    const fresh = await authorize(f);
    stale.props.onPress(); await settle(); assert.equal(f.counts().confirmations, 0);
    button(fresh, 'Remove wallet').props.onPress(); await settle(); assert.equal(f.counts().confirmations, 1);
  } finally { f.close(); }
});

test('shared prompt Cancel returns to the unchanged removal intro and permits one fresh explicit request', async () => {
  const f = fixture(false);
  try {
    const start = button(f.render(), 'Continue'); start.props.onPress(); start.props.onPress();
    assert.equal(f.counts().authorizations, 1); assert(f.prompt);
    const first = f.requests[0]!;
    f.prompt.cancel(); await settle();
    const intro = f.render();
    assert.equal(first.signal.aborted, true); assert.equal(first.authentication.isAuthenticating(), false);
    assert.equal(f.counts().backs, 0); assert.equal(f.counts().tickets, 0);
    assert.equal(screenElements(intro).some(node => node.props.accessibilityRole === 'alert'), false);
    assert(hasText(intro, 'Removing this wallet deletes its accounts, Sentry keys, private notes, and saved transaction records from this device.'));
    assert.equal(f.counts().authorizations, 1);
    await authorize(f);
    assert.equal(f.counts().authorizations, 2); assert.notEqual(f.requests[1]!.authentication, first.authentication);
    assert.equal(f.counts().confirmations, 0);
  } finally { f.close(); }
});

test('a refused device prompt issues no removal ticket and allows a fresh request', async () => {
  const f = fixture();
  try {
    button(f.render(), 'Continue').props.onPress(); assert(f.prompt);
    f.prompt.refuse(); await settle();
    assert.equal(f.prompt, null); assert.equal(f.counts().tickets, 0); assert.equal(f.counts().confirmations, 0);
    assert(hasText(f.render(), 'Could not authorize wallet removal. Try again.'));
    await authorize(f); assert(button(f.render(), 'Remove wallet')); assert.equal(f.counts().tickets, 1);
  } finally { f.close(); }
});

test('only the matching active device proof survives inactive and Android blur', async () => {
  const f = fixture();
  try {
    f.holdProof(); button(f.render(), 'Continue').props.onPress(); assert(f.prompt);
    f.prompt.approve();
    const request = f.requests[0]!; assert.equal(request.authentication.isAuthenticating(), true);
    f.emit('inactive'); f.emit('blur');
    assert.equal(request.signal.aborted, false); assert.equal(f.counts().backs, 0);
    f.emit('active'); f.emit('focus'); f.releaseProof(); await settle();
    assert(button(f.render(), 'Remove wallet')); assert.equal(f.counts().tickets, 1);
  } finally { f.close(); }
});

for (const state of ['inactive', 'blur', 'background']) test(`unprotected ${state} cancels the pending removal prompt and ignores its late callback`, async () => {
  const f = fixture();
  try {
    button(f.render(), 'Continue').props.onPress(); assert(f.prompt);
    const stale = f.prompt, request = f.requests[0]!;
    f.retireNativePrompt(); f.emit(state); assert.equal(request.signal.aborted, true); assert.equal(f.prompt, null);
    f.emit('active'); stale.approve(); await settle();
    assert(button(f.render(), 'Continue')); assert.equal(f.counts().tickets, 0); assert.equal(f.counts().confirmations, 0);
  } finally { f.close(); }
});

for (const boundary of ['back', 'unmount'] as const) test(`${boundary} aborts the matching authorization and ignores its late proof`, async () => {
  const f = fixture();
  try {
    f.holdProof(); button(f.render(), 'Continue').props.onPress(); f.prompt!.approve();
    const request = f.requests[0]!;
    if (boundary === 'back') button(f.render(), 'Cancel').props.onPress(); else f.close();
    assert.equal(request.signal.aborted, true); assert.equal(request.authentication.isAuthenticating(), false);
    f.releaseProof(); await settle();
    assert.equal(f.counts().tickets, 0); assert.equal(f.counts().confirmations, 0);
    assert.equal(f.counts().backs, boundary === 'back' ? 1 : 0);
  } finally { f.close(); }
});

test('device authentication success cannot expose a destructive review while still inactive', async () => {
  const f = fixture();
  try {
    f.holdProof(); button(f.render(), 'Continue').props.onPress(); f.prompt!.approve();
    f.emit('inactive'); f.releaseProof(); await settle();
    assert.equal(f.requests[0]!.signal.aborted, true);
    assert.equal(screenElements(f.render()).some(node => node.type === 'Button' && node.props.title === 'Remove wallet'), false);
    assert.equal(f.counts().confirmations, 0);
  } finally { f.close(); }
});

for (const outcome of ['removed', 'unchanged', 'unconfirmed'] as const) test(`cancelled dispatched removal still reconciles its ${outcome} outcome`, async () => {
  const f = fixture();
  try {
    f.holdCommit(); const review = await authorize(f);
    button(review, 'Remove wallet').props.onPress(); button(f.render(), 'Cancel removal').props.onPress();
    assert.equal(f.requests[0]!.signal.aborted, true); assert.equal(f.counts().backs, 0);
    assert(hasText(f.render(), 'Checking whether removal completed…'));
    f.finishCommit(outcome); await settle();
    const result = f.render(); assert.equal(element(result, 'Header').props.onBack, undefined);
    if (outcome === 'unconfirmed') assert.equal(screenElements(result).some(node => node.type === 'Button'), false);
    else assert(button(result, outcome === 'removed' ? 'Continue' : 'Return to wallet'));
  } finally { f.close(); }
});
