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
import { createDeviceUnlockCredentialStore } from '../src/storage/deviceUnlockCredential.ts';
import { createTestPrivateAuthentication } from './fixtures/privateAuthentication.ts';
import { createTestPinCredentialPort } from './fixtures/pinCredential.ts';
import { digest, INSTALLATION, nodeConnection } from './storageHelpers.ts';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PIN = '123456';
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-public-checkpoint-'));
  const filename = path.join(directory, 'wallet.sqlite');
  const sdk = await loadNativeKeyringSdk();
  let first = true, blockRoots = true, rootEntries = 0, restoreEntries = 0, authorizations = 0, secretReads = 0, biometricReads = 0;
  let storage!: SqliteWalletStorage, runtime!: KeyringRuntime;
  const instances: InstanceType<typeof sdk.HostKeyring>[] = [];
  let afterPinRead: () => Promise<void> = async () => undefined;
  let nextEnrollment = 0;
  const pinCredential = createTestPinCredentialPort();
  const protectedItems = new Map<string, string>();
  const credentials = createDeviceUnlockCredentialStore({
    async available() { return true; },
    async read(name) { biometricReads++; return protectedItems.get(name) ?? null; },
    async write(name, value) { protectedItems.set(name, value); },
    async remove(name) { protectedItems.delete(name); },
  });
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
  const base = createKeyringRuntimeFactory({
    pinCredential: { ...pinCredential, async readPublic(input, check) {
      const result = await pinCredential.readPublic(input, check); await afterPinRead(); check(); return result;
    }, async readSecret(input, check) {
      secretReads++;
      if (blockRoots) throw Error('TEST_SPENDING_CREDENTIAL_READ_FORBIDDEN');
      return pinCredential.readSecret(input, check);
    } },
    deviceUnlock: { credentials, randomId: () => (++nextEnrollment).toString(16).padStart(32, '0') },
    privacyServiceSettings: null, slhExecution: null, readEvmRetirement: null,
    async ensureCryptoReady() { assert(globalThis.crypto?.subtle); },
    async openStorage() { storage = await SqliteWalletStorage.open(nodeConnection(filename).connection, digest, INSTALLATION, first); first = false; return storage; },
    loadSdk: async () => ({ ...sdk, HostKeyring: ObservedKeyring }),
    async requestOperationCredential(_request, signal, check, verify) {
      authorizations++; assert(!signal.aborted); check();
      const result = await verify({ method: 'pin', pin: PIN }, check); assert.equal(result.accepted, true);
    },
  });
  const factory = { async open() { runtime = await base.open() as KeyringRuntime; return runtime; } };
  let authority = new NativeCustodyAuthority(factory);
  return {
    get authority() { return authority; }, get runtime() { return runtime; }, get storage() { return storage; }, instances,
    get rootEntries() { return rootEntries; }, get restoreEntries() { return restoreEntries; }, get authorizations() { return authorizations; },
    get secretReads() { return secretReads; }, get biometricReads() { return biometricReads; },
    afterPinRead(work: () => Promise<void>) { afterPinRead = work; },
    allowSecrets() { blockRoots = false; }, blockSecrets() { blockRoots = true; rootEntries = 0; authorizations = 0; secretReads = 0; },
    async create() { await authority.initialize(); await authority.importPhrase(PHRASE, PIN); },
    async ready() { await runtime.backup.confirm(await runtime.backup.fingerprint()); await authority.refreshAuthenticatedMetadata(); },
    async reopen() { await authority.dispose(); authority = new NativeCustodyAuthority(factory); await authority.initialize(); },
    async close() { await authority.dispose().catch(() => undefined); await rm(directory, { recursive: true, force: true }); },
  };
}

test('actual native creation and cold PIN view unlock never enter the live SDK root path', async () => {
  const f = await fixture();
  try {
    await f.create();
    assert.equal(f.authority.getSnapshot().phase, 'backup-required');
    assert.equal(f.rootEntries, 0); assert.equal(f.restoreEntries, 1);
    assert.equal(f.secretReads, 0);
    assert(await f.storage.keyringStorage.get(NATIVE_PUBLIC_SESSION_KEY));
    const address = f.authority.getSnapshot().account!.address;
    await f.reopen(); assert.equal(f.authority.getSnapshot().phase, 'locked');
    await f.authority.unlock(PIN);
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
    await f.reopen();
    await assert.rejects(f.authority.unlock(PIN));
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
    assert.equal(f.authorizations, 1); assert.equal(f.authority.getCatalogue()!.accounts.length, 2);
    assert.equal(f.secretReads, 1);
    assert.notDeepEqual(await f.storage.keyringStorage.get(NATIVE_PUBLIC_SESSION_KEY), before);
    f.blockSecrets(); await f.reopen(); await f.authority.unlock(PIN);
    assert.equal(f.rootEntries, 0); assert.equal(f.authority.getCatalogue()!.accounts.length, 2);
    assert.equal(f.secretReads, 0);
  } finally { await f.close(); }
});

test('first native UTXO account setup uses one authorization and survives public-only reopen', async () => {
  const f = await fixture();
  try {
    await f.create(); await f.ready(); f.allowSecrets();
    await f.authority.selectNetwork('syscoin', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision, () => undefined);
    assert.equal(f.authorizations, 1);
    const address = f.authority.getSnapshot().account!.address;
    f.blockSecrets(); await f.reopen(); await f.authority.unlock(PIN);
    assert.equal(f.rootEntries, 0); assert.equal(f.authority.getSnapshot().account!.address, address);
    assert.equal(f.authority.getSnapshot().account!.network, 'syscoin');
  } finally { await f.close(); }
});


