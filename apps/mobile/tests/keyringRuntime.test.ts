import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createKeyringRuntimeFactory, type KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import type { OpenWalletStorage } from '../src/storage/types.ts';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'Only a public test password';
const ADDRESS = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
process.env.NODE_ENV = 'production';
delete process.env.SYSWEB3_PBKDF2_ENC_ITERS;
delete process.env.SYSWEB3_PBKDF2_AUTH_ITERS;

function memoryDisk() {
  const records = new Map<string, unknown>();
  let confirmation: string | undefined;
  let failures = 0;
  let failAcknowledgement = false;
  let networkCalls = 0;
  const originalFetch = globalThis.fetch;
  const fingerprint = () => createHash('sha256')
    .update(JSON.stringify([records.get('vault'), records.get('vault-keys')])).digest('hex');
  const open = async (): Promise<OpenWalletStorage> => ({
    keyringStorage: {
      async get(key) { return records.has(key) ? structuredClone(records.get(key)) : undefined; },
      async set(key, value) { records.set(key, structuredClone(value)); },
      async deleteItem(key) { records.delete(key); },
      async createManyIfAbsent(values) {
        if (Object.keys(values).some((key) => records.has(key))) return false;
        for (const [key, value] of Object.entries(values)) records.set(key, structuredClone(value));
        if (failAcknowledgement) { failAcknowledgement = false; throw new Error('simulated lost commit acknowledgment'); }
        return true;
      },
    },
    authGuard: {
      async checkAllowed() {},
      async recordFailure() { failures++; },
      async recordSuccess() { failures = 0; },
    },
    async readState() {
      const vault = records.has('vault');
      const keys = records.has('vault-keys');
      if (vault !== keys) throw new Error('partial fixture vault');
      return vault
        ? { presence: 'existing', backup: confirmation === fingerprint() ? 'confirmed' : 'unconfirmed' }
        : { presence: 'empty', backup: 'unconfirmed' };
    },
    async getWalletFingerprint() { assert.ok(records.has('vault')); return fingerprint(); },
    async confirmBackup(expected) { assert.equal(expected, fingerprint()); confirmation = expected; },
    async close() {},
  });
  const factory = createKeyringRuntimeFactory({ ensureCryptoReady: async () => {
    assert.ok(globalThis.crypto.subtle, 'Node supplies real WebCrypto for this control');
  }, openStorage: open });
  return {
    records, factory,
    get failures() { return failures; },
    loseNextAcknowledgement() { failAcknowledgement = true; },
    denyNetwork() {
      globalThis.fetch = async () => { networkCalls++; throw new Error('Network is forbidden in local custody'); };
    },
    restoreNetwork() { globalThis.fetch = originalFetch; assert.equal(networkCalls, 0); },
  };
}

test('real published software SDK imports, locks and cold-reopens at production KDF', async () => {
  const disk = memoryDisk(); disk.denyNetwork();
  const authority = new NativeCustodyAuthority(disk.factory);
  try {
    await authority.initialize();
    await authority.importPhrase(PHRASE, PASSWORD);
    assert.equal(authority.getSnapshot().phase, 'backup-required');
    assert.equal(authority.getSnapshot().account?.address, ADDRESS);
    const persisted = JSON.stringify([...disk.records]);
    assert.equal(persisted.includes(PHRASE), false);
    assert.equal(persisted.includes(PASSWORD), false);
    assert.deepEqual(disk.records.get('vault-keys') && Object.keys(disk.records.get('vault-keys') as object), ['salt']);
    await authority.dispose();
    const restarted = new NativeCustodyAuthority(disk.factory);
    await restarted.initialize();
    assert.equal(restarted.getSnapshot().phase, 'locked');
    await assert.rejects(restarted.unlock('wrong password'), /INVALID_CREDENTIAL/);
    assert.equal(disk.failures, 1);
    assert.equal(JSON.stringify([...disk.records]), persisted);
    await restarted.unlock(PASSWORD);
    assert.equal(disk.failures, 0);
    assert.equal(restarted.getSnapshot().account?.address, ADDRESS);
    restarted.lock();
    assert.equal(restarted.getSnapshot().account, null);
    await restarted.dispose();
  } finally { disk.restoreNetwork(); }
});

test('a committed vault with lost acknowledgment is reopened instead of overwritten', async () => {
  const disk = memoryDisk();
  const authority = new NativeCustodyAuthority(disk.factory);
  await authority.initialize();
  disk.loseNextAcknowledgement();
  await assert.rejects(authority.importPhrase(PHRASE, PASSWORD), /OPERATION_FAILED/);
  assert.equal(authority.getSnapshot().phase, 'locked');
  const committed = JSON.stringify([...disk.records]);
  await assert.rejects(authority.create(PASSWORD), /NOT_READY/);
  await authority.unlock(PASSWORD);
  assert.equal(authority.getSnapshot().account?.address, ADDRESS);
  assert.equal(JSON.stringify([...disk.records]), committed);
  await authority.dispose();
});

test('native qualification fails before storage or SDK loading', async () => {
  let opened = false;
  let loaded = false;
  const factory = createKeyringRuntimeFactory({
    async ensureCryptoReady() { throw new Error('provider unavailable'); },
    async openStorage() { opened = true; throw new Error('must not open'); },
    async loadSdk() { loaded = true; throw new Error('must not load'); },
  });
  await assert.rejects(factory.open());
  assert.equal(opened, false); assert.equal(loaded, false);
});

test('backup uses fresh SDK authentication and a wallet-bound storage receipt', async () => {
  const disk = memoryDisk();
  const runtime = await disk.factory.open() as KeyringRuntime;
  await runtime.session.importWallet(PHRASE, PASSWORD);
  await assert.rejects(runtime.backup.readPhrase('wrong password'), /INVALID_CREDENTIAL/);
  assert.equal(disk.failures, 1);
  assert.equal((await runtime.session.unlock(PASSWORD)).authenticated, true);
  const words = await runtime.backup.readPhrase(PASSWORD);
  assert.equal(words.join(' '), PHRASE);
  assert.equal(Object.isFrozen(words), true);
  const fingerprint = await runtime.backup.fingerprint();
  await runtime.backup.confirm(fingerprint);
  assert.deepEqual(await runtime.storage.readState(), { presence: 'existing', backup: 'confirmed' });
  await runtime.storage.close();
  await assert.rejects(runtime.session.unlock(PASSWORD), /CANCELLED/);
});
