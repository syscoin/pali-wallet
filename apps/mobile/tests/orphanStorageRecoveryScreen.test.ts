import assert from 'node:assert/strict';
import test from 'node:test';
import { operationAuthenticationCancellation, isOperationAuthenticationCancellation } from '../src/core/operationAuthentication.ts';
import type { resetOrphanedWalletStorage } from '../src/storage/coordinator.ts';
import { WalletStorageError } from '../src/storage/types.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';
import { screenElements, screenFixture, type ScreenElement } from './screenFixture.ts';

type ResetOptions = Parameters<typeof resetOrphanedWalletStorage>[1];
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const copy = (key: string) => nativeTranslationFixture.nativeI18n.t(key);
const action = () => copy('mobile.storageRecovery.action');

function fixture() {
  let current = 0, closed = false, nativePrompt = false, ignoreAbort = false;
  let holdCommit = false, ignoreLateCommitGuard = false, reloadFails = false;
  let commitError: Error | null = null;
  const probe = Promise.withResolvers<boolean>(), authorization = Promise.withResolvers<void>();
  const commit = Promise.withResolvers<void>();
  const availability: boolean[] = [], events: string[] = [];
  const promptOwners: { signal: AbortSignal; active: boolean }[] = [];
  const requests: ResetOptions[] = [];
  let authCalls = 0, mutations = 0, reloads = 0;
  const listeners = new Map<string, Set<(state: string) => unknown>>();
  function addEventListener(name: string, listener: (state: string) => unknown) {
    const group = listeners.get(name) ?? new Set(); group.add(listener); listeners.set(name, group);
    return { remove() { group.delete(listener); } };
  }
  const appState = { currentState: 'active', addEventListener };
  const f = screenFixture(new URL('../src/screens/OrphanedStorageRecovery.tsx', import.meta.url), 'OrphanedStorageRecovery', {
    'react-native': { AppState: appState, BackHandler: { addEventListener }, Platform: { OS: 'android' }, View: 'View', StyleSheet: { create: (value: unknown) => value } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    expo: { async reloadAppAsync(reason: string) {
      assert.equal(reason, 'Pali orphaned setup reset');
      assert(mutations === 1 || commitError instanceof WalletStorageError, 'only completed or uncertain reset may reopen the same application');
      reloads++; events.push('reload');
      if (reloadFails) throw Error('RELOAD_UNAVAILABLE');
    } },
    '../storage/native': {
      canResetNativeWalletStorage() { events.push('probe'); return probe.promise; },
      async resetNativeWalletStorage(options: ResetOptions) {
        requests.push(options); options.assertCurrent();
        await options.authorize(options.signal, options.assertCurrent);
        options.assertCurrent(); events.push('authorized');
        if (holdCommit) await commit.promise;
        if (commitError) throw commitError;
        if (!ignoreLateCommitGuard) options.assertCurrent();
        mutations++; events.push('reset-complete');
      },
    },
    '../platform/credential': {
      isNativeCredentialPromptActive(signal: AbortSignal) {
        return nativePrompt && requests.at(-1)?.signal === signal;
      },
      async authorizePublicView(signal: AbortSignal, check: () => void) {
        authCalls++; check(); nativePrompt = true; events.push('authorize');
        const aborted = () => { if (!ignoreAbort) authorization.reject(Error('CANCELLED')); };
        signal.addEventListener('abort', aborted, { once: true });
        try { await authorization.promise; check(); }
        finally { nativePrompt = false; signal.removeEventListener('abort', aborted); }
      },
    },
    '../core/operationAuthentication': { isOperationAuthenticationCancellation },
    '../storage/types': { WalletStorageError },
    '../platform/localization': nativeTranslationFixture,
    '../ui': { styles: {}, colors: {}, ...Object.fromEntries(['Button', 'Header', 'Screen', 'Icon', 'Notice', 'Text'].map(name => [name, name])) },
  }, { AbortController });
  const props = {
    onBack() { events.push('back'); },
    captureOwner() { const captured = current; return () => { if (captured !== current) throw Error('CANCELLED'); }; },
    onAvailability(value: boolean) { availability.push(value); },
    onResetOwner(signal: AbortSignal, active: boolean) { promptOwners.push({ signal, active }); },
  };
  function close() { if (!closed) { closed = true; f.close(); } }
  return {
    render: () => f.render(props), close, availability, events, promptOwners, requests,
    counts: () => ({ authCalls, mutations, reloads }),
    ready(value = true) { probe.resolve(value); }, probeFailed() { probe.reject(Error('STORAGE_UNAVAILABLE')); },
    approve() { authorization.resolve(); }, cancelAuth() { authorization.reject(operationAuthenticationCancellation()); },
    failAuth() { authorization.reject(Error('CREDENTIAL_UNAVAILABLE')); },
    invalidate() { current++; }, retirePrompt() { nativePrompt = false; },
    holdAuthAfterCancellation() { ignoreAbort = true; },
    holdCommit() { holdCommit = true; }, finishCommit() { commit.resolve(); },
    simulateLateCompletedCommit() { ignoreLateCommitGuard = true; },
    uncertainCommit() { commitError = new WalletStorageError('STORAGE_REOPEN_REQUIRED'); },
    failReload() { reloadFails = true; },
    listeners: () => [...listeners.values()].reduce((sum, group) => sum + group.size, 0),
    back() { return [...listeners.get('hardwareBackPress') ?? []].some(handler => handler('')); },
    emit(state: string) {
      if (state !== 'blur' && state !== 'focus') appState.currentState = state;
      for (const handler of [...listeners.get(state === 'blur' || state === 'focus' ? state : 'change') ?? []]) handler(state);
    },
  };
}

function button(tree: ScreenElement, title: string) {
  const matches = screenElements(tree).filter(node => node.type === 'Button' && node.props.title === title);
  assert.equal(matches.length, 1, title); return matches[0]!;
}
function notices(tree: ScreenElement) { return screenElements(tree).filter(node => node.type === 'Notice'); }
function hasCopy(tree: ScreenElement, key: string) { return screenElements(tree).some(node => node.children.includes(copy(key))); }
async function intro(f: ReturnType<typeof fixture>) {
  assert.equal(f.render(), null); f.ready(); await settle(); return f.render();
}
async function confirm(f: ReturnType<typeof fixture>) {
  button(await intro(f), action()).props.onPress();
  const tree = f.render(); assert(hasCopy(tree, 'mobile.storageRecovery.confirmBody')); return tree;
}

for (const outcome of ['unavailable', 'probe failure'] as const) test(`orphan reset has no CTA after ${outcome}`, async () => {
  const f = fixture();
  try {
    assert.equal(f.render(), null);
    if (outcome === 'unavailable') f.ready(false); else f.probeFailed();
    await settle(); assert.equal(f.render(), null);
    assert.deepEqual(f.availability, outcome === 'unavailable' ? [false] : []);
    assert.deepEqual(f.counts(), { authCalls: 0, mutations: 0, reloads: 0 });
  } finally { f.close(); }
});

for (const boundary of ['changed owner', 'unmount'] as const) test(`${boundary} ignores a late positive orphan probe`, async () => {
  const f = fixture();
  try {
    assert.equal(f.render(), null);
    if (boundary === 'changed owner') f.invalidate(); else f.close();
    f.ready(); await settle();
    assert.deepEqual(f.availability, []); assert.deepEqual(f.counts(), { authCalls: 0, mutations: 0, reloads: 0 });
    if (boundary === 'changed owner') assert.equal(f.render(), null);
    else assert.equal(f.listeners(), 0);
  } finally { f.close(); }
});

test('only the second explicit reset action authorizes; Cancel and Back return to the warning', async () => {
  const f = fixture();
  try {
    let tree = await intro(f);
    assert(hasCopy(tree, 'mobile.storageRecovery.body')); assert.deepEqual(f.availability, [true]);
    assert.equal(f.back(), false);
    button(tree, action()).props.onPress(); tree = f.render();
    assert.equal(button(tree, action()).props.variant, 'danger'); assert(hasCopy(tree, 'mobile.storageRecovery.confirmBody'));
    button(tree, copy('buttons.cancel')).props.onPress(); tree = f.render();
    assert(hasCopy(tree, 'mobile.storageRecovery.body'));
    button(tree, action()).props.onPress(); f.render(); assert.equal(f.back(), true);
    assert(hasCopy(f.render(), 'mobile.storageRecovery.body'));
    assert.deepEqual(f.counts(), { authCalls: 0, mutations: 0, reloads: 0 });
  } finally { f.close(); }
});

for (const outcome of ['cancel', 'failure'] as const) test(`OS authorization ${outcome} preserves setup and never reloads`, async () => {
  const f = fixture();
  try {
    button(await confirm(f), action()).props.onPress();
    assert.equal(button(f.render(), copy('mobile.storageRecovery.working')).props.disabled, true);
    if (outcome === 'cancel') f.cancelAuth(); else f.failAuth();
    await settle(); const tree = f.render();
    assert(hasCopy(tree, 'mobile.storageRecovery.body'));
    assert.equal(notices(tree).length, outcome === 'failure' ? 1 : 0);
    assert.deepEqual(f.counts(), { authCalls: 1, mutations: 0, reloads: 0 });
    assert.equal(f.requests[0]!.signal.aborted, true);
    assert.equal(f.promptOwners.at(-1)?.active, false);
  } finally { f.close(); }
});

test('double press starts one reset and same-bundle reload waits for completed storage reset', async () => {
  const f = fixture();
  try {
    f.holdCommit(); const review = await confirm(f), reset = button(review, action());
    reset.props.onPress(); reset.props.onPress(); f.approve(); await settle();
    assert.deepEqual(f.counts(), { authCalls: 1, mutations: 0, reloads: 0 });
    assert.equal(f.requests.length, 1); assert.equal(f.promptOwners.at(-1)?.active, true);
    f.finishCommit(); await settle();
    assert.deepEqual(f.counts(), { authCalls: 1, mutations: 1, reloads: 1 });
    assert.deepEqual(f.events, ['probe', 'authorize', 'authorized', 'reset-complete', 'reload']);
    assert(hasCopy(f.render(), 'mobile.storageRecovery.complete'));
    assert.equal(f.requests[0]!.signal.aborted, true);
  } finally { f.close(); }
});

test('failed reload preserves reset completion and offers another same-bundle restart', async () => {
  const f = fixture();
  try {
    f.failReload(); button(await confirm(f), action()).props.onPress(); f.approve(); await settle();
    const tree = f.render(); assert(hasCopy(tree, 'mobile.storageRecovery.restart')); assert.equal(notices(tree).length, 0);
    button(tree, copy('buttons.continue')).props.onPress(); await settle();
    assert.deepEqual(f.counts(), { authCalls: 1, mutations: 1, reloads: 2 });
  } finally { f.close(); }
});

for (const boundary of ['back', 'background', 'blur', 'unmount', 'changed owner'] as const) test(`${boundary} prevents late authorization from resetting or reloading`, async () => {
  const f = fixture();
  try {
    f.holdAuthAfterCancellation(); button(await confirm(f), action()).props.onPress();
    if (boundary === 'back') assert.equal(f.back(), true);
    else if (boundary === 'unmount') f.close();
    else if (boundary === 'changed owner') f.invalidate();
    else { f.retirePrompt(); f.emit(boundary); }
    if (boundary !== 'changed owner') assert.equal(f.requests[0]!.signal.aborted, true);
    assert.equal(f.promptOwners.at(-1)?.active, true, 'reset ownership remains held until cancelled work drains');
    f.approve(); await settle();
    assert.deepEqual(f.counts(), { authCalls: 1, mutations: 0, reloads: 0 });
    assert.equal(f.requests[0]!.signal.aborted, true);
    assert.equal(f.promptOwners.at(-1)?.active, false);
    if (boundary === 'unmount') assert.equal(f.listeners(), 0);
  } finally { f.close(); }
});

test('only the matching OS prompt may survive inactive and Android blur', async () => {
  const f = fixture();
  try {
    button(await confirm(f), action()).props.onPress();
    f.emit('inactive'); f.emit('blur'); assert.equal(f.requests[0]!.signal.aborted, false);
    f.emit('active'); f.emit('focus'); f.approve(); await settle();
    assert.deepEqual(f.counts(), { authCalls: 1, mutations: 1, reloads: 1 });
  } finally { f.close(); }
});

test('late storage completion after background cannot reload or publish success', async () => {
  const f = fixture();
  try {
    f.holdCommit(); f.simulateLateCompletedCommit();
    button(await confirm(f), action()).props.onPress(); f.approve(); await settle();
    f.emit('background'); assert.equal(f.requests[0]!.signal.aborted, true);
    f.finishCommit(); await settle();
    assert.deepEqual(f.counts(), { authCalls: 1, mutations: 1, reloads: 0 });
    assert.equal(hasCopy(f.render(), 'mobile.storageRecovery.complete'), false);
  } finally { f.close(); }
});

for (const canceled of [false, true]) test(`uncertain dispatched deletion${canceled ? ' after cancellation' : ''} requires reopen without a second reset or success claim`, async () => {
  const f = fixture();
  try {
    f.holdCommit(); f.uncertainCommit();
    const staleReset = button(await confirm(f), action()); staleReset.props.onPress();
    f.approve(); await settle();
    if (canceled) assert.equal(f.back(), true);
    f.finishCommit(); await settle();
    const tree = f.render();
    assert(hasCopy(tree, 'mobile.storageRecovery.reopenRequired'));
    assert.equal(hasCopy(tree, 'mobile.storageRecovery.complete'), false);
    assert.equal(screenElements(tree).some(node => node.type === 'Icon' && node.props.name === 'check'), false);
    assert.equal(screenElements(tree).some(node => node.type === 'Button' && node.props.title === action()), false);
    assert.deepEqual(f.counts(), { authCalls: 1, mutations: 0, reloads: 0 });
    staleReset.props.onPress(); await settle(); assert.equal(f.requests.length, 1);
    button(f.render(), copy('buttons.continue')).props.onPress(); await settle();
    assert.deepEqual(f.counts(), { authCalls: 1, mutations: 0, reloads: 1 });
  } finally { f.close(); }
});

test('retained reset callback cannot authorize after Back', async () => {
  const f = fixture();
  try {
    const staleReset = button(await confirm(f), action());
    assert.equal(f.back(), true); staleReset.props.onPress(); await settle();
    assert.deepEqual(f.counts(), { authCalls: 0, mutations: 0, reloads: 0 });
    assert.equal(f.requests.length, 0);
    assert(hasCopy(f.render(), 'mobile.storageRecovery.body'));
  } finally { f.close(); }
});

test('retained intro callback cannot turn a repeated click into reset consent', async () => {
  const f = fixture();
  try {
    const oldIntro = button(await intro(f), action());
    oldIntro.props.onPress(); f.render(); oldIntro.props.onPress(); await settle();
    assert(hasCopy(f.render(), 'mobile.storageRecovery.confirmBody'));
    assert.deepEqual(f.counts(), { authCalls: 0, mutations: 0, reloads: 0 });
  } finally { f.close(); }
});

test('retained reset callback cannot authorize after its probed owner retires', async () => {
  const f = fixture();
  try {
    const staleReset = button(await confirm(f), action());
    f.invalidate(); staleReset.props.onPress(); await settle();
    assert.deepEqual(f.counts(), { authCalls: 0, mutations: 0, reloads: 0 });
  } finally { f.close(); }
});

for (const boundary of ['changed owner', 'unmount'] as const) test(`retained restart callback ignores ${boundary}`, async () => {
  const f = fixture();
  try {
    f.failReload(); button(await confirm(f), action()).props.onPress(); f.approve(); await settle();
    const staleRestart = button(f.render(), copy('buttons.continue'));
    if (boundary === 'changed owner') f.invalidate(); else f.close();
    staleRestart.props.onPress(); await settle();
    assert.deepEqual(f.counts(), { authCalls: 1, mutations: 1, reloads: 1 });
  } finally { f.close(); }
});


test('recovery header returns from confirmation without authorizing and ignores stale navigation during reset', async () => {
  const f = fixture();
  try {
    let tree = await intro(f);
    const header = () => screenElements(tree).find(node => node.type === 'Header')!;
    header().props.onBack();
    assert.equal(f.events.filter(event => event === 'back').length, 1);
    button(tree, action()).props.onPress(); tree = f.render();
    header().props.onBack(); tree = f.render();
    assert(hasCopy(tree, 'mobile.storageRecovery.body'));
    button(tree, action()).props.onPress(); tree = f.render();
    const staleBack = header().props.onBack;
    button(tree, action()).props.onPress(); staleBack(); tree = f.render();
    assert.equal(button(tree, copy('mobile.storageRecovery.working')).props.disabled, true);
    assert.deepEqual(f.counts(), { authCalls: 1, mutations: 0, reloads: 0 });
    f.cancelAuth(); await settle();
  } finally { f.close(); }
});
