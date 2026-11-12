import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Wallet } from 'ethers/wallet';
import { createKeyringRuntimeFactory, type KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import { loadNativeKeyringSdk } from '../src/custody/keyringSdk.ts';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import { NATIVE_PUBLIC_SESSION_KEY } from '../src/custody/publicSession.ts';
import { WALLET_CATALOGUE_KEY, type NativeAccountRecord } from '../src/custody/walletCatalogue.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { createTestPrivateAuthentication } from './fixtures/privateAuthentication.ts';
import { createTestCredentialPort } from './fixtures/credential.ts';
import type { NativeCredentialOwner } from '../src/custody/credentialVault.ts';
import { operationAuthenticationCancellation } from '../src/core/operationAuthentication.ts';
import { bindNativePrivateAuthentication, createNativePrivateAuthenticationScope } from '../src/custody/privateAuthentication.ts';
import { digest, INSTALLATION, nodeConnection } from './storageHelpers.ts';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
async function fixture(beforeAuthorization?: (owner: NativeCredentialOwner) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-public-checkpoint-'));
  const filename = path.join(directory, 'wallet.sqlite');
  const sdk = await loadNativeKeyringSdk();
  let first = true, blockRoots = true, rootEntries = 0, restoreEntries = 0, authorizations = 0, secretReads = 0, secretConsumptions = 0, blockCredentials = true;
  let storage!: SqliteWalletStorage, runtime!: KeyringRuntime;
  const instances: InstanceType<typeof sdk.HostKeyring>[] = [];
  let afterPublicRead: () => Promise<void> = async () => undefined;
  const credentialPort = createTestCredentialPort();
  class ObservedKeyring extends sdk.HostKeyring {
    constructor(...args: ConstructorParameters<typeof sdk.HostKeyring>) {
      super(...args); instances.push(this);
      for (const name of ['withSecretOperation', 'unlock', 'getDecryptedMnemonic']) {
        const original = Reflect.get(this, name);
        if (typeof original !== 'function') continue;
        Reflect.set(this, name, (...params: unknown[]) => {
          rootEntries++; if (blockRoots) throw Error('TEST_ROOT_DECRYPTION_FORBIDDEN');
          return Reflect.apply(original, this, params);
        });
      }
      const restore = this.restorePublicSession.bind(this);
      Reflect.set(this, 'restorePublicSession', (...params: unknown[]) => { restoreEntries++; return Reflect.apply(restore, this, params); });
    }
  }
  const base = createKeyringRuntimeFactory({ isAuthenticationActive: () => false,
    credentialPort: { ...credentialPort, async authorize(input, owner) {
      authorizations++; await beforeAuthorization?.(owner); return credentialPort.authorize(input, owner);
    }, async readPublic(input, check) {
      const result = await credentialPort.readPublic(input, check); await afterPublicRead(); check(); return result;
    }, async withSecret(input, owner, consume) {
      secretReads++;
      if (blockCredentials) throw Error('TEST_SPENDING_CREDENTIAL_READ_FORBIDDEN');
      await beforeAuthorization?.(owner);
      return credentialPort.withSecret(input, owner, async secret => { secretConsumptions++; return consume(secret); });
    } },
    privacyServiceSettings: null, passkeys: null, slhExecution: null, readEvmRetirement: null,
    async ensureCryptoReady() { assert(globalThis.crypto?.subtle); },
    async openStorage() { storage = await SqliteWalletStorage.open(nodeConnection(filename).connection, digest, INSTALLATION, first); first = false; return storage; },
    loadSdk: async () => ({ ...sdk, HostKeyring: ObservedKeyring }),
  });
  const factory = { async open() { runtime = await base.open() as KeyringRuntime; return runtime; } };
  let authority = new NativeCustodyAuthority(factory);
  return {
    get authority() { return authority; }, get runtime() { return runtime; }, get storage() { return storage; }, instances,
    get rootEntries() { return rootEntries; }, get restoreEntries() { return restoreEntries; }, get authorizations() { return authorizations; },
    get secretReads() { return secretReads; }, get secretConsumptions() { return secretConsumptions; }, credentialPort,
    afterPublicRead(work: () => Promise<void>) { afterPublicRead = work; },
    allowCredentialReads() { blockCredentials = false; },
    allowSecrets() { blockRoots = false; blockCredentials = false; }, blockSecrets() { blockRoots = true; blockCredentials = true; rootEntries = 0; authorizations = 0; secretReads = 0; },
    async create() { await authority.initialize(); await authority.importPhrase(PHRASE); },
    async ready() { await runtime.backup.confirm(await runtime.backup.fingerprint()); await authority.refreshAuthenticatedMetadata(); },
    async reopen() { await authority.dispose(); authority = new NativeCustodyAuthority(factory); await authority.initialize(); },
    async close() { await authority.dispose().catch(() => undefined); await rm(directory, { recursive: true, force: true }); },
  };
}

test('actual native creation and cold public reopen never enter the live SDK root path', async () => {
  const f = await fixture();
  try {
    await f.create();
    assert.equal(f.authority.getSnapshot().phase, 'backup-required');
    assert.equal(f.rootEntries, 0); assert.equal(f.restoreEntries, 1);
    assert.equal(f.secretReads, 0);
    assert(await f.storage.keyringStorage.get(NATIVE_PUBLIC_SESSION_KEY));
    const address = f.authority.getSnapshot().account!.address;
    await f.reopen(); assert.equal(f.authority.getSnapshot().phase, 'backup-required');
    await f.authority.unlock();
    assert.equal(f.authority.getSnapshot().account!.address, address);
    assert.equal(f.rootEntries, 0); assert.equal(f.restoreEntries, 2);
    assert.equal(f.secretReads, 0);
    const ring = f.instances.at(-1)!;
    assert.equal(ring.hasPublicSession(), true); assert.equal(ring.isUnlocked(), false);
  } finally { await f.close(); }
});

for (const fault of ['missing', 'key'] as const) test(`actual native public unlock refuses ${fault} attestation without root fallback`, async () => {
  const f = await fixture();
  try {
    await f.create();
    if (fault === 'missing') await f.storage.keyringStorage.deleteItem(NATIVE_PUBLIC_SESSION_KEY);
    else {
      const record = await f.storage.keyringStorage.get(WALLET_CATALOGUE_KEY) as NativeAccountRecord;
      const changed = structuredClone(record); changed.groups[0]!.accounts.HDAccount[0]!.xprv += 'changed';
      await f.storage.keyringStorage.set(WALLET_CATALOGUE_KEY, changed);
    }
    await assert.rejects(f.reopen());
    assert.equal(f.rootEntries, 0); assert.equal(f.authority.getSnapshot().account, null);
    assert.equal(f.secretReads, 0);
  } finally { await f.close(); }
});

test('one authorized native account creation atomically refreshes its checkpoint before public-only reopen', async () => {
  const f = await fixture();
  try {
    await f.create(); await f.ready(); f.allowSecrets();
    const before = await f.storage.keyringStorage.get(NATIVE_PUBLIC_SESSION_KEY);
    await f.authority.manageAccounts({ kind: 'create', label: 'Second' }, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
    assert.equal(f.authorizations, 0); assert.equal(f.authority.getCatalogue()!.accounts.length, 2);
    assert.equal(f.secretReads, 1);
    assert.notDeepEqual(await f.storage.keyringStorage.get(NATIVE_PUBLIC_SESSION_KEY), before);
    f.blockSecrets(); await f.reopen(); await f.authority.unlock();
    assert.equal(f.rootEntries, 0); assert.equal(f.authority.getCatalogue()!.accounts.length, 2);
    assert.equal(f.secretReads, 0);
  } finally { await f.close(); }
});

test('first native UTXO account setup uses one authorization and survives public-only reopen', async () => {
  const f = await fixture();
  try {
    await f.create(); await f.ready(); f.allowSecrets();
    await f.authority.selectNetwork('syscoin', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, () => undefined);
    assert.equal(f.authorizations, 0); assert.equal(f.secretReads, 1);
    const address = f.authority.getSnapshot().account!.address;
    f.blockSecrets(); await f.reopen(); await f.authority.unlock();
    assert.equal(f.rootEntries, 0); assert.equal(f.authority.getSnapshot().account!.address, address);
    assert.equal(f.authority.getSnapshot().account!.network, 'syscoin');
  } finally { await f.close(); }
});


test('warm public reopen preserves the exact public catalogue without entering the root path', async () => {
  const f = await fixture();
  try {
    await f.create();
    const snapshot = f.runtime.catalogue.getSnapshot(), restores = f.restoreEntries;
    await f.runtime.session.unlock();
    assert.equal(f.rootEntries, 0);
    assert.equal(f.secretReads, 0);
    assert.equal(f.restoreEntries, restores);
    assert.equal(f.runtime.catalogue.getSnapshot(), snapshot);
    assert.equal(f.instances.at(-1)!.isUnlocked(), false);
  } finally { await f.close(); }
});

test('idle-policy approval uses the protected authorization key without reading a secret or SDK root', async () => {
  let requests = 0;
  const f = await fixture(async owner => { requests++; assert.equal(owner.purpose, 'account-change'); assert.equal(owner.signal.aborted, false); owner.assertCurrent(); });
  try {
    await f.create(); await f.ready(); f.allowCredentialReads();
    const before = f.runtime.catalogue.getSnapshot(), restores = f.restoreEntries;
    await f.runtime.security!.reauthenticateIdlePolicy(new AbortController().signal, createTestPrivateAuthentication(() => undefined), () => undefined);
    assert.equal(requests, 1); assert.equal(f.authorizations, 1); assert.equal(f.secretReads, 0);
    assert.equal(f.runtime.catalogue.getSnapshot(), before); assert.equal(f.restoreEntries, restores);
    assert.equal(f.rootEntries, 0, 'settings must not decrypt the SDK root');
    assert.equal(f.instances.at(-1)!.hasPublicSession(), true); assert.equal(f.instances.at(-1)!.isUnlocked(), false);
  } finally { await f.close(); }
});

for (const ending of ['cancel', 'abort'] as const) test(`idle-policy protected credential ${ending} preserves public state only for authentic cancellation`, async () => {
  const shown = Promise.withResolvers<NativeCredentialOwner>(), response = Promise.withResolvers<void>();
  const f = await fixture(async owner => { shown.resolve(owner); await response.promise; });
  try {
    await f.create(); await f.ready(); f.allowCredentialReads();
    const before = f.runtime.catalogue.getSnapshot(), owner = new AbortController();
    const work = f.runtime.security!.reauthenticateIdlePolicy(owner.signal, createTestPrivateAuthentication(() => undefined), () => undefined);
    const rejected = assert.rejects(work, error => { assert.equal(f.runtime.security!.isAuthenticationRefusal(error), ending === 'cancel'); return true; });
    await shown.promise;
    if (ending === 'cancel') response.reject(operationAuthenticationCancellation()); else { owner.abort(); response.resolve(); }
    await rejected;
    assert.equal(f.runtime.catalogue.getSnapshot(), ending === 'cancel' ? before : null);
    assert.equal(f.instances.at(-1)!.hasPublicSession(), ending === 'cancel');
    assert.equal(f.rootEntries, 0); assert.equal(f.secretReads, 0);
  } finally { response.resolve(); await f.close(); }
});

for (const marker of ['owned', 'other', 'missing'] as const) test(`idle-policy inactive guard ${marker === 'owned' ? 'accepts its owned' : `rejects a ${marker}`} OS prompt marker without recursion`, async () => {
  let state = 'active', currentPrompt: AbortSignal | null = null, checks = 0;
  const scope = createNativePrivateAuthenticationScope();
  const other = new AbortController();
  const binding = bindNativePrivateAuthentication(scope, {
    assertCurrent() {},
    isPromptActive: owner => marker === 'owned' ? owner === currentPrompt : marker === 'other' && owner === other.signal,
  });
  const check = () => {
    assert(++checks < 100, 'The screen guard must not recursively re-enter itself');
    if (state !== 'active' && !(state === 'inactive' && scope.isAuthenticating())) throw Error('CANCELLED');
  };
  const f = await fixture(async owner => {
    currentPrompt = owner.signal; state = 'inactive';
    try { owner.assertCurrent(); } finally { state = 'active'; currentPrompt = null; }
  });
  try {
    await f.create(); await f.ready(); f.allowCredentialReads();
    const before = f.runtime.catalogue.getSnapshot();
    const pending = f.runtime.security!.reauthenticateIdlePolicy(new AbortController().signal, binding, check);
    if (marker === 'owned') {
      await pending;
      assert.equal(f.runtime.catalogue.getSnapshot(), before);
      assert.equal(f.instances.at(-1)!.hasPublicSession(), true);
    } else {
      await assert.rejects(pending);
      assert.equal(f.runtime.catalogue.getSnapshot(), null);
      assert.equal(f.instances.at(-1)!.hasPublicSession(), false);
    }
    assert(checks < 100); assert.equal(f.rootEntries, 0); assert.equal(f.secretReads, 0);
  } finally { scope.retire(); await f.close(); }
});

test('a refused protected read leaves public reopen usable without exposing the SDK root', async () => {
  const f = await fixture();
  try {
    await f.create(); f.allowSecrets();
    f.credentialPort.refuseNext(operationAuthenticationCancellation());
    await assert.rejects(f.runtime.backup.readPhrase({ method: 'device' }));
    assert.equal(f.secretConsumptions, 0); assert.equal(f.secretReads, 1);
    assert.equal(f.instances.at(-1)!.isUnlocked(), false);
    f.blockSecrets(); await f.reopen();
    assert.equal(f.authority.getSnapshot().phase, 'backup-required');
    assert.equal(f.secretReads, 0); assert.equal(f.rootEntries, 0);
    assert.equal(f.instances.at(-1)!.isUnlocked(), false);
  } finally { await f.close(); }
});

test('explicit seed reveal retrieves a fresh spending credential and retires SDK secrets each time', async () => {
  const f = await fixture();
  try {
    await f.create(); f.allowSecrets();
    for (const expectedReads of [1, 2]) {
      assert.equal((await f.runtime.backup.readPhrase({ method: 'device' })).join(' '), PHRASE);
      assert.equal(f.secretReads, expectedReads);
      const ring = f.instances.at(-1)!;
      assert.equal(ring.isUnlocked(), false);
      assert.equal(ring.hasPublicSession(), true);
      assert.equal((ring as any).sessionPassword, null);
      assert.equal((ring as any).sessionMnemonic, null);
    }
    assert(f.rootEntries > 0);
    f.blockSecrets();
    assert.equal((await f.runtime.session.unlock()).authenticated, true);
    assert.equal(f.secretReads, 0); assert.equal(f.rootEntries, 0);
  } finally { await f.close(); }
});

test('lock during checkpoint credential access denies late public publication and root access', { timeout: 15000 }, async () => {
  const f = await fixture();
  let release: () => void = () => undefined;
  try {
    await f.create(); f.authority.lock();
    let entered!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    f.afterPublicRead(async () => { entered(); await held; });
    const pending = f.authority.unlock(); void pending.catch(() => undefined);
    await reached; f.authority.lock(); release();
    await assert.rejects(pending, { code: 'CANCELLED' });
    assert.equal(f.rootEntries, 0);
    assert.equal(f.secretReads, 0);
    assert.equal(f.authority.getSnapshot().phase, 'locked');
    assert.equal(f.runtime.catalogue.getSnapshot(), null);
    assert.equal(f.instances.at(-1)!.hasPublicSession(), false);
    f.afterPublicRead(async () => undefined);
    await f.authority.unlock();
    assert.equal(f.rootEntries, 0);
    assert.equal(f.secretReads, 0);
  } finally { release(); await f.close(); }
});

test('one imported-key authorization refreshes the checkpoint and exact account before public-only reopen', async () => {
  const f = await fixture();
  try {
    await f.create(); await f.ready(); f.allowSecrets();
    const wallet = new Wallet('0x' + '31'.repeat(32));
    await f.authority.importAccount({ privateKey: wallet.privateKey, expectedAddress: wallet.address, label: 'Imported' },
      f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision,
      new AbortController().signal, createTestPrivateAuthentication(() => undefined));
    assert.equal(f.authorizations, 0); assert.equal(f.secretReads, 1);
    assert.equal(f.authority.getSnapshot().account!.address, wallet.address);
    f.blockSecrets(); await f.reopen(); await f.authority.unlock();
    assert.equal(f.rootEntries, 0);
    assert.equal(f.authority.getSnapshot().account!.address, wallet.address);
    assert.equal(f.authority.getCatalogue()!.accounts.length, 2);
  } finally { await f.close(); }
});

test('account removal refreshes the checkpoint atomically before public-only reopen', async () => {
  const f = await fixture();
  try {
    await f.create(); await f.ready(); f.allowSecrets();
    await f.authority.manageAccounts({ kind: 'create', label: 'Second' }, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
    const removed = f.authority.getCatalogue()!.active.accountId;
    await f.authority.manageAccounts({ kind: 'select', id: 'hd:60:0' }, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
    f.blockSecrets(); f.allowSecrets();
    await f.authority.manageAccounts({ kind: 'remove', id: removed }, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
    assert.equal(f.authorizations, 0); assert.equal(f.secretReads, 1);
    f.blockSecrets(); await f.reopen(); await f.authority.unlock();
    assert.equal(f.rootEntries, 0);
    assert.deepEqual(f.authority.getCatalogue()!.accounts.map(account => account.id), ['hd:60:0']);
  } finally { await f.close(); }
});

for (const backedUp of [false, true]) test(`public-only EVM network selection preserves account without spending material (backed up: ${backedUp})`, async () => {
  const f = await fixture();
  try {
    await f.create(); if (backedUp) await f.ready(); f.blockSecrets();
    const address = f.authority.getSnapshot().account!.address;
    if (!backedUp) await assert.rejects(f.authority.manageAccounts(
      { kind: 'create', label: 'Not admitted' }, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision
    ), /NOT_READY/);
    for (const networkId of ['base', 'arbitrum', 'rollux', 'syscoin-nevm-testnet', 'zksys-testnet', 'syscoin-nevm', 'ethereum']) {
      const state = f.authority.getSnapshot(), catalogue = f.authority.getCatalogue()!;
      await f.authority.selectNetwork(networkId, state.revision, catalogue.revision, () => undefined);
      assert.equal(f.authority.getSnapshot().phase, backedUp ? 'ready' : 'backup-required');
      assert.equal(f.authority.getSnapshot().account!.network, networkId);
      assert.equal(f.authority.getSnapshot().account!.address, address);
      assert.equal(f.rootEntries, 0); assert.equal(f.secretReads, 0);
    }
  } finally { await f.close(); }
});
