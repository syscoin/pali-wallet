import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createKeyringRuntimeFactory, type KeyringRuntime, type KeyringRuntimeDependencies } from '../src/custody/keyringRuntime.ts';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import type { OpenWalletStorage } from '../src/storage/types.ts';
import { WalletStorageError } from '../src/storage/types.ts';
import { NativeTransfers } from '../src/custody/transfers.ts';
import { NativeTransferRpc } from '../src/custody/transferRpc.ts';
import { SeedBackupFlow } from '../src/custody/seedBackup.ts';
import { keccak256, SigningKey } from 'ethers/crypto';
import { Transaction } from 'ethers/transaction';
import { HDNodeWallet } from 'ethers/wallet';
import { getNativeNetwork, NATIVE_NETWORKS } from '../src/custody/networkContext.ts';
import { WALLET_CATALOGUE_KEY } from '../src/custody/walletCatalogue.ts';

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
  let failCatalogueAcknowledgement = false;
  let failCasAcknowledgement = false;
  let closes = 0;
  let networkCalls = 0;
  let recordHook: ((kind: string, key: string) => Promise<void>) | undefined;
  const originalFetch = globalThis.fetch;
  const fingerprint = () => createHash('sha256')
    .update(JSON.stringify([records.get('vault'), records.get('vault-keys')])).digest('hex');
  const open = async (): Promise<OpenWalletStorage> => ({
    keyringStorage: {
      async compareAndSet(key, expected, value, removals = {}) {
        if (!records.has(key) || JSON.stringify(records.get(key)) !== JSON.stringify(expected)) return false;
        if (Object.entries(removals).some(([name, before]) => JSON.stringify(records.get(name)) !== JSON.stringify(before))) return false;
        records.set(key, structuredClone(value));
        for (const name of Object.keys(removals)) records.delete(name);
        if (failCasAcknowledgement) { failCasAcknowledgement = false; throw Error('Lost CAS acknowledgement'); }
        return true;
      },
      async get(key) { const value = records.has(key) ? structuredClone(records.get(key)) : undefined; await recordHook?.('get', key); return value; },
      async set(key, value) { records.set(key, structuredClone(value)); },
      async deleteItem(key) { records.delete(key); },
      async createManyIfAbsent(values) {
        if (Object.keys(values).some((key) => records.has(key))) return false;
        for (const [key, value] of Object.entries(values)) records.set(key, structuredClone(value));
        await recordHook?.('create', Object.keys(values)[0]!);
        if (failAcknowledgement) { failAcknowledgement = false; throw new Error('simulated lost commit acknowledgment'); }
        if (failCatalogueAcknowledgement && Object.hasOwn(values, WALLET_CATALOGUE_KEY)) { failCatalogueAcknowledgement = false; throw new Error('simulated lost catalogue acknowledgment'); }
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
    async close() { closes++; },
  });
  const factory = createKeyringRuntimeFactory({ ensureCryptoReady: async () => {
    assert.ok(globalThis.crypto.subtle, 'Node supplies real WebCrypto for this control');
  }, openStorage: open, loadSdk });
  return {
    records, factory,
    onRecord(hook?: (kind: string, key: string) => Promise<void>) { recordHook = hook; },
    get closes() { return closes; },
    loseCasAcknowledgement() { failCasAcknowledgement = true; },
    loseCatalogueAcknowledgement() { failCatalogueAcknowledgement = true; },
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
  assert.equal(JSON.stringify([...disk.records].filter(([key]) => key !== WALLET_CATALOGUE_KEY)), committed);
  assert.equal(disk.records.has(WALLET_CATALOGUE_KEY), true);
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


test('legacy first-ETH wallet migrates only after SDK authentication and cold-reopens its catalogue', async () => {
  const disk = memoryDisk(); disk.denyNetwork();
  let runtime = await disk.factory.open() as KeyringRuntime;
  try {
    await runtime.session.importWallet(PHRASE, PASSWORD);
    const first = runtime.catalogue.getSnapshot();
    assert.equal(first?.accounts[0]?.address, ADDRESS);
    assert.equal('publicKey' in first!.accounts[0]!, false);
    await runtime.storage.close();
    assert.equal(runtime.catalogue.getSnapshot(), null);
    // A wallet created by the preceding native release contains only its vault.
    disk.records.delete(WALLET_CATALOGUE_KEY);
    const priorVault = disk.records.get('vault');
    const priorKeys = structuredClone(disk.records.get('vault-keys'));
    runtime = await disk.factory.open() as KeyringRuntime;
    assert.equal(runtime.catalogue.getSnapshot(), null);
    assert.equal((await runtime.session.unlock('wrong password')).authenticated, false);
    assert.equal(disk.records.has(WALLET_CATALOGUE_KEY), false);
    assert.equal((await runtime.session.unlock(PASSWORD)).authenticated, true);
    assert.deepEqual(runtime.catalogue.getSnapshot(), first);
    const catalogue = structuredClone(disk.records.get(WALLET_CATALOGUE_KEY));
    assert.equal(disk.records.get('vault'), priorVault);
    assert.deepEqual(disk.records.get('vault-keys'), priorKeys);
    await runtime.storage.close();
    runtime = await disk.factory.open() as KeyringRuntime;
    assert.equal((await runtime.session.unlock(PASSWORD)).authenticated, true);
    assert.deepEqual(disk.records.get(WALLET_CATALOGUE_KEY), catalogue);
    assert.deepEqual(runtime.catalogue.getSnapshot(), first);
    await runtime.session.lock();
    assert.equal(runtime.catalogue.getSnapshot(), null);
    await assert.rejects(runtime.session.readEthereumAddress(), /NOT_READY/);
  } finally { await runtime.storage.close(); disk.restoreNetwork(); }
});

test('catalogue identity corruption retires the authenticated SDK session without rewriting metadata', async () => {
  const disk = memoryDisk(); disk.denyNetwork();
  let runtime = await disk.factory.open() as KeyringRuntime;
  try {
    await runtime.session.importWallet(PHRASE, PASSWORD);
    await runtime.storage.close();
    const record = structuredClone(disk.records.get(WALLET_CATALOGUE_KEY)) as {
      accounts: { address: string }[];
    };
    record.accounts[0]!.address = '0x1111111111111111111111111111111111111111';
    disk.records.set(WALLET_CATALOGUE_KEY, record);
    runtime = await disk.factory.open() as KeyringRuntime;
    await assert.rejects(runtime.session.unlock(PASSWORD), /OPERATION_FAILED/);
    assert.equal(runtime.catalogue.getSnapshot(), null);
    await assert.rejects(runtime.session.readEthereumAddress(), /NOT_READY/);
    assert.deepEqual(disk.records.get(WALLET_CATALOGUE_KEY), record);
  } finally { await runtime.storage.close(); disk.restoreNetwork(); }
});


test('lost catalogue acknowledgement quarantines authority but close and fresh-runtime recovery still complete', async () => {
  const disk = memoryDisk(); disk.denyNetwork();
  let authority = new NativeCustodyAuthority(disk.factory);
  try {
    await authority.initialize();
    disk.loseCatalogueAcknowledgement();
    await assert.rejects(authority.importPhrase(PHRASE, PASSWORD), /UNAVAILABLE/);
    assert.equal(authority.getSnapshot().phase, 'unavailable');
    assert.equal(authority.getSnapshot().account, null);
    assert.equal(disk.records.has(WALLET_CATALOGUE_KEY), true);
    const preserved = JSON.stringify([...disk.records]);
    await assert.rejects(authority.dispose(), /CLEANUP_FAILED/);
    assert.equal(disk.closes, 1, 'quarantined lock does not skip storage.close');
    authority = new NativeCustodyAuthority(disk.factory);
    await authority.initialize();
    assert.equal(authority.getSnapshot().phase, 'locked');
    await authority.unlock(PASSWORD);
    assert.equal(authority.getSnapshot().account?.address, ADDRESS);
    assert.equal(JSON.stringify([...disk.records]), preserved);
    await authority.dispose();
    assert.equal(disk.closes, 2);
  } finally { await authority.dispose().catch(() => undefined); disk.restoreNetwork(); }
});


async function readyAccounts(loadSdk?: KeyringRuntimeDependencies['loadSdk']) {
  const disk = memoryDisk(loadSdk); disk.denyNetwork();
  let runtime!: KeyringRuntime;
  const authority = new NativeCustodyAuthority({ async open() { runtime = await disk.factory.open() as KeyringRuntime; return runtime; } });
  await authority.initialize();
  await authority.importPhrase(PHRASE, PASSWORD);
  await runtime.backup.confirm(await runtime.backup.fingerprint());
  authority.lock(); await authority.unlock(PASSWORD);
  const execute = (request: Parameters<NativeCustodyAuthority['manageAccounts']>[0]) => authority.manageAccounts(request, authority.getSnapshot().revision, authority.getCatalogue()!.revision);
  return { disk, authority, get runtime() { return runtime; }, execute };
}

test('real SDK HD accounts create, select, rename, remove and restore without reusing indices', async () => {
  const f = await readyAccounts();
  try {
    assert.equal(f.authority.supportsAccountManagement(), true);
    await f.execute({ kind: 'create', label: 'Savings', password: PASSWORD });
    const second = f.authority.getCatalogue()!.accounts.find((a) => a.index === 1)!;
    assert.equal(second.address, '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0');
    assert.equal(f.authority.getSnapshot().account?.address, second.address);
    await f.execute({ kind: 'rename', id: second.id, label: 'Long term' });
    assert.equal(f.authority.getCatalogue()!.accounts.find((a) => a.index === 1)!.label, 'Long term');
    await f.execute({ kind: 'select', id: 'hd:60:0' });
    await f.execute({ kind: 'remove', id: second.id, password: PASSWORD });
    assert.deepEqual(f.authority.getCatalogue()!.removed, [{ id: second.id, index: 1 }]);
    await f.execute({ kind: 'create', label: 'New account', password: PASSWORD });
    assert.equal(f.authority.getCatalogue()!.accounts.at(-1)!.index, 2);
    await f.execute({ kind: 'restore', index: 1, label: 'Restored savings', password: PASSWORD });
    assert.equal(f.authority.getSnapshot().account?.address, second.address);
    const signed = await f.runtime.transfers!.sign({ type: 2, from: second.address,
      to: '0x1111111111111111111111111111111111111111', chainId: '1', nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' }, PASSWORD, () => undefined);
    const { Transaction } = await import('ethers/transaction');
    assert.equal(Transaction.from(signed.rawTransaction).from, second.address);
    const persisted = JSON.stringify([...f.disk.records]);
    assert.equal(persisted.includes(PHRASE), false); assert.equal(persisted.includes(PASSWORD), false);
    const catalogue = f.authority.getCatalogue();
    await f.authority.dispose();
    const reopened = new NativeCustodyAuthority(f.disk.factory);
    await reopened.initialize(); await reopened.unlock(PASSWORD);
    assert.deepEqual(reopened.getCatalogue(), catalogue);
    assert.equal(reopened.getSnapshot().account?.address, second.address);
    await reopened.dispose();
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

test('first-account legacy journal and new-account journals stay isolated across selection', async () => {
  const f = await readyAccounts();
  const tx = (from: string) => ({ type: 2 as const, from,
    to: '0x1111111111111111111111111111111111111111', chainId: '1', nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' });
  try {
    const first = await f.runtime.transfers!.sign(tx(ADDRESS), PASSWORD, () => undefined);
    let journal = await f.runtime.transfers!.journal(() => undefined);
    await journal.saveSigned(first.rawTransaction); await journal.transition(first.hash, 'attempted');
    assert.equal(f.disk.records.has('native-evm-transfer-v1'), true);
    await f.execute({ kind: 'create', label: 'Savings', password: PASSWORD });
    const secondAddress = f.authority.getSnapshot().account!.address;
    journal = await f.runtime.transfers!.journal(() => undefined);
    assert.equal(await journal.load(), null);
    const second = await f.runtime.transfers!.sign(tx(secondAddress), PASSWORD, () => undefined);
    journal = await f.runtime.transfers!.journal(() => undefined);
    await journal.saveSigned(second.rawTransaction); await journal.transition(second.hash, 'attempted');
    assert.equal(f.disk.records.has('native-evm-transfer-v1:hd:60:1'), true);
    await f.execute({ kind: 'select', id: 'hd:60:0' });
    journal = await f.runtime.transfers!.journal(() => undefined);
    assert.equal((await journal.load())!.rawTransaction, first.rawTransaction);
    await assert.rejects(f.execute({ kind: 'remove', id: 'hd:60:1', password: PASSWORD }), /PENDING_TRANSFER/);
    assert.equal(f.authority.getSnapshot().phase, 'locked');
    await f.authority.unlock(PASSWORD);
    assert.equal(f.authority.getCatalogue()!.accounts.length, 2);
    await f.execute({ kind: 'select', id: 'hd:60:1' });
    journal = await f.runtime.transfers!.journal(() => undefined);
    assert.equal((await journal.load())!.rawTransaction, second.rawTransaction);
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

test('reentrant lock during account admission cannot publish ready or commit a new account', async () => {
  const f = await readyAccounts();
  try {
    let revoked = false;
    const unsubscribe = f.authority.subscribe((state) => {
      if (!revoked && state.phase === 'authenticating') { revoked = true; f.authority.lock(); }
    });
    await assert.rejects(f.execute({ kind: 'create', label: 'Cancelled', password: PASSWORD }), /CANCELLED/);
    unsubscribe();
    assert.equal(f.authority.getSnapshot().phase, 'locked');
    await f.authority.unlock(PASSWORD);
    assert.equal(f.authority.getCatalogue()!.accounts.length, 1);
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});


const deferredAccount = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};
async function raceSdk() {
  const sdk = await import('@sidhujag/sysweb3-keyring/cjs/software.js');
  let gate: { phase: string; entered: ReturnType<typeof deferredAccount>; released: ReturnType<typeof deferredAccount> } | undefined;
  let signingHook: (() => void) | undefined;
  const hold = async (phase: string) => {
    if (gate?.phase !== phase) return;
    const current = gate; current.entered.resolve(); await current.released.promise;
  };
  class RaceKeyring extends sdk.SoftwareKeyring {
    constructor(host: ConstructorParameters<typeof sdk.SoftwareKeyring>[0]) {
      super(host);
      const hydrate = this.createFirstAccount.bind(this);
      this.createFirstAccount = async (...args) => { const result = hydrate(...args); await hold('hydration'); return result; };
      const sign = this.signPreparedEvmTransaction.bind(this);
      this.signPreparedEvmTransaction = (...args) => { signingHook?.(); return sign(...args); };
    }
    async unlock(password: string) { const result = super.unlock(password); await hold('password'); return result; }
  }
  return {
    loadSdk: async () => ({ ...sdk, SoftwareKeyring: RaceKeyring }),
    onSign(hook?: () => void) { signingHook = hook; },
    hold(phase: string) {
      const current = { phase, entered: deferredAccount(), released: deferredAccount() }; gate = current;
      return { entered: current.entered.promise, release() { gate = undefined; current.released.resolve(); } };
    },
  };
}
function localTransferRpc(networkId: 'ethereum' | 'syscoin-nevm-testnet' = 'ethereum') {
  const broadcasts: string[] = [];
  let included = false;
  let reading: { method: string; entered: ReturnType<typeof deferredAccount>; released: ReturnType<typeof deferredAccount> } | undefined;
  let gate: { entered: ReturnType<typeof deferredAccount>; released: ReturnType<typeof deferredAccount> } | undefined;
  const rpc = new NativeTransferRpc({ networkId, fetch: async (url, init) => {
    assert.equal(url, getNativeNetwork(networkId).rpcUrl);
    const body = JSON.parse(String(init.body));
    if (reading && reading.method === body.method) { const current = reading; current.entered.resolve(); await current.released.promise; }
    let result: unknown;
    if (body.method === 'eth_chainId') result = `0x${BigInt(getNativeNetwork(networkId).chainId).toString(16)}`;
    else if (body.method === 'eth_getBalance') result = '0x10000000000000000';
    else if (body.method === 'eth_getTransactionCount') result = included ? '0x1' : '0x0';
    else if (body.method === 'eth_feeHistory') result = { oldestBlock: '0x1', baseFeePerGas: ['0x1', '0x1'] };
    else if (body.method === 'eth_maxPriorityFeePerGas') result = '0x1';
    else if (body.method === 'eth_estimateGas') result = '0x5208';
    else if (body.method === 'eth_getTransactionReceipt') {
      const tx = included && broadcasts[0] ? Transaction.from(broadcasts[0]) : null;
      result = tx ? { transactionHash: tx.hash, from: tx.from, to: tx.to, status: '0x1', blockNumber: '0x59', blockHash: '0x' + '2'.repeat(64) } : null;
    }
    else if (body.method === 'eth_getBlockByNumber') result = { number: body.params[0] === 'finalized' ? '0x20' : body.params[0] === 'latest' ? '0x64' : body.params[0], hash: '0x' + '2'.repeat(64) };
    else if (body.method === 'eth_sendRawTransaction') {
      broadcasts.push(body.params[0]);
      if (gate) { const current = gate; current.entered.resolve(); await current.released.promise; }
      result = keccak256(body.params[0]);
    } else throw Error('Unexpected fixture RPC');
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), { headers: { 'content-type': 'application/json' } });
  } });
  return { rpc, broadcasts, include() { included = true; }, holdRead(method: string) {
    const current = { method, entered: deferredAccount(), released: deferredAccount() }; reading = current;
    return { entered: current.entered.promise, release() { reading = undefined; current.released.resolve(); } };
  }, holdBroadcast() {
    const current = { entered: deferredAccount(), released: deferredAccount() }; gate = current;
    return { entered: current.entered.promise, release() { gate = undefined; current.released.resolve(); } };
  } };
}
async function prepareAccountTransfer(transfers: NativeTransfers) {
  await transfers.prepare('0x1111111111111111111111111111111111111111', '0.001');
  return transfers.getSnapshot().review!.id;
}

for (const phase of ['password', 'hydration'] as const) {
  test(`account selection is BUSY during real SDK transfer ${phase} and cannot retarget signing`, async () => {
    const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk), network = localTransferRpc();
    const transfers = new NativeTransfers(f.authority, () => f.runtime.transfers, { rpc: network.rpc });
    try {
      await f.execute({ kind: 'create', label: 'Savings', password: PASSWORD });
      const from = f.authority.getSnapshot().account!.address;
      const review = await prepareAccountTransfer(transfers);
      const hold = sdk.hold(phase);
      const pending = transfers.confirm(review, PASSWORD);
      await hold.entered;
      const revision = f.authority.getSnapshot().revision;
      await assert.rejects(f.execute({ kind: 'select', id: 'hd:60:0' }), /BUSY/);
      assert.equal(f.authority.getSnapshot().revision, revision);
      hold.release(); await pending;
      assert.equal(network.broadcasts.length, 1);
      assert.equal(Transaction.from(network.broadcasts[0]!).from, from);
      assert.equal(f.authority.getSnapshot().phase, 'ready');
    } finally { transfers.dispose(); await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
  });
}

test('synchronous selection reentrancy from SDK signing is denied before authority publication', async () => {
  const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk), network = localTransferRpc();
  const transfers = new NativeTransfers(f.authority, () => f.runtime.transfers, { rpc: network.rpc });
  try {
    await f.execute({ kind: 'create', label: 'Savings', password: PASSWORD });
    let attempted: Promise<void> | undefined;
    const revision = f.authority.getSnapshot().revision;
    sdk.onSign(() => { attempted = f.execute({ kind: 'select', id: 'hd:60:0' }); void attempted.catch(() => undefined); });
    await transfers.confirm(await prepareAccountTransfer(transfers), PASSWORD);
    await assert.rejects(attempted!, /BUSY/);
    assert.equal(f.authority.getSnapshot().revision, revision);
    assert.equal(Transaction.from(network.broadcasts[0]!).from, f.authority.getSnapshot().account!.address);
  } finally { transfers.dispose(); await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

for (const phase of ['journal-read', 'journal-write', 'broadcast'] as const) {
  test(`A-B-A account selection invalidates held ${phase} and preserves its original journal`, async () => {
    const f = await readyAccounts(), network = localTransferRpc();
    const transfers = new NativeTransfers(f.authority, () => f.runtime.transfers, { rpc: network.rpc });
    const entered = deferredAccount(), release = deferredAccount();
    let broadcastHold: ReturnType<typeof network.holdBroadcast> | undefined;
    try {
      await f.execute({ kind: 'create', label: 'Savings', password: PASSWORD });
      await f.execute({ kind: 'select', id: 'hd:60:0' });
      const oldRevision = f.authority.getSnapshot().revision;
      let pending: Promise<void>;
      if (phase === 'journal-read') {
        f.disk.onRecord(async (kind, key) => { if (kind === 'get' && key === 'native-evm-transfer-v1') { f.disk.onRecord(); entered.resolve(); await release.promise; } });
        pending = transfers.prepare('0x1111111111111111111111111111111111111111', '0.001');
      } else {
        const id = await prepareAccountTransfer(transfers);
        if (phase === 'journal-write') f.disk.onRecord(async (kind, key) => { if (kind === 'create' && key === 'native-evm-transfer-v1') { f.disk.onRecord(); entered.resolve(); await release.promise; } });
        else { broadcastHold = network.holdBroadcast(); void broadcastHold.entered.then(entered.resolve); }
        pending = transfers.confirm(id, PASSWORD);
      }
      void pending.catch(() => undefined);
      await entered.promise;
      await f.execute({ kind: 'select', id: 'hd:60:1' });
      assert.equal(f.disk.records.has('native-evm-transfer-v1:hd:60:1'), false);
      await f.execute({ kind: 'select', id: 'hd:60:0' });
      assert.ok(f.authority.getSnapshot().revision > oldRevision);
      release.resolve(); broadcastHold?.release();
      await assert.rejects(pending, /CANCELLED/);
      assert.equal(f.authority.getSnapshot().phase, 'ready');
      const old = await (await f.runtime.transfers!.journal(() => undefined)).load();
      assert.equal(old?.phase, phase === 'journal-read' ? undefined : phase === 'broadcast' ? 'attempted' : 'signed');
      if (old) assert.equal(Transaction.from(old.rawTransaction).from, ADDRESS);
      assert.equal(network.broadcasts.length, phase === 'broadcast' ? 1 : 0);
      assert.equal(transfers.getSnapshot().review, null);
    } finally { release.resolve(); broadcastHold?.release(); f.disk.onRecord(); transfers.dispose(); await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
  });
}

test('account selection waits for active backup authentication and invalidates a completed old challenge', async () => {
  const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk);
  const backup = new SeedBackupFlow(f.authority, () => f.runtime.backup);
  try {
    await f.execute({ kind: 'create', label: 'Savings', password: PASSWORD });
    const hold = sdk.hold('password');
    const pending = backup.begin(PASSWORD);
    await hold.entered;
    await assert.rejects(f.execute({ kind: 'select', id: 'hd:60:0' }), /BUSY/);
    hold.release(); const challenge = await pending;
    await f.execute({ kind: 'select', id: 'hd:60:0' });
    await assert.rejects(backup.confirm(challenge.id, challenge.positions.map((position) => challenge.words[position]!)), /BACKUP_EXPIRED/);
    assert.equal(f.authority.getSnapshot().phase, 'ready');
  } finally { backup.dispose(); await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});


test('lost mutation acknowledgement quarantines authority and reopens the exact committed account change', async () => {
  const f = await readyAccounts();
  try {
    f.disk.loseCasAcknowledgement();
    await assert.rejects(f.execute({ kind: 'rename', id: 'hd:60:0', label: 'Committed once' }), /UNAVAILABLE/);
    assert.equal(f.authority.getSnapshot().phase, 'unavailable');
    assert.equal(f.authority.getSnapshot().account, null);
    await assert.rejects(f.authority.dispose(), /CLEANUP_FAILED/);
    assert.equal(f.disk.closes, 1);
    const reopened = new NativeCustodyAuthority(f.disk.factory);
    await reopened.initialize(); await reopened.unlock(PASSWORD);
    assert.equal(reopened.getCatalogue()!.accounts[0]!.label, 'Committed once');
    assert.equal(reopened.getCatalogue()!.revision, 1);
    await reopened.dispose();
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});


test('async host guards never authorize account mutation, journal access or a signature', async () => {
  const f = await readyAccounts();
  const asynchronousGuard = async () => { throw Error('Asynchronous guard rejection is observed'); };
  try {
    const before = JSON.stringify(f.disk.records.get(WALLET_CATALOGUE_KEY));
    const reservation = f.runtime.accounts!.reserve({ kind: 'create', label: 'Must not commit', password: PASSWORD }, f.authority.getCatalogue()!.revision);
    await assert.rejects(reservation.execute(asynchronousGuard), /CANCELLED/);
    assert.equal(JSON.stringify(f.disk.records.get(WALLET_CATALOGUE_KEY)), before);
    await f.runtime.session.unlock(PASSWORD);
    await assert.rejects(f.runtime.transfers!.journal(asynchronousGuard), /CANCELLED/);
    await assert.rejects(f.runtime.transfers!.sign({ type: 2, from: ADDRESS, to: '0x1111111111111111111111111111111111111111', chainId: '1', nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' }, PASSWORD, asynchronousGuard), /CANCELLED/);
    assert.equal(JSON.stringify(f.disk.records.get(WALLET_CATALOGUE_KEY)), before);
    assert.equal(f.disk.records.has('native-evm-transfer-v1'), false);
    await new Promise<void>((resolve) => setImmediate(resolve));
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});


test('known ineligible account requests preserve the ready authority and its revision', async () => {
  const f = await readyAccounts();
  try {
    await f.execute({ kind: 'create', label: 'Savings', password: PASSWORD });
    const before = f.authority.getSnapshot(), catalogue = f.authority.getCatalogue();
    const persisted = JSON.stringify([...f.disk.records]);
    const credentials = [f.disk.failureWrites, f.disk.successWrites];
    const requests = [
      { kind: 'remove' as const, id: 'hd:60:0', password: PASSWORD },
      { kind: 'remove' as const, id: 'hd:60:1', password: PASSWORD },
      { kind: 'remove' as const, id: 'hd:60:99', password: PASSWORD },
      { kind: 'select' as const, id: 'hd:60:99' },
      { kind: 'rename' as const, id: 'hd:60:99', label: 'Missing' },
      { kind: 'restore' as const, index: 99, label: 'Missing', password: PASSWORD },
    ];
    let publications = 0;
    const stop = f.authority.subscribe(() => { publications++; });
    for (const request of requests) {
      await assert.rejects(f.execute(request), /ACCOUNT_NOT_REMOVABLE|INVALID_INPUT/);
      assert.equal(f.authority.getSnapshot(), before);
      assert.equal(f.authority.getCatalogue(), catalogue);
      assert.equal(JSON.stringify([...f.disk.records]), persisted);
      assert.deepEqual([f.disk.failureWrites, f.disk.successWrites], credentials);
    }
    stop(); assert.equal(publications, 0);
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});


test('runtime count and highwater preflight reject before authentication or authority revocation', async () => {
  const f = await readyAccounts();
  try {
    const original = structuredClone(f.disk.records.get(WALLET_CATALOGUE_KEY)) as Record<string, any>;
    const accounts = Array.from({ length: 20 }, (_, index) => {
      const key = HDNodeWallet.fromPhrase(PHRASE, undefined, `m/44'/60'/0'/0/${index}`);
      return { id: `hd:60:${index}`, index, type: 'HDAccount', slip44: 60, address: key.address, publicKey: SigningKey.computePublicKey(key.publicKey, original.accounts[0].publicKey.length === 68).toLowerCase(), label: `Account ${index + 1}` };
    });
    f.authority.lock();
    f.disk.records.set(WALLET_CATALOGUE_KEY, { ...original, accounts, nextIndex: 20 });
    await f.authority.unlock(PASSWORD);
    for (const shape of ['count', 'highwater']) {
      if (shape === 'highwater') {
        f.authority.lock();
        f.disk.records.set(WALLET_CATALOGUE_KEY, { ...original, nextIndex: 4096, retiredIndices: Array.from({ length: 4095 }, (_, i) => i + 1) });
        await f.authority.unlock(PASSWORD);
      }
      const before = f.authority.getSnapshot(), writes = f.disk.successWrites;
      await assert.rejects(f.execute({ kind: 'create', label: 'Limit', password: PASSWORD }), /ACCOUNT_LIMIT/);
      assert.equal(f.authority.getSnapshot(), before);
      assert.equal(f.disk.successWrites, writes);
    }
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});


test('all EVM contexts preserve SDK HD addresses while only reviewed native send contexts enable signing', async () => {
  const f = await readyAccounts();
  try {
    await f.execute({ kind: 'create', label: 'Savings', password: PASSWORD });
    const address = f.authority.getSnapshot().account!.address;
    const select = (id: string) => f.authority.selectNetwork(id, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
    for (const network of NATIVE_NETWORKS) {
      await select(network.id);
      assert.equal(f.authority.getSnapshot().account!.network, network.id);
      assert.equal(f.authority.getSnapshot().account!.address, address);
      if (!['ethereum', 'syscoin-nevm-testnet'].includes(network.id)) {
        const state = f.authority.getSnapshot();
        await assert.rejects(f.runtime.transfers!.authorize(PASSWORD, () => undefined), /NOT_READY/);
        await assert.rejects(f.runtime.transfers!.journal(() => undefined), /NOT_READY/);
        await assert.rejects(f.runtime.transfers!.sign({ type: 2, from: address, to: ADDRESS, chainId: network.chainId, nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' }, PASSWORD, () => undefined), /NOT_READY/);
        assert.equal(f.authority.getSnapshot(), state);
      }
    }
    await select('syscoin-nevm');
    await f.execute({ kind: 'create', label: 'New on NEVM context', password: PASSWORD });
    const derived = f.authority.getSnapshot().account!.address;
    assert.equal(f.authority.getCatalogue()!.active.networkId, 'syscoin-nevm');
    await select('ethereum');
    assert.equal(f.authority.getSnapshot().account!.address, derived);
    await select('rollux');
    await f.authority.dispose();
    const reopened = new NativeCustodyAuthority(f.disk.factory);
    await reopened.initialize(); await reopened.unlock(PASSWORD);
    assert.equal(reopened.getSnapshot().account!.network, 'rollux');
    assert.equal(reopened.getSnapshot().account!.address, derived);
    await reopened.dispose();
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

test('installed SDK signs chain5700 offline and retains same-nonce Ethereum/testnet journal siblings across restart', async () => {
  const f = await readyAccounts();
  try {
    await f.execute({ kind: 'create', label: 'Cross-chain', password: PASSWORD });
    const account = f.authority.getSnapshot().account!.address;
    const transaction = (chainId: string) => ({ type: 2 as const, from: account, to: ADDRESS, chainId,
      nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' });
    const ethereum = await f.runtime.transfers!.sign(transaction('1'), PASSWORD, () => undefined);
    const firstJournal = await f.runtime.transfers!.journal(() => undefined);
    await firstJournal.saveSigned(ethereum.rawTransaction); await firstJournal.transition(ethereum.hash, 'attempted');
    await f.authority.selectNetwork('syscoin-nevm-testnet', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
    await assert.rejects(f.runtime.transfers!.sign(transaction('1'), PASSWORD, () => undefined), /INVALID_INPUT/);
    const nevm = await f.runtime.transfers!.sign(transaction('5700'), PASSWORD, () => undefined);
    const parsed = Transaction.from(nevm.rawTransaction);
    assert.equal(parsed.chainId, 5700n); assert.equal(parsed.from, account); assert.equal(parsed.nonce, 0);
    assert.notEqual(nevm.hash, ethereum.hash);
    const secondJournal = await f.runtime.transfers!.journal(() => undefined);
    await secondJournal.saveSigned(nevm.rawTransaction); await secondJournal.transition(nevm.hash, 'attempted');
    const stored = structuredClone(f.disk.records.get('native-evm-transfer-v1:hd:60:1')) as any;
    assert.equal(stored.version, 2);
    assert.deepEqual(stored.entries.map((entry: any) => [entry.registration.chainId, entry.nonce]), [['1', 0], ['5700', 0]]);
    await f.authority.dispose();
    let runtime!: KeyringRuntime;
    const reopened = new NativeCustodyAuthority({ async open() { runtime = await f.disk.factory.open() as KeyringRuntime; return runtime; } });
    await reopened.initialize(); await reopened.unlock(PASSWORD);
    assert.equal(reopened.getSnapshot().account?.network, 'syscoin-nevm-testnet');
    assert.equal((await (await runtime.transfers!.journal(() => undefined)).load())!.rawTransaction, nevm.rawTransaction);
    await reopened.selectNetwork('ethereum', reopened.getSnapshot().revision, reopened.getCatalogue()!.revision);
    assert.equal((await (await runtime.transfers!.journal(() => undefined)).load())!.rawTransaction, ethereum.rawTransaction);
    await reopened.manageAccounts({ kind: 'select', id: 'hd:60:0' }, reopened.getSnapshot().revision, reopened.getCatalogue()!.revision);
    await assert.rejects(reopened.manageAccounts({ kind: 'remove', id: 'hd:60:1', password: PASSWORD }, reopened.getSnapshot().revision, reopened.getCatalogue()!.revision), /PENDING_TRANSFER/);
    assert.deepEqual(f.disk.records.get('native-evm-transfer-v1:hd:60:1'), stored);
    await reopened.dispose();
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

test('NEVM native controller submits and explicitly retries exact installed-SDK bytes before depth confirmation', async () => {
  const f = await readyAccounts(), network = localTransferRpc('syscoin-nevm-testnet');
  const transfers = new NativeTransfers(f.authority, () => f.runtime.transfers, { rpc: network.rpc });
  try {
    await f.authority.selectNetwork('syscoin-nevm-testnet', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
    const review = await prepareAccountTransfer(transfers);
    assert.equal(transfers.getSnapshot().review!.context.chainId, '5700');
    assert.equal(transfers.getSnapshot().review!.context.symbol, 'TSYS');
    await transfers.confirm(review, PASSWORD);
    assert.equal(network.broadcasts.length, 1);
    assert.equal(Transaction.from(network.broadcasts[0]!).chainId, 5700n);
    await transfers.recover(true);
    assert.equal(transfers.getSnapshot().review!.retry, true);
    await transfers.confirm(transfers.getSnapshot().review!.id, PASSWORD);
    assert.equal(network.broadcasts.length, 2);
    assert.equal(network.broadcasts[1], network.broadcasts[0]);
    network.include();
    await transfers.recover();
    assert.equal(transfers.getSnapshot().phase, 'confirmed');
    assert.equal(transfers.getSnapshot().context!.settlement.kind, 'nevm-depth-12');
    assert.equal((await (await f.runtime.transfers!.journal(() => undefined)).load())!.phase, 'confirmed');
  } finally { transfers.dispose(); await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

test('NEVM A-B-A cancels a pending quote without adopting its late context', async () => {
  const f = await readyAccounts(), network = localTransferRpc('syscoin-nevm-testnet');
  const transfers = new NativeTransfers(f.authority, () => f.runtime.transfers, { rpc: network.rpc });
  const hold = network.holdRead('eth_feeHistory');
  try {
    const select = (id: string) => f.authority.selectNetwork(id, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
    await select('syscoin-nevm-testnet');
    const preparing = transfers.prepare(ADDRESS, '0.001'); void preparing.catch(() => undefined);
    await hold.entered;
    await select('ethereum'); await select('syscoin-nevm-testnet');
    hold.release();
    await assert.rejects(preparing, /CANCELLED/);
    assert.equal(transfers.getSnapshot().review, null);
    assert.equal(network.broadcasts.length, 0);
    assert.equal(await (await f.runtime.transfers!.journal(() => undefined)).load(), null);
  } finally { hold.release(); transfers.dispose(); await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

for (const phase of ['password', 'hydration'] as const) {
  test(`NEVM network switching cannot enter while installed SDK ${phase} work is active`, async () => {
    const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk), network = localTransferRpc('syscoin-nevm-testnet');
    const transfers = new NativeTransfers(f.authority, () => f.runtime.transfers, { rpc: network.rpc });
    try {
      await f.authority.selectNetwork('syscoin-nevm-testnet', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
      const review = await prepareAccountTransfer(transfers);
      const hold = sdk.hold(phase);
      const signing = transfers.confirm(review, PASSWORD);
      await hold.entered;
      const before = f.authority.getSnapshot();
      await assert.rejects(f.authority.selectNetwork('ethereum', before.revision, f.authority.getCatalogue()!.revision), /BUSY/);
      assert.equal(f.authority.getSnapshot(), before);
      hold.release(); await signing;
      assert.equal(Transaction.from(network.broadcasts[0]!).chainId, 5700n);
    } finally { transfers.dispose(); await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
  });
}

for (const phase of ['journal-write', 'broadcast'] as const) {
  test(`NEVM A-B-A during ${phase} preserves the original exact-byte recovery record`, async () => {
    const f = await readyAccounts(), network = localTransferRpc('syscoin-nevm-testnet');
    const transfers = new NativeTransfers(f.authority, () => f.runtime.transfers, { rpc: network.rpc });
    const entered = deferredAccount(), release = deferredAccount();
    let broadcastHold: ReturnType<typeof network.holdBroadcast> | undefined;
    try {
      const select = (id: string) => f.authority.selectNetwork(id, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
      await select('syscoin-nevm-testnet');
      const review = await prepareAccountTransfer(transfers);
      if (phase === 'journal-write') f.disk.onRecord(async (kind, key) => {
        if (kind === 'create' && key === 'native-evm-transfer-v1') { entered.resolve(); await release.promise; }
      });
      else broadcastHold = network.holdBroadcast();
      const signing = transfers.confirm(review, PASSWORD); void signing.catch(() => undefined);
      await (broadcastHold?.entered ?? entered.promise);
      await select('ethereum'); await select('syscoin-nevm-testnet');
      release.resolve(); broadcastHold?.release();
      await assert.rejects(signing, /CANCELLED/);
      f.disk.onRecord();
      const entry = await (await f.runtime.transfers!.journal(() => undefined)).load();
      assert.equal(Transaction.from(entry!.rawTransaction).chainId, 5700n);
      assert.equal(entry!.phase, phase === 'journal-write' ? 'signed' : 'attempted');
      await transfers.recover(true);
      assert.equal(transfers.getSnapshot().review!.retry, true);
      assert.equal(transfers.getSnapshot().hash, entry!.hash);
      assert.equal(transfers.getSnapshot().review!.context.chainId, '5700');
    } finally { release.resolve(); broadcastHold?.release(); f.disk.onRecord(); transfers.dispose(); await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
  });
}

test('network selection rejects unknown identity and active SDK work before changing authority', async () => {
  const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk);
  try {
    const before = f.authority.getSnapshot();
    await assert.rejects(f.execute({ kind: 'select-network', id: 'base' } as any), /INVALID_INPUT/);
    assert.equal(f.authority.getSnapshot(), before);
    await assert.rejects(f.authority.selectNetwork('unknown', before.revision, f.authority.getCatalogue()!.revision), /INVALID_INPUT/);
    assert.equal(f.authority.getSnapshot(), before);
    const hold = sdk.hold('password');
    const pending = f.runtime.backup.readPhrase(PASSWORD);
    await hold.entered;
    await assert.rejects(f.authority.selectNetwork('base', before.revision, f.authority.getCatalogue()!.revision), /BUSY/);
    assert.equal(f.authority.getSnapshot(), before);
    hold.release(); await pending;
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

test('lost network-context CAS acknowledgement quarantines and cold reopens its committed selection', async () => {
  const f = await readyAccounts();
  try {
    f.disk.loseCasAcknowledgement();
    await assert.rejects(f.authority.selectNetwork('arbitrum', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision), /UNAVAILABLE/);
    await assert.rejects(f.authority.dispose(), /CLEANUP_FAILED/);
    const reopened = new NativeCustodyAuthority(f.disk.factory);
    await reopened.initialize(); await reopened.unlock(PASSWORD);
    assert.equal(reopened.getSnapshot().account!.network, 'arbitrum');
    assert.equal(reopened.getSnapshot().account!.address, ADDRESS);
    await reopened.dispose();
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});


test('network A-B-A cancels held Ethereum journal work without touching its pending identity', async () => {
  const f = await readyAccounts(), network = localTransferRpc();
  const transfers = new NativeTransfers(f.authority, () => f.runtime.transfers, { rpc: network.rpc });
  const entered = deferredAccount(), release = deferredAccount();
  try {
    const review = await prepareAccountTransfer(transfers);
    f.disk.onRecord(async (kind, key) => { if (kind === 'create' && key === 'native-evm-transfer-v1') { f.disk.onRecord(); entered.resolve(); await release.promise; } });
    const pending = transfers.confirm(review, PASSWORD); void pending.catch(() => undefined);
    await entered.promise;
    await f.authority.selectNetwork('base', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
    await assert.rejects(f.runtime.transfers!.journal(() => undefined), /NOT_READY/);
    await f.authority.selectNetwork('ethereum', f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
    release.resolve(); await assert.rejects(pending, /CANCELLED/);
    const entry = await (await f.runtime.transfers!.journal(() => undefined)).load();
    assert.equal(entry!.phase, 'signed');
    assert.equal(Transaction.from(entry!.rawTransaction).from, ADDRESS);
    assert.equal(network.broadcasts.length, 0);
  } finally { release.resolve(); f.disk.onRecord(); transfers.dispose(); await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});


test('account removal checks every chain in its container and deletes only a fully terminal row', async () => {
  const f = await readyAccounts();
  try {
    await f.execute({ kind: 'create', label: 'Savings', password: PASSWORD });
    const address = f.authority.getSnapshot().account!.address;
    const signed = await f.runtime.transfers!.sign({ type: 2, from: address, to: ADDRESS, chainId: '1', nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' }, PASSWORD, () => undefined);
    const journal = await f.runtime.transfers!.journal(() => undefined);
    await journal.saveSigned(signed.rawTransaction); await journal.transition(signed.hash, 'nonce-consumed');
    const key = 'native-evm-transfer-v1:hd:60:1';
    const value = structuredClone(f.disk.records.get(key)) as any;
    const fixtureSigner = HDNodeWallet.fromPhrase(PHRASE, undefined, "m/44'/60'/0'/0/1");
    const otherRaw = await fixtureSigner.signTransaction({ type: 2, to: ADDRESS, chainId: 57, nonce: 0, value: 1, gasLimit: 21000, maxFeePerGas: 2, maxPriorityFeePerGas: 1 });
    value.entries.push({ registration: getNativeNetwork('syscoin-nevm'), phase: 'attempted', rawTransaction: otherRaw, hash: keccak256(otherRaw), nonce: 0, createdAt: 1000 });
    f.disk.records.set(key, value);
    await f.execute({ kind: 'select', id: 'hd:60:0' });
    await assert.rejects(f.execute({ kind: 'remove', id: 'hd:60:1', password: PASSWORD }), /PENDING_TRANSFER/);
    assert.deepEqual(f.disk.records.get(key), value);
    await f.authority.unlock(PASSWORD);
    value.entries[1].phase = 'confirmed';
    f.disk.records.set(key, structuredClone(value));
    await f.execute({ kind: 'remove', id: 'hd:60:1', password: PASSWORD });
    assert.equal(f.disk.records.has(key), false);
    await f.execute({ kind: 'restore', index: 1, label: 'Restored', password: PASSWORD });
    assert.equal(f.authority.getSnapshot().account!.address, address);
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

test('ambiguous journal acknowledgement quarantines authority but reopening preserves its attempted bytes', async () => {
  const f = await readyAccounts(), network = localTransferRpc();
  const transfers = new NativeTransfers(f.authority, () => f.runtime.transfers, { rpc: network.rpc });
  try {
    const review = await prepareAccountTransfer(transfers);
    f.disk.loseCasAcknowledgement();
    await assert.rejects(transfers.confirm(review, PASSWORD));
    assert.equal(f.authority.getSnapshot().phase, 'unavailable');
    assert.equal(network.broadcasts.length, 0);
    const value = structuredClone(f.disk.records.get('native-evm-transfer-v1')) as any;
    assert.equal(value.entries[0].phase, 'attempted');
    await assert.rejects(f.authority.dispose(), /CLEANUP_FAILED/);
    assert.equal(f.disk.closes, 1);
    let runtime!: KeyringRuntime;
    const reopened = new NativeCustodyAuthority({ async open() { runtime = await f.disk.factory.open() as KeyringRuntime; return runtime; } });
    await reopened.initialize(); await reopened.unlock(PASSWORD);
    const saved = await (await runtime.transfers!.journal(() => undefined)).load();
    assert.equal(saved!.rawTransaction, value.entries[0].rawTransaction);
    assert.equal(saved!.phase, 'attempted');
    await reopened.dispose();
  } finally { transfers.dispose(); await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});


test('an ambiguous journal acknowledgement after background lock cannot be unlocked without reopening', async () => {
  const f = await readyAccounts(), network = localTransferRpc();
  const transfers = new NativeTransfers(f.authority, () => f.runtime.transfers, { rpc: network.rpc });
  const entered = deferredAccount(), release = deferredAccount();
  try {
    const review = await prepareAccountTransfer(transfers);
    f.disk.onRecord(async (kind, key) => { if (kind === 'create' && key === 'native-evm-transfer-v1') { f.disk.onRecord(); entered.resolve(); await release.promise; } });
    f.disk.loseNextAcknowledgement();
    const pending = transfers.confirm(review, PASSWORD); void pending.catch(() => undefined);
    await entered.promise;
    f.authority.lock(); release.resolve();
    await assert.rejects(pending, /CANCELLED/);
    assert.equal(f.authority.getSnapshot().phase, 'unavailable');
    await assert.rejects(f.authority.unlock(PASSWORD), /NOT_READY/);
    assert.equal(network.broadcasts.length, 0);
    await assert.rejects(f.authority.dispose(), /CLEANUP_FAILED/);
    let runtime!: KeyringRuntime;
    const reopened = new NativeCustodyAuthority({ async open() { runtime = await f.disk.factory.open() as KeyringRuntime; return runtime; } });
    await reopened.initialize(); await reopened.unlock(PASSWORD);
    assert.equal((await (await runtime.transfers!.journal(() => undefined)).load())!.phase, 'signed');
    await reopened.dispose();
  } finally { release.resolve(); f.disk.onRecord(); transfers.dispose(); await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});


test('fresh runtime validates the complete retained container before publishing ready', async () => {
  const f = await readyAccounts();
  try {
    const tx = { type: 2 as const, from: ADDRESS, to: '0x1111111111111111111111111111111111111111', chainId: '1', nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' };
    const signed = await f.runtime.transfers!.sign(tx, PASSWORD, () => undefined);
    await (await f.runtime.transfers!.journal(() => undefined)).saveSigned(signed.rawTransaction);
    const row = structuredClone(f.disk.records.get('native-evm-transfer-v1')) as any;
    row.entries[0].registration.rpcUrl = 'https://untrusted.invalid';
    f.disk.records.set('native-evm-transfer-v1', row);
    await f.authority.dispose();
    const reopened = new NativeCustodyAuthority(f.disk.factory);
    await reopened.initialize();
    await assert.rejects(reopened.unlock(PASSWORD), /OPERATION_FAILED/);
    assert.equal(reopened.getSnapshot().phase, 'locked');
    assert.equal(reopened.getSnapshot().account, null);
    assert.deepEqual(f.disk.records.get('native-evm-transfer-v1'), row);
    await reopened.dispose();
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

test('journal quarantine rejects every later secret operation on the same runtime', async () => {
  const f = await readyAccounts();
  try {
    const tx = { type: 2 as const, from: ADDRESS, to: '0x1111111111111111111111111111111111111111', chainId: '1', nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' };
    const signed = await f.runtime.transfers!.sign(tx, PASSWORD, () => undefined);
    const journal = await f.runtime.transfers!.journal(() => undefined);
    await journal.saveSigned(signed.rawTransaction);
    f.disk.loseCasAcknowledgement();
    await assert.rejects(journal.transition(signed.hash, 'attempted'), /REOPEN_REQUIRED/);
    const records = JSON.stringify([...f.disk.records]);
    const credentials = f.disk.successWrites;
    const operations = [
      () => f.runtime.session.unlock(PASSWORD),
      () => f.runtime.session.createWallet(PASSWORD),
      () => f.runtime.session.importWallet(PHRASE, PASSWORD),
      () => f.runtime.backup.readPhrase(PASSWORD),
      () => f.runtime.backup.confirm('1'.repeat(64)),
      () => f.runtime.transfers!.sign(tx, PASSWORD, () => undefined),
      () => f.runtime.transfers!.authorize(PASSWORD, () => undefined),
    ];
    for (const operation of operations) await assert.rejects(operation(), /CLEANUP_FAILED|CANCELLED/);
    assert.equal(f.disk.successWrites, credentials);
    assert.equal(JSON.stringify([...f.disk.records]), records);
    f.authority.lock();
    await assert.rejects(f.authority.unlock(PASSWORD), /UNAVAILABLE/);
    assert.equal(f.authority.getSnapshot().phase, 'unavailable');
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});


test('journal ambiguity retires an already-running secret operation before it returns recovery words', async () => {
  const sdk = await raceSdk(), f = await readyAccounts(sdk.loadSdk);
  try {
    const signed = await f.runtime.transfers!.sign({ type: 2, from: ADDRESS, to: '0x1111111111111111111111111111111111111111', chainId: '1', nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '2', maxPriorityFeePerGas: '1' }, PASSWORD, () => undefined);
    const journal = await f.runtime.transfers!.journal(() => undefined);
    await journal.saveSigned(signed.rawTransaction);
    const hold = sdk.hold('password');
    const secret = f.runtime.backup.readPhrase(PASSWORD); void secret.catch(() => undefined);
    await hold.entered;
    f.disk.loseCasAcknowledgement();
    await assert.rejects(journal.transition(signed.hash, 'attempted'), /REOPEN_REQUIRED/);
    hold.release();
    await assert.rejects(secret, /CLEANUP_FAILED/);
    await assert.rejects(f.runtime.session.readEthereumAddress(), /NOT_READY/);
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

test('native token capability uses authenticated account/network, preserves restore data and never authenticates/signs', async () => {
  const f = await readyAccounts();
  const token = { contractAddress: '0x1111111111111111111111111111111111111111', decimals: 255, name: 'Untrusted token', symbol: 'TOKEN' };
  try {
    const credentials = f.disk.successWrites;
    const initial = await f.runtime.tokens!.load(() => undefined);
    await f.runtime.tokens!.add(initial.revision, token, () => undefined);
    assert.equal(f.disk.successWrites, credentials);
    const stored = JSON.stringify(f.disk.records.get('native-token-registry-v1'));
    assert(!stored.includes(PASSWORD)); assert(!stored.includes(PHRASE)); assert(!stored.includes('units'));
    await f.execute({ kind: 'create', label: 'Savings', password: PASSWORD });
    assert.deepEqual((await f.runtime.tokens!.load(() => undefined)).items, []);
    await f.execute({ kind: 'select', id: 'hd:60:0' });
    assert.deepEqual((await f.runtime.tokens!.load(() => undefined)).items, [token]);
    const catalogue = f.authority.getCatalogue()!;
    await f.authority.selectNetwork('base', f.authority.getSnapshot().revision, catalogue.revision);
    assert.deepEqual((await f.runtime.tokens!.load(() => undefined)).items, []);
    const base = f.authority.getCatalogue()!;
    await f.authority.selectNetwork('ethereum', f.authority.getSnapshot().revision, base.revision);
    assert.deepEqual((await f.runtime.tokens!.load(() => undefined)).items, [token]);
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});

test('token storage admission blocks account switching and lost commit acknowledgement quarantines runtime', async () => {
  const f = await readyAccounts();
  const token = { contractAddress: '0x1111111111111111111111111111111111111111', decimals: 18, name: 'Token', symbol: 'TOKEN' };
  try {
    await f.runtime.tokens!.load(() => undefined);
    let release!: () => void; let entered!: () => void;
    const holding = new Promise<void>((resolve) => { release = resolve; });
    const pending = new Promise<void>((resolve) => { entered = resolve; });
    f.disk.onRecord(async (kind, key) => { if (kind === 'get' && key === 'native-token-registry-v1') { entered(); await holding; } });
    const reading = f.runtime.tokens!.load(() => undefined); await pending;
    await assert.rejects(f.execute({ kind: 'create', label: 'Blocked', password: PASSWORD }), /BUSY/);
    release(); await reading; f.disk.onRecord();
    f.disk.loseNextAcknowledgement(); await assert.rejects(f.runtime.tokens!.add(0, token, () => undefined), /CLEANUP_FAILED/);
    assert.equal(f.runtime.catalogue.getSnapshot(), null);
    assert.equal(f.runtime.accounts!.getSnapshot(), null);
    assert.equal(f.runtime.networks!.getSelectedId(), null);
    const records = JSON.stringify([...f.disk.records]);
    await assert.rejects(f.runtime.backup.readPhrase(PASSWORD), /CLEANUP_FAILED|CANCELLED/);
    assert.equal(JSON.stringify([...f.disk.records]), records);
  } finally { await f.authority.dispose().catch(() => undefined); f.disk.restoreNetwork(); }
});
