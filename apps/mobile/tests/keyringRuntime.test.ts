import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createKeyringRuntimeFactory, type KeyringRuntime, type KeyringRuntimeDependencies } from '../src/custody/keyringRuntime.ts';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import type { OpenWalletStorage } from '../src/storage/types.ts';
import { WalletStorageError } from '../src/storage/types.ts';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'Only a public test password';
const ADDRESS = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
process.env.NODE_ENV = 'production';
delete process.env.SYSWEB3_PBKDF2_ENC_ITERS;
delete process.env.SYSWEB3_PBKDF2_AUTH_ITERS;

function memoryDisk(loadSdk?: KeyringRuntimeDependencies['loadSdk']) {
  const records = new Map<string, unknown>();
  let confirmation: string | undefined;
  let failures = 0;
  let failureWrites = 0;
  let successWrites = 0;
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
      async checkAllowed() { if (failures >= 5) throw new WalletStorageError('AUTH_THROTTLED'); },
      async recordFailure() { failures++; failureWrites++; },
      async recordSuccess() { failures = 0; successWrites++; },
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
  }, openStorage: open, loadSdk });
  return {
    records, factory,
    get failures() { return failures; },
    get failureWrites() { return failureWrites; },
    get successWrites() { return successWrites; },
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

async function controlledSdk() {
  const sdk = await import('@sidhujag/sysweb3-keyring/cjs/software.js');
  let entered = () => {};
  let release = Promise.resolve();
  let holding = false;
  let unlockCalls = 0;
  let hydrations = 0;
  class ControlledKeyring extends sdk.SoftwareKeyring {
    constructor(host: ConstructorParameters<typeof sdk.SoftwareKeyring>[0]) {
      super(host);
      const hydrate = this.createFirstAccount;
      this.createFirstAccount = async (...args) => { hydrations++; return hydrate(...args); };
    }
    async unlock(password: string) {
      unlockCalls++;
      // Start the actual SDK KDF/decryption before yielding to the lifecycle
      // lock. No credential outcome or cryptographic primitive is replaced.
      const result = super.unlock(password);
      if (holding) { entered(); await release; }
      return result;
    }
  }
  return {
    loadSdk: async () => ({ ...sdk, SoftwareKeyring: ControlledKeyring }),
    get hydrations() { return hydrations; },
    get unlockCalls() { return unlockCalls; },
    hold() {
      holding = true;
      const started = new Promise<void>((resolve) => { entered = resolve; });
      let finish!: () => void;
      release = new Promise<void>((resolve) => { finish = resolve; });
      return { started, finish: () => { holding = false; finish(); } };
    },
  };
}

test('lifecycle cancellation still records each explicit wrong-password failure and reaches backoff', async () => {
  const controlled = await controlledSdk();
  const disk = memoryDisk(controlled.loadSdk);
  const runtime = await disk.factory.open();
  try {
    await runtime.session.importWallet(PHRASE, PASSWORD);
    await runtime.session.lock();
    const hydrated = controlled.hydrations;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const hold = controlled.hold();
      const pending = runtime.session.unlock('wrong password');
      await hold.started;
      await runtime.session.lock();
      hold.finish();
      await assert.rejects(pending, /CANCELLED/);
      assert.equal(disk.failures, attempt);
      assert.equal(disk.failureWrites, attempt);
      assert.equal(disk.successWrites, 0);
      assert.equal(controlled.hydrations, hydrated);
    }
    await assert.rejects(runtime.session.unlock(PASSWORD), /AUTH_THROTTLED/);
    assert.equal(controlled.unlockCalls, 5, 'backoff rejects before another SDK KDF');
    await assert.rejects(runtime.session.readEthereumAddress(), /NOT_READY/);
  } finally { await runtime.storage.close(); }
});

test('cancelled successful authentication neither clears failures nor hydrates an account', async () => {
  const controlled = await controlledSdk();
  const disk = memoryDisk(controlled.loadSdk);
  const runtime = await disk.factory.open();
  try {
    await runtime.session.importWallet(PHRASE, PASSWORD);
    await runtime.session.lock();
    assert.equal((await runtime.session.unlock('wrong password')).authenticated, false);
    assert.equal(disk.failures, 1);
    const hydrated = controlled.hydrations;
    const hold = controlled.hold();
    const pending = runtime.session.unlock(PASSWORD);
    await hold.started;
    await runtime.session.lock();
    hold.finish();
    await assert.rejects(pending, /CANCELLED/);
    assert.equal(disk.failures, 1);
    assert.equal(disk.failureWrites, 1);
    assert.equal(disk.successWrites, 0);
    assert.equal(controlled.hydrations, hydrated);
    await assert.rejects(runtime.session.readEthereumAddress(), /NOT_READY/);
  } finally { await runtime.storage.close(); }
});


test('native transfer port authenticates and signs through the actual shared SDK without network access', async () => {
  const disk = memoryDisk(); disk.denyNetwork();
  const runtime = await disk.factory.open() as KeyringRuntime;
  try {
    await runtime.session.importWallet(PHRASE, PASSWORD);
    const transfers = runtime.transfers; assert.ok(transfers);
    const transaction = { type: 2 as const, from: ADDRESS, to: '0x1111111111111111111111111111111111111111', chainId: '1', nonce: '0', value: '123', gasLimit: '21000', data: '0x', maxFeePerGas: '3', maxPriorityFeePerGas: '1' };
    const signed = await transfers.sign(transaction, PASSWORD, () => undefined);
    const { Transaction } = await import('ethers/transaction');
    const decoded = Transaction.from(signed.rawTransaction);
    assert.equal(decoded.from, ADDRESS); assert.equal(decoded.hash, signed.hash); assert.equal(decoded.value, 123n);
    const journal = await transfers.journal(() => undefined);
    assert.equal((await journal.saveSigned(signed.rawTransaction)).hash, signed.hash);
    assert.equal((await journal.transition(signed.hash, 'attempted')).phase, 'attempted');
    await assert.rejects(transfers.sign(transaction, 'wrong password', () => undefined), /INVALID_CREDENTIAL/);
    assert.equal(disk.failureWrites, 1);
    await assert.rejects(transfers.authorize(PASSWORD, () => undefined), /CANCELLED/);
    assert.equal((await runtime.session.unlock(PASSWORD)).authenticated, true);
    await transfers.authorize(PASSWORD, () => undefined);
    assert.equal((await (await transfers.journal(() => undefined)).load())?.rawTransaction, signed.rawTransaction);
  } finally { await runtime.storage.close(); disk.restoreNetwork(); }
});
