import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import { createKeyringRuntimeFactory, type KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { createDeviceUnlockCredentialStore } from '../src/storage/deviceUnlockCredential.ts';
import { digest, INSTALLATION, nodeConnection } from './storageHelpers.ts';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'Public device unlock fixture 1!';
process.env.NODE_ENV = 'production';
delete process.env.SYSWEB3_PBKDF2_ENC_ITERS;
delete process.env.SYSWEB3_PBKDF2_AUTH_ITERS;

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-device-unlock-test-'));
  const file = path.join(directory, 'wallet.sqlite');
  const protectedItems = new Map<string, string>();
  let initialized = false, nextId = 1;
  let afterRead: () => Promise<void> = async () => undefined;
  let store!: SqliteWalletStorage, runtime!: KeyringRuntime;
  const credentials = createDeviceUnlockCredentialStore({
    async available() { return true; },
    async read(name) { const result = protectedItems.get(name) ?? null; await afterRead(); return result; },
    async write(name, value) { protectedItems.set(name, value); },
    async remove(name) { protectedItems.delete(name); },
  });
  const factory = createKeyringRuntimeFactory({
    ensureCryptoReady: async () => undefined, readEvmRetirement: null,
    async openStorage() {
      store = await SqliteWalletStorage.open(nodeConnection(file).connection, digest, INSTALLATION, !initialized);
      initialized = true;
      return store;
    },
    deviceUnlock: { credentials, randomId: () => (nextId++).toString(16).padStart(32, '0') },
  });
  const open = async () => {
    const owner = new NativeCustodyAuthority({ async open() { runtime = await factory.open() as KeyringRuntime; return runtime; } });
    await owner.initialize();
    return owner;
  };
  let owner = await open();
  await owner.importPhrase(PHRASE, PASSWORD);
  return {
    get owner() { return owner; }, get runtime() { return runtime; }, get store() { return store; }, protectedItems,
    afterRead(operation: () => Promise<void>) { afterRead = operation; },
    async reopen() { await owner.dispose(); owner = await open(); },
    async close() { await owner.dispose(); await rm(directory, { recursive: true, force: true }); },
  };
}

test('published SDK device unlock survives cold reopen and keeps backup gating and password fallback', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await f.owner.getDeviceUnlockStatus(), { available: true, enabled: false });
    await f.owner.setDeviceUnlock(true, PASSWORD, () => undefined);
    assert.equal(f.owner.getSnapshot().phase, 'backup-required');
    assert.equal((await f.owner.getDeviceUnlockStatus())?.enabled, true);
    assert.equal(f.protectedItems.size, 1);
    for (const value of f.protectedItems.values()) {
      assert.equal(value.includes(PASSWORD), false);
      assert.equal(value.includes(PHRASE), false);
    }
    await f.reopen();
    assert.equal(f.owner.getSnapshot().phase, 'locked');
    await f.owner.unlockWithDevice(() => undefined);
    assert.equal(f.owner.getSnapshot().phase, 'backup-required');
    assert.equal(f.owner.getCatalogue()?.accounts.length, 1);
    await f.owner.setDeviceUnlock(false, PASSWORD, () => undefined);
    assert.equal((await f.owner.getDeviceUnlockStatus())?.enabled, false);
    assert.equal(f.protectedItems.size, 0);
    f.owner.lock();
    await f.owner.unlock(PASSWORD);
    assert.equal(f.owner.getSnapshot().phase, 'backup-required');
  } finally { await f.close(); }
});

test('a missing or cancelled credential keeps the wallet locked and permits password unlock', async () => {
  const f = await fixture();
  try {
    await f.owner.setDeviceUnlock(true, PASSWORD, () => undefined);
    f.protectedItems.clear();
    f.owner.lock();
    await assert.rejects(f.owner.unlockWithDevice(() => undefined), { code: 'DEVICE_UNLOCK_UNAVAILABLE' });
    assert.equal(f.owner.getSnapshot().phase, 'locked');
    await f.owner.unlock(PASSWORD);
    assert.equal(f.owner.getSnapshot().phase, 'backup-required');
  } finally { await f.close(); }
});

test('lock during native credential access discards the result before SDK session publication', async () => {
  const f = await fixture();
  try {
    await f.owner.setDeviceUnlock(true, PASSWORD, () => undefined);
    f.owner.lock();
    let enter!: () => void, finish!: () => void;
    const reached = new Promise<void>(resolve => { enter = resolve; });
    const held = new Promise<void>(resolve => { finish = resolve; });
    f.afterRead(async () => { enter(); await held; });
    const attempt = f.owner.unlockWithDevice(() => undefined);
    await reached;
    f.owner.lock(); finish();
    await assert.rejects(attempt, { code: 'CANCELLED' });
    assert.equal(f.owner.getSnapshot().phase, 'locked');
    assert.equal(f.runtime.catalogue.getSnapshot(), null);
    f.afterRead(async () => undefined);
    await f.owner.unlock(PASSWORD);
    assert.equal(f.owner.getSnapshot().phase, 'backup-required');
  } finally { await f.close(); }
});

test('enrollment requires the actual password and retains the original enrollment after refusal', async () => {
  const f = await fixture();
  try {
    await f.owner.setDeviceUnlock(true, PASSWORD, () => undefined);
    const original = await f.store.deviceUnlockEnrollment.read();
    await assert.rejects(f.owner.setDeviceUnlock(true, 'Incorrect password 1!', () => undefined), { code: 'INVALID_CREDENTIAL' });
    assert.equal(f.owner.getSnapshot().phase, 'locked');
    assert.deepEqual(await f.store.deviceUnlockEnrollment.read(), original);
    assert.equal(f.protectedItems.size, 1);
    await f.owner.unlockWithDevice(() => undefined);
    assert.equal(f.owner.getSnapshot().phase, 'backup-required');
  } finally { await f.close(); }
});
