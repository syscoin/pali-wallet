import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as authentication from '../src/custody/privateAuthentication.ts';
import * as importedAccounts from '../src/custody/importedAccounts.ts';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import { createKeyringRuntimeFactory, type KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import { loadNativeKeyringSdk } from '../src/custody/keyringSdk.ts';
import { operationAuthenticationCancellation, isOperationAuthenticationCancellation } from '../src/core/operationAuthentication.ts';
import { DeviceUnlockPrompt } from '../src/platform/deviceUnlockPrompt.ts';
import { allowsPrivateAuthenticationInterruption } from '../src/screens/privateAuthenticationLifecycle.ts';
import { UTXO_IMPORT_LABELS, UTXO_IMPORT_TYPES } from '../src/core/utxoAddresses.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { createTestCredentialPort } from './fixtures/credential.ts';
import { digest, INSTALLATION, nodeConnection } from './storageHelpers.ts';
import { BITCOIN_WIF_KEY, BITCOIN_WIF_ADDRESS } from './native-watch-ui/utxoImportVectors.ts';
import { nativeTranslationFixture, languageMessages } from './localizationFixture.ts';
import { screenElements, screenFixture } from './screenFixture.ts';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function activity() {
  let state = 'active';
  const listeners = new Map<string, Set<(state: string) => void>>();
  const subscribe = (event: string, listener: (state: string) => void) => {
    const entries = listeners.get(event) ?? new Set(); entries.add(listener); listeners.set(event, entries);
    return () => entries.delete(listener);
  };
  const prompt = new DeviceUnlockPrompt({ state: () => state, subscribe(listener) {
    const remove = ['change', 'blur', 'focus'].map(event => subscribe(event, listener));
    return () => remove.forEach(release => release());
  } });
  return { prompt, get state() { return state; }, subscribe, emit(next: string) {
    if (next !== 'blur' && next !== 'focus') state = next;
    for (const listener of [...listeners.get(next === 'blur' || next === 'focus' ? next : 'change') ?? []]) listener(next);
  } };
}
function screen(owned = true, backend?: Awaited<ReturnType<typeof runtimeFixture>>) {
  const app = backend?.app ?? activity(), hold = Promise.withResolvers<void>();
  let current = true, deny = false, submitted = 0;
  let previewFinished = Promise.resolve(), previewError: unknown;
  let previewScope: authentication.NativePrivateAuthenticationScope | undefined, previewSignal: AbortSignal | undefined;
  let submissionScope: authentication.NativePrivateAuthenticationScope | undefined;
  const props = { imports: {
    async previewUtxo(_input: importedAccounts.NativeUtxoImportDraft, _context: number, _catalogue: number,
      signal: AbortSignal, scope: authentication.NativePrivateAuthenticationScope, check: () => void) {
      previewScope = scope; previewSignal = signal;
      if (backend) {
        const pending = backend.authority.previewUtxoImport(_input, backend.authority.getSnapshot().revision,
          backend.authority.getCatalogue()!.revision, signal, backend.bind(scope), check);
        previewFinished = pending.then(() => undefined, error => { previewError = error; });
        return pending;
      }
      const binding = authentication.bindNativePrivateAuthentication(scope, { assertCurrent() { if (!current || signal.aborted) throw Error('CANCELLED'); },
        isPromptActive: owner => app.prompt.isActive(owner) });
      return authentication.withNativePrivateAuthentication(binding, signal, () => { if (!current || signal.aborted) throw Error('CANCELLED'); },
        owner => app.prompt.run(owned ? owner : null, async () => { await hold.promise; if (deny) throw Error('CREDENTIAL_CANCELLED'); check(); return BITCOIN_WIF_ADDRESS; }));
    },
    async submit(_input: importedAccounts.NativeImportRequest, _context: number, _catalogue: number,
      signal: AbortSignal, scope: authentication.NativePrivateAuthenticationScope) {
      submissionScope = scope; assert.notEqual(scope, previewScope); assert(!signal.aborted); submitted++;
    }, cancel() {},
  }, contextRevision: 4, catalogueRevision: 8, networkLabel: 'Bitcoin', utxo: true,
    onImported() {}, onBack() {}, onSubmitStart() {}, onSubmitEnd() {} };
  const f = screenFixture(new URL('../src/screens/NativeImport.tsx', import.meta.url), 'NativeImport', {
    '../platform/localization': nativeTranslationFixture,
    '../custody/importedAccounts': importedAccounts,
    '../custody/privateAuthentication': authentication,
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption },
    '../core/operationAuthentication': { isOperationAuthenticationCancellation },
    '../core/utxoAddresses': { UTXO_IMPORT_LABELS, UTXO_IMPORT_TYPES },
    'react-native': { View: 'View', ActivityIndicator: 'ActivityIndicator', KeyboardAvoidingView: 'KeyboardAvoidingView',
      Platform: { OS: 'android' }, StyleSheet: { create: (value: unknown) => value }, Keyboard: { dismiss() {} },
      BackHandler: { addEventListener: () => ({ remove() {} }) }, AppState: { get currentState() { return app.state; },
        addEventListener(event: string, listener: (state: string) => void) { return { remove: app.subscribe(event, listener) }; } } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    './IdleActivityBoundary': { IdleTextInput: 'Input', IdlePressable: 'Pressable' },
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Header', 'Notice', 'Screen', 'Text'].map(name => [name, name])), styles: {}, colors: {} },
  }, { AbortController });
  const render = () => screenElements(f.render(props));
  const strings = languageMessages('en');
  const button = (title: string) => { const item = render().find(value => value.type === 'Button' && value.props.title === title); assert(item, title); return item; };
  const start = (privateKey = BITCOIN_WIF_KEY) => {
    render(); const inputs = render().filter(value => value.type === 'Input');
    inputs.find(value => value.props.accessibilityLabel === strings.mobile.accounts.accountName)!.props.onChangeText('Imported WIF');
    inputs.find(value => value.props.accessibilityLabel === strings.mobile.importAccount.utxoKey)!.props.onChangeText(privateKey);
    const legacy = render().find(value => value.props.accessibilityRole === 'radio' && value.children.some(child => (child as { children?: unknown[] })?.children?.includes(UTXO_IMPORT_LABELS.p2pkh)));
    assert(legacy); legacy.props.onPress(); button(strings.mobile.importAccount.review).props.onPress();
  };
  return { app, render, start, button, strings, release: () => hold.resolve(), deny: () => { deny = true; },
    revoke: () => { current = false; }, scope: () => previewScope, signal: () => previewSignal,
    finished: () => previewFinished, previewError: () => previewError,
    alerts: () => render().filter(value => value.props.accessibilityRole === 'alert').flatMap(value => value.children).join(' '),
    submitted: () => submitted, submissionScope: () => submissionScope, close: f.close };
}

test('WIF address review survives only its owned OS inactive/blur and retires its scope before separately authorized import', async () => {
  const f = screen();
  try {
    f.start(); await tick(); assert.equal(f.scope()?.isAuthenticating(), true);
    f.app.emit('inactive'); f.app.emit('blur');
    assert.equal(f.scope()?.isAuthenticating(), true);
    assert(f.render().some(value => value.type === 'Input' && value.props.value === BITCOIN_WIF_KEY));
    f.app.emit('active'); f.app.emit('focus'); f.release(); await tick();
    assert(f.render().some(value => value.children.includes(BITCOIN_WIF_ADDRESS)));
    assert.equal(f.scope()?.isAuthenticating(), false); assert.equal(f.signal()?.aborted, true);
    f.render().find(value => value.props.accessibilityRole === 'checkbox')!.props.onPress();
    await f.button(f.strings.mobile.importAccount.import).props.onPress();
    assert.equal(f.submitted(), 1); assert.notEqual(f.submissionScope(), f.scope());
  } finally { f.release(); f.close(); }
});

for (const end of ['deny', 'back', 'lock', 'background', 'foreign', 'unmount'] as const) test(`WIF review never publishes an address after ${end}`, async () => {
  const f = screen(end !== 'foreign'); let closed = false;
  try {
    f.start(); await tick();
    if (end === 'deny') f.deny();
    else if (end === 'back') f.render().find(value => value.type === 'Header')!.props.onBack();
    else if (end === 'lock') { f.revoke(); f.app.emit('inactive'); }
    else if (end === 'unmount') { f.close(); closed = true; }
    else f.app.emit(end === 'foreign' ? 'inactive' : 'background');
    f.app.emit('active'); f.app.emit('focus'); f.release(); await tick();
    assert.equal(f.scope()?.isAuthenticating(), false); assert.equal(f.signal()?.aborted, true);
    if (!closed) assert(!f.render().some(value => value.children.includes(BITCOIN_WIF_ADDRESS)));
    assert.equal(f.submitted(), 0);
  } finally { f.release(); if (!closed) f.close(); }
});

async function runtimeFixture() {
  const app = activity(), credential = createTestCredentialPort();
  const directory = await mkdtemp(join(tmpdir(), 'pali-utxo-preview-auth-'));
  const { connection } = nodeConnection(join(directory, 'wallet.sqlite'));
  const storage = await SqliteWalletStorage.open(connection, digest, INSTALLATION, true);
  let prompted = false, denial: Error | null = null, reads = 0;
  let hold = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  const factory = createKeyringRuntimeFactory({ isAuthenticationActive: owner => app.prompt.isActive(owner),
    credentialPort: { ...credential, async withSecret(reference, owner, consume) {
      if (!prompted) return credential.withSecret(reference, owner, consume);
      reads++;
      return app.prompt.run(owner.signal, async () => { entered.resolve(); await hold.promise;
        if (denial) throw denial;
        return credential.withSecret(reference, owner, consume); });
    } }, privacyServiceSettings: null, passkeys: null, slhExecution: null, readEvmRetirement: null,
    loadSdk: loadNativeKeyringSdk, ensureCryptoReady: async () => undefined, openStorage: async () => storage,
    utxoFetch: async () => { throw Error('Preview must not fetch'); },
    readUtxoBalance: async () => { throw Error('Preview must not read balances'); },
    readUtxoAccount: async () => { throw Error('Preview must not read accounts'); },
  });
  let runtime: KeyringRuntime | undefined;
  const authority = new NativeCustodyAuthority({ async open() { runtime = await factory.open() as KeyringRuntime; return runtime; } });
  await authority.initialize();
  await authority.importPhrase('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
  await authority.selectNetwork('bitcoin', authority.getSnapshot().revision, authority.getCatalogue()!.revision, () => {});
  prompted = true;
  // Match nativeFactory.bindOperationAuthentication: bind to the runtime and
  // its live catalogue, including its already-supported authenticating phase.
  const bind = (scope: authentication.NativePrivateAuthenticationScope) => {
    const selected = runtime!;
    return authentication.bindNativePrivateAuthentication(scope, {
      assertCurrent() { if (runtime !== selected || !selected.catalogue.getSnapshot()) throw Error('CANCELLED'); },
      isPromptActive: owner => app.prompt.isActive(owner),
    });
  };
  return { app, authority, storage, bind, reads: () => reads, entered: () => entered.promise, release: () => hold.resolve(),
    deny: (error: Error = Object.assign(Error('CREDENTIAL_CANCELLED'), { code: 'CREDENTIAL_CANCELLED' })) => { denial = error; }, next() { hold = Promise.withResolvers<void>(); entered = Promise.withResolvers<void>(); },
    async close() { hold.resolve(); await authority.dispose(); await storage.close().catch(() => undefined); await rm(directory, { recursive: true, force: true }); } };
}

for (const end of ['success', 'deny', 'abort', 'lock'] as const) test(`actual SDK WIF preview binds the exact OS prompt and cannot persist an import (${end})`, async () => {
  const f = await runtimeFixture(), scope = authentication.createNativePrivateAuthenticationScope(), abort = new AbortController();
  try {
    const before = await f.storage.recovery.readSnapshot(), catalogue = f.authority.getCatalogue();
    const binding = f.bind(scope);
    const check = () => { if (abort.signal.aborted || f.app.state !== 'active' && !allowsPrivateAuthenticationInterruption(scope, f.app.state)) throw Error('CANCELLED'); };
    const pending = f.authority.previewUtxoImport({ privateKey: BITCOIN_WIF_KEY, utxoAddressType: 'p2pkh' },
      f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, abort.signal, binding, check);
    const observed = pending.then(value => ({ value }), error => ({ error }));
    await f.entered(); assert.equal(scope.isAuthenticating(), true);
    f.app.emit('inactive'); f.app.emit('blur'); assert.equal(scope.isAuthenticating(), true);
    if (end === 'deny') f.deny(); else if (end === 'abort') abort.abort(); else if (end === 'lock') f.authority.lock();
    f.app.emit('active'); f.app.emit('focus'); f.release();
    const result = await observed;
    if (end === 'success') { assert('value' in result); assert.equal(result.value, BITCOIN_WIF_ADDRESS); }
    else assert('error' in result);
    assert.equal(scope.isAuthenticating(), false);
    assert.deepEqual((await f.storage.recovery.readSnapshot()).records, before.records);
    if (end !== 'lock') assert.equal(f.authority.getCatalogue(), catalogue);
    assert.equal(f.reads(), 1);
    scope.retire(); abort.abort();
    if (end === 'success') {
      const submitScope = authentication.createNativePrivateAuthenticationScope(), submitAbort = new AbortController();
      f.next();
      const submission = f.authority.importAccount({ privateKey: BITCOIN_WIF_KEY, utxoAddressType: 'p2pkh', label: 'Imported WIF', expectedAddress: BITCOIN_WIF_ADDRESS },
        f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, submitAbort.signal, f.bind(submitScope));
      await f.entered(); assert.equal(submitScope.isAuthenticating(), true); assert.equal(scope.isAuthenticating(), false);
      f.release(); await submission;
      assert.equal(f.reads(), 2); assert(f.authority.getCatalogue()!.accounts.some(account => account.address === BITCOIN_WIF_ADDRESS));
      submitScope.retire(); submitAbort.abort();
    }
  } finally { scope.retire(); abort.abort(); f.release(); await f.close(); }
});


test('real OS Cancel passes through WIF preview without claiming an invalid key or changing storage', async () => {
  const backend = await runtimeFixture(), view = screen(true, backend);
  try {
    const before = await backend.storage.recovery.readSnapshot(), catalogue = backend.authority.getCatalogue();
    view.start(); await backend.entered();
    assert.equal(view.scope()?.isAuthenticating(), true);
    const cancelled = operationAuthenticationCancellation();
    backend.deny(cancelled); backend.release(); await view.finished(); await tick();
    assert.equal(view.previewError(), cancelled);
    assert.equal(view.alerts(), '');
    assert(view.render().some(value => value.type === 'Input' && value.props.value === BITCOIN_WIF_KEY));
    assert.equal(view.button(view.strings.mobile.importAccount.review).props.disabled, false);
    assert(!view.render().some(value => value.children.includes(BITCOIN_WIF_ADDRESS)));
    assert.equal(view.signal()?.aborted, true); assert.equal(view.scope()?.isAuthenticating(), false);
    assert.equal(view.submitted(), 0); assert.equal(backend.authority.getCatalogue(), catalogue);
    assert.deepEqual((await backend.storage.recovery.readSnapshot()).records, before.records);
  } finally { view.close(); backend.release(); await backend.close(); }
});

for (const code of ['CREDENTIAL_UNSUPPORTED', 'CREDENTIAL_MISSING']) test(`WIF preview ${code} reports device authorization feedback, not invalid key`, async () => {
  const backend = await runtimeFixture(), view = screen(true, backend);
  try {
    const before = await backend.storage.recovery.readSnapshot();
    view.start(); await backend.entered(); backend.deny(Object.assign(Error(code), { code })); backend.release(); await view.finished(); await tick();
    assert.equal(view.alerts(), view.strings.mobile.walletViews.deviceAuthenticationUnavailable);
    assert.notEqual(view.alerts(), view.strings.mobile.importAccount.invalidUtxo);
    assert.equal(view.submitted(), 0);
    assert.deepEqual((await backend.storage.recovery.readSnapshot()).records, before.records);
  } finally { view.close(); backend.release(); await backend.close(); }
});

test('a malformed WIF still reports invalid-key feedback after a successful OS authorization', async () => {
  const backend = await runtimeFixture(), view = screen(true, backend);
  try {
    const before = await backend.storage.recovery.readSnapshot();
    view.start(BITCOIN_WIF_KEY.slice(0, -1) + '1'); await backend.entered(); backend.release(); await view.finished(); await tick();
    assert.equal((view.previewError() as { code: string }).code, 'INVALID_INPUT');
    assert.equal(view.alerts(), view.strings.mobile.importAccount.invalidUtxo);
    assert.equal(view.submitted(), 0);
    assert.deepEqual((await backend.storage.recovery.readSnapshot()).records, before.records);
  } finally { view.close(); backend.release(); await backend.close(); }
});


test('non-preview import keeps its existing typed cancellation and does not reuse the explicit preview marker', async () => {
  const f = await runtimeFixture(), scope = authentication.createNativePrivateAuthenticationScope(), abort = new AbortController();
  try {
    const before = await f.storage.recovery.readSnapshot(), catalogue = f.authority.getCatalogue();
    const marker = operationAuthenticationCancellation();
    const submission = f.authority.importAccount({ privateKey: BITCOIN_WIF_KEY, utxoAddressType: 'p2pkh', label: 'Imported WIF', expectedAddress: BITCOIN_WIF_ADDRESS },
      f.authority.getSnapshot().revision, catalogue!.revision, abort.signal, f.bind(scope));
    const rejected = assert.rejects(submission, (error: unknown) => {
      assert(error && typeof error === 'object' && 'code' in error && error.code === 'CANCELLED');
      assert.equal(isOperationAuthenticationCancellation(error), false);
      assert.notEqual(error, marker); return true;
    });
    await f.entered(); f.deny(marker); f.release(); await rejected;
    assert.equal(f.authority.getSnapshot().phase, 'ready');
    assert.equal(f.authority.getCatalogue(), catalogue);
    assert.deepEqual((await f.storage.recovery.readSnapshot()).records, before.records);
  } finally { scope.retire(); abort.abort(); f.release(); await f.close(); }
});
