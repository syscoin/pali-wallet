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
function screen(owned = true) {
  const app = activity(), hold = Promise.withResolvers<void>();
  let current = true, deny = false, submitted = 0;
  let previewScope: authentication.NativePrivateAuthenticationScope | undefined, previewSignal: AbortSignal | undefined;
  let submissionScope: authentication.NativePrivateAuthenticationScope | undefined;
  const props = { imports: {
    async previewUtxo(_input: importedAccounts.NativeUtxoImportDraft, _context: number, _catalogue: number,
      signal: AbortSignal, scope: authentication.NativePrivateAuthenticationScope, check: () => void) {
      previewScope = scope; previewSignal = signal;
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
  const start = () => {
    render(); const inputs = render().filter(value => value.type === 'Input');
    inputs.find(value => value.props.accessibilityLabel === strings.mobile.accounts.accountName)!.props.onChangeText('Imported WIF');
    inputs.find(value => value.props.accessibilityLabel === strings.mobile.importAccount.utxoKey)!.props.onChangeText(BITCOIN_WIF_KEY);
    const legacy = render().find(value => value.props.accessibilityRole === 'radio' && value.children.some(child => (child as { children?: unknown[] })?.children?.includes(UTXO_IMPORT_LABELS.p2pkh)));
    assert(legacy); legacy.props.onPress(); button(strings.mobile.importAccount.review).props.onPress();
  };
  return { app, render, start, button, strings, release: () => hold.resolve(), deny: () => { deny = true; },
    revoke: () => { current = false; }, scope: () => previewScope, signal: () => previewSignal,
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
  let prompted = false, deny = false, reads = 0;
  let hold = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  const factory = createKeyringRuntimeFactory({ isAuthenticationActive: owner => app.prompt.isActive(owner),
    credentialPort: { ...credential, async withSecret(reference, owner, consume) {
      if (!prompted) return credential.withSecret(reference, owner, consume);
      reads++;
      return app.prompt.run(owner.signal, async () => { entered.resolve(); await hold.promise;
        if (deny) throw Object.assign(Error('CREDENTIAL_CANCELLED'), { code: 'CREDENTIAL_CANCELLED' });
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
    deny: () => { deny = true; }, next() { hold = Promise.withResolvers<void>(); entered = Promise.withResolvers<void>(); },
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