test('warm PIN view authentication preserves the exact public catalogue without entering the root path', async () => {
  const f = await fixture();
  try {
    await f.create();
    const snapshot = f.runtime.catalogue.getSnapshot(), restores = f.restoreEntries;
    await f.runtime.session.unlock(PIN);
    await f.runtime.security!.reauthenticateIdlePolicy(PIN, () => undefined);
    await f.runtime.security!.authenticateOperation({ method: 'pin', pin: PIN }, () => undefined);
    assert.equal(f.rootEntries, 0);
    assert.equal(f.secretReads, 0);
    assert.equal(f.restoreEntries, restores);
    assert.equal(f.runtime.catalogue.getSnapshot(), snapshot);
    assert.equal(f.instances.at(-1)!.isUnlocked(), false);
  } finally { await f.close(); }
});

test('wrong cold and warm ordinary PINs never retrieve the spending credential', async () => {
  const f = await fixture();
  try {
    await f.create();
    const catalogue = f.runtime.catalogue.getSnapshot();
    const refused = await f.runtime.session.unlock('000000');
    assert.equal(refused.authenticated, false);
    assert.equal(f.runtime.catalogue.getSnapshot(), catalogue);
    assert.equal(f.secretReads, 0); assert.equal(f.rootEntries, 0);
    await f.reopen();
    await assert.rejects(f.authority.unlock('000000'), { code: 'INVALID_CREDENTIAL' });
    assert.equal(f.authority.getSnapshot().phase, 'locked');
    assert.equal(f.secretReads, 0); assert.equal(f.rootEntries, 0);
    await f.authority.unlock(PIN);
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
      assert.equal((await f.runtime.backup.readPhrase(PIN)).join(' '), PHRASE);
      assert.equal(f.secretReads, expectedReads);
      const ring = f.instances.at(-1)!;
      assert.equal(ring.isUnlocked(), false);
      assert.equal(ring.hasPublicSession(), true);
      assert.equal((ring as any).sessionPassword, null);
      assert.equal((ring as any).sessionMnemonic, null);
    }
    assert(f.rootEntries > 0);
    f.blockSecrets();
    assert.equal((await f.runtime.session.unlock(PIN)).authenticated, true);
    assert.equal(f.secretReads, 0); assert.equal(f.rootEntries, 0);
  } finally { await f.close(); }
});

test('cold biometric view unlock authenticates the same checkpoint without entering the root path', async () => {
  const f = await fixture();
  try {
    await f.create();
    await f.authority.setDeviceUnlock(true, PIN, () => undefined);
    assert.equal(f.secretReads, 0); assert.equal(f.rootEntries, 0);
    assert(f.biometricReads > 0);
    const address = f.authority.getSnapshot().account!.address;
    await f.runtime.security!.authenticateOperation({ method: 'biometric' }, () => undefined);
    await assert.rejects(f.authority.setDeviceUnlock(true, '000000', () => undefined), { code: 'INVALID_CREDENTIAL' });
    assert.equal(f.secretReads, 0); assert.equal(f.rootEntries, 0);
    f.blockSecrets(); await f.reopen();
    const biometricReads = f.biometricReads;
    await f.authority.unlockWithDevice(() => undefined);
    assert.equal(f.rootEntries, 0);
    assert.equal(f.secretReads, 0);
    assert(f.biometricReads > biometricReads);
    assert.equal(f.authority.getSnapshot().account!.address, address);
    assert.equal(f.instances.at(-1)!.hasPublicSession(), true);
    assert.equal(f.instances.at(-1)!.isUnlocked(), false);
  } finally { await f.close(); }
});

test('lock during checkpoint credential access denies late public publication and root access', { timeout: 15000 }, async () => {
  const f = await fixture();
  let release: () => void = () => undefined;
  try {
    await f.create(); await f.reopen();
    let entered!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    f.afterPinRead(async () => { entered(); await held; });
    const pending = f.authority.unlock(PIN); void pending.catch(() => undefined);
    await reached; f.authority.lock(); release();
    await assert.rejects(pending, { code: 'CANCELLED' });
    assert.equal(f.rootEntries, 0);
    assert.equal(f.secretReads, 0);
    assert.equal(f.authority.getSnapshot().phase, 'locked');
    assert.equal(f.runtime.catalogue.getSnapshot(), null);
    assert.equal(f.instances.at(-1)!.hasPublicSession(), false);
    f.afterPinRead(async () => undefined);
    await f.authority.unlock(PIN);
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
    assert.equal(f.authorizations, 1);
    assert.equal(f.authority.getSnapshot().account!.address, wallet.address);
    f.blockSecrets(); await f.reopen(); await f.authority.unlock(PIN);
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
    assert.equal(f.authorizations, 1);
    f.blockSecrets(); await f.reopen(); await f.authority.unlock(PIN);
    assert.equal(f.rootEntries, 0);
    assert.deepEqual(f.authority.getCatalogue()!.accounts.map(account => account.id), ['hd:60:0']);
  } finally { await f.close(); }
});
