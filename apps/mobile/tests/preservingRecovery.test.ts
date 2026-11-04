import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { HDNodeWallet, Wallet } from 'ethers/wallet';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import { createKeyringRuntimeFactory, type KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import { NativeRecoveryCoordinator } from '../src/custody/recovery.ts';
import { NativeRecoveryFlow } from '../src/custody/recoveryFlow.ts';
import { readRecoveryInventory } from '../src/custody/recoveryInventory.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import type { OpenWalletStorage } from '../src/storage/types.ts';
import { encodeStorageValue } from '../src/storage/json.ts';
import { NativeTransferJournal, nativeTransferJournalKey } from '../src/custody/transferJournal.ts';
import { WALLET_CATALOGUE_KEY } from '../src/custody/walletCatalogue.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import { ACTIVITY_STORAGE_KEY } from '../src/activity/historyStore.ts';
import { createActivityScope } from '../src/activity/types.ts';
import { NATIVE_TOKEN_REGISTRY_KEY } from '../src/portfolio/tokenRegistry.ts';
import { readPrivateVaultBundle, envelopeHash } from '../../../source/wallet/privateVaultInspection.ts';
import { digest, INSTALLATION, nodeConnection, validPair, type SqlHook } from './storageHelpers.ts';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const WRONG = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const OLD = 'PUBLIC old recovery password';
const NEXT = 'PUBLIC new recovery password';
const KEY = `0x${'11'.repeat(32)}`;
const KEY2 = `0x${'22'.repeat(32)}`;
const importedWallet = new Wallet(KEY);
const importedWallet2 = new Wallet(KEY2);
const sourceWallet = HDNodeWallet.fromPhrase(PHRASE, undefined, "m/44'/60'/0'/0/0");
const sdk = await import('@sidhujag/sysweb3-keyring/cjs/software.js');
process.env.NODE_ENV = 'production';
delete process.env.SYSWEB3_PBKDF2_ENC_ITERS;
delete process.env.SYSWEB3_PBKDF2_AUTH_ITERS;
let networkCalls = 0;
const originalFetch = globalThis.fetch;
test.before(() => { globalThis.fetch = (() => { networkCalls++; throw new Error('Network forbidden'); }) as typeof fetch; });
test.after(() => { globalThis.fetch = originalFetch; assert.equal(networkCalls, 0); });

function latch() {
  let release!: () => void, entered!: () => void;
  return { gate: new Promise<void>((resolve) => { release = resolve; }), reached: new Promise<void>((resolve) => { entered = resolve; }), release: () => release(), enter: () => entered() };
}
async function fixture(loadRuntimeSdk?: () => Promise<typeof sdk>, confirmed = true,
  clocks?: { wall: () => number; monotonic: () => number }) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-preserving-recovery-'));
  const file = path.join(directory, 'wallet.sqlite');
  let leased = false, initialized = false, opens = 0, retires = 0;
  let hook: SqlHook | undefined;
  let afterHook: SqlHook | undefined;
  const dispatched: string[] = [];
  let dispatchHook: ((sql: string) => void) | undefined;
  let failurePause: ReturnType<typeof latch> | undefined;
  let closeFailure = false;
  let runtime!: KeyringRuntime;
  let store!: SqliteWalletStorage;
  const open = async (): Promise<OpenWalletStorage> => {
    assert.equal(leased, false, 'old authority must release its database lease'); leased = true; opens++;
    const owned = nodeConnection(file, { before: (...args) => hook?.(...args), after: (...args) => afterHook?.(...args) });
    const exec = owned.connection.execAsync.bind(owned.connection);
    owned.connection.execAsync = (sql) => { dispatched.push(sql); dispatchHook?.(sql); return exec(sql); };
    try { store = await SqliteWalletStorage.open(owned.connection, digest, INSTALLATION, !initialized, clocks?.wall, clocks?.monotonic); initialized = true; }
    catch (error) { await owned.connection.closeAsync(); leased = false; throw error; }
    const local = store;
    const recovery = { ...store.recovery, async recordFailureForPair(fingerprint: string) {
      const pause = failurePause; failurePause = undefined;
      if (pause) { pause.enter(); await pause.gate; }
      await local.recovery.recordFailureForPair!(fingerprint);
    } };
    let closed = false;
    return { keyringStorage: local.keyringStorage, authGuard: local.authGuard, recovery,
      readState: () => local.readState(), getWalletFingerprint: () => local.getWalletFingerprint(), confirmBackup: (fp) => local.confirmBackup(fp),
      async close() { if (!closed) { await local.close(); if (closeFailure) throw new Error('synthetic close acknowledgement failure'); closed = true; leased = false; } } };
  };
  const factory = createKeyringRuntimeFactory({ ensureCryptoReady: async () => undefined, openStorage: open, loadSdk: loadRuntimeSdk });
  const newOwner = async () => {
    const authority = new NativeCustodyAuthority({ async open() { runtime = await factory.open() as KeyringRuntime; return runtime; } });
    await authority.initialize(); return authority;
  };
  let owner = await newOwner(); await owner.importPhrase(PHRASE, OLD);
  if (confirmed) { await runtime.backup.confirm(await runtime.backup.fingerprint()); await owner.refreshAuthenticatedMetadata(); }
  const coordinator = (loadSdk?: () => Promise<typeof sdk>, monotonicMilliseconds?: () => number) => new NativeRecoveryCoordinator({ owner,
    retireControllers() { retires++; }, ensureCryptoReady: async () => undefined, openStorage: open, loadSdk, monotonicMilliseconds: monotonicMilliseconds ?? clocks?.monotonic });
  const read = () => {
    const db = new DatabaseSync(file, { readOnly: true });
    try { return { records: db.prepare('SELECT * FROM keyring_records ORDER BY key').all() as { key: string; value: string }[],
      metadata: db.prepare('SELECT * FROM wallet_metadata ORDER BY key').all() as { key: string; value: string }[],
      notes: db.prepare('SELECT * FROM private_note_records ORDER BY profile_id').all() }; }
    finally { db.close(); }
  };
  const write = (key: string, value: unknown) => {
    const db = new DatabaseSync(file);
    try { db.prepare('INSERT OR REPLACE INTO keyring_records VALUES (?, ?)').run(key, encodeStorageValue(value)); } finally { db.close(); }
  };
  return { notes(profile: string, value: unknown, binding: string) { const db = new DatabaseSync(file); try { db.prepare('INSERT OR REPLACE INTO private_note_records VALUES (?, ?, ?)').run(profile, binding, JSON.stringify(value)); } finally { db.close(); } }, get owner() { return owner; }, get runtime() { return runtime; }, get store() { return store; }, open, read, write, coordinator,
    remove(key: string) { const db = new DatabaseSync(file); try { db.prepare('DELETE FROM keyring_records WHERE key = ?').run(key); } finally { db.close(); } },
    meta(key: string, value: unknown) {
      const db = new DatabaseSync(file);
      try { db.prepare('INSERT OR REPLACE INTO wallet_metadata VALUES (?, ?)').run(key, encodeStorageValue(value)); } finally { db.close(); }
    },
    get opens() { return opens; }, get retires() { return retires; }, get leased() { return leased; }, dispatched,
    failClose() { closeFailure = true; },
    setDispatch(value?: (sql: string) => void) { dispatchHook = value; },
    setHook(value?: SqlHook) { hook = value; }, setAfter(value?: SqlHook) { afterHook = value; }, pauseFailure(value: ReturnType<typeof latch>) { failurePause = value; },
    async reopen() { await owner.dispose(); owner = await newOwner(); return owner; },
    async close() { hook = undefined; afterHook = undefined; await owner.dispose().catch(() => undefined); if (leased) await store.close().catch(() => undefined); await rm(directory, { recursive: true, force: true }); } };
}
function retained(state: ReturnType<Awaited<ReturnType<typeof fixture>>['read']>) { return state.records.filter((row) => !['vault', 'vault-keys'].includes(row.key)); }

test('real SDK recovery preserves imported ciphertext, account IDs and three-chain signed bytes through repeated password changes', async () => {
  const f = await fixture(); let recovery: NativeRecoveryCoordinator | undefined;
  try {
    await f.owner.manageAccounts({ kind: 'create', label: 'Second HD', password: OLD }, f.owner.getSnapshot().revision, f.owner.getCatalogue()!.revision);
    await f.owner.importEvmAccount({ privateKey: KEY, expectedAddress: importedWallet.address, label: 'Imported private account' }, OLD, f.owner.getSnapshot().revision, f.owner.getCatalogue()!.revision);
    await f.owner.importEvmAccount({ privateKey: KEY2, expectedAddress: importedWallet2.address, label: 'Second imported account' }, OLD, f.owner.getSnapshot().revision, f.owner.getCatalogue()!.revision);
    await f.owner.manageAccounts({ kind: 'select', id: 'imported:60:1' }, f.owner.getSnapshot().revision, f.owner.getCatalogue()!.revision);
    const fingerprint = await f.store.getWalletFingerprint();
    const ethereum = getNativeNetwork('ethereum'), activityScope = createActivityScope(fingerprint, 'imported:60:1', importedWallet2.address, 'ethereum');
    f.write(NATIVE_TOKEN_REGISTRY_KEY, { version: 1, revision: 0, walletFingerprint: fingerprint, entries: [{ accountId: 'imported:60:1', address: importedWallet2.address,
      network: 'ethereum', chainId: '1', registrationHash: ethereum.registrationHash,
      metadata: { contractAddress: importedWallet.address, name: 'Public fixture token', symbol: 'FIX', decimals: 19 } }] });
    f.write(ACTIVITY_STORAGE_KEY, { version: 1, revision: 0, walletFingerprint: fingerprint, truncated: false, archived: [],
      cached: [{ sourceId: activityScope.sourceId, scopeKey: activityScope.key, candidates: [{ hash: `0x${'a'.repeat(64)}`, blockNumber: '1', timestamp: 1, tokenHint: false }] }],
      views: [{ sourceId: activityScope.sourceId, view: { filter: 'sent', showZero: false, anchor: null, offset: 7 } }] });
    for (const id of ['ethereum', 'syscoin-nevm-testnet', 'zksys-testnet']) {
      const network = getNativeNetwork(id);
      const journal = new NativeTransferJournal(f.store.keyringStorage, { walletFingerprint: fingerprint, address: sourceWallet.address, chainId: network.chainId }, () => undefined, () => 1000, 0, network);
      const raw = await sourceWallet.signTransaction({ type: 2, chainId: Number(network.chainId), nonce: 0, to: importedWallet.address, value: 1n, gasLimit: 21000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n });
      await journal.saveSigned(raw);
    }
    const inventory = await readRecoveryInventory(f.store);
    assert.equal(inventory.status, 'needs-matching-phrase-verification', JSON.stringify({ inventory, keys: f.read().records.map((r) => r.key) }));
    const before = f.read(); f.owner.lock(); recovery = f.coordinator();
    const proof = await recovery.prepare(PHRASE, NEXT, () => undefined);
    assert.deepEqual(Object.keys(proof), []); assert.equal(f.owner.getSnapshot().phase, 'disposed'); assert.equal(f.retires, 1);
    assert.deepEqual(f.read(), before, 'preparation must not mutate live records');
    await assert.rejects(recovery.commit({}), { code: 'STATE_CHANGED' });
    assert.equal(await recovery.commit(proof), 'committed-locked');
    await assert.rejects(recovery.commit(proof), { code: 'STATE_CHANGED' });
    assert.deepEqual(retained(f.read()), retained(before));
    await f.reopen();
    assert.equal((await f.store.recovery.readIdentity())?.walletBindingId, fingerprint);
    assert.notEqual(await f.store.getWalletFingerprint(), fingerprint);
    await assert.rejects(f.owner.unlock(OLD));
    await f.owner.unlock(NEXT); assert.equal(f.owner.getSnapshot().phase, 'ready');
    assert.equal(f.owner.getCatalogue()!.accounts.length, 4);
    assert.equal(f.owner.getCatalogue()!.active.accountId, 'imported:60:1');
    assert.equal((await f.runtime.tokens!.load(() => undefined)).items.length, 1);
    const activity = await f.runtime.activity!.load(() => undefined);
    assert.equal(activity.saved.candidates.length, 1); assert.equal(activity.saved.view.filter, 'sent');
    assert.equal(await f.runtime.keyExport!.readSelected({ authorityRevision: f.owner.getSnapshot().revision, catalogueRevision: f.owner.getCatalogue()!.revision,
      accountId: 'imported:60:1', index: 1, address: importedWallet2.address, networkId: 'ethereum', registrationHash: ethereum.registrationHash }, NEXT, () => undefined), KEY2);
    const rootBinding = await f.store.recovery.readIdentity(); assert.equal(rootBinding?.root?.address, sourceWallet.address);
    f.owner.lock(); await recovery.dispose(); recovery = f.coordinator();
    const again = await recovery.prepare(PHRASE, `${NEXT} again`, () => undefined); await recovery.commit(again);
    assert.deepEqual(retained(f.read()), retained(before));
    await f.reopen(); await f.owner.unlock(`${NEXT} again`);
    assert.equal((await f.store.recovery.readIdentity())?.walletBindingId, fingerprint);
    assert.equal(f.owner.getSnapshot().phase, 'ready');
  } finally { await recovery?.dispose(); await f.close(); }
});

test('known wrong-root failure is charged once even when its request is cancelled before accounting finishes', async () => {
  const f = await fixture(); const pause = latch(); f.pauseFailure(pause); f.owner.lock(); const recovery = f.coordinator();
  try {
    const before = f.read(); const pending = recovery.prepare(WRONG, NEXT, () => undefined);
    await pause.reached; recovery.cancel(); pause.release();
    await assert.rejects(pending, { code: 'CANCELLED' });
    assert.deepEqual(f.read().records, before.records);
    const auth = JSON.parse(f.read().metadata.find((row) => row.key === 'auth')!.value);
    assert.equal(auth.failures, 1);
  } finally { pause.release(); await recovery.dispose(); await f.close(); }
});

test('malformed input and a forged private envelope do not count as a wrong phrase or modify records', async () => {
  const f = await fixture(); let recovery: NativeRecoveryCoordinator | undefined;
  try {
    await f.owner.importEvmAccount({ privateKey: KEY, expectedAddress: importedWallet.address, label: 'Imported' }, OLD, f.owner.getSnapshot().revision, f.owner.getCatalogue()!.revision);
    f.owner.lock(); recovery = f.coordinator();
    const before = f.read(); await assert.rejects(recovery.prepare('not a phrase', NEXT, () => undefined), { code: 'INVALID_INPUT' });
    assert.deepEqual(f.read(), before);
    const catalogue = JSON.parse(before.records.find((row) => row.key === WALLET_CATALOGUE_KEY)!.value);
    const envelope = catalogue.importedAccounts[0].envelope;
    envelope.ciphertext = (envelope.ciphertext[0] === 'A' ? 'B' : 'A') + envelope.ciphertext.slice(1);
    f.write(WALLET_CATALOGUE_KEY, catalogue); const corrupt = f.read();
    await assert.rejects(recovery.prepare(PHRASE, NEXT, () => undefined), { code: 'INVALID_SAVED_DATA' });
    assert.deepEqual(f.read(), corrupt);
  } finally { await recovery?.dispose(); await f.close(); }
});

test('late successful staging after cancel is discarded without replacing the pair', async () => {
  const f = await fixture(); const pause = latch(); f.owner.lock();
  class Delayed extends sdk.SoftwareKeyring {
    constructor(...args: ConstructorParameters<typeof sdk.SoftwareKeyring>) {
      super(...args); const original = this.createFirstAccount;
      this.createFirstAccount = async () => { const result = await original(); pause.enter(); await pause.gate; return result; };
    }
  }
  const recovery = f.coordinator(async () => ({ ...sdk, SoftwareKeyring: Delayed }));
  try {
    const before = f.read(); const pending = recovery.prepare(PHRASE, NEXT, () => undefined);
    await pause.reached; recovery.cancel(); pause.release(); await assert.rejects(pending, { code: 'CANCELLED' });
    assert.deepEqual(f.read(), before);
  } finally { pause.release(); await recovery.dispose(); await f.close(); }
});

for (const fault of ['before-write', 'commit-not-applied', 'commit-applied'] as const) {
  test(`recovery ${fault} has one complete old/new state and never compensates by deletion`, async () => {
    const f = await fixture(); f.owner.lock(); const recovery = f.coordinator();
    try {
      const before = f.read(), proof = await recovery.prepare(PHRASE, NEXT, () => undefined); let injected = false;
      const fail = (_kind: unknown, sql: string) => {
        if (!injected && (fault === 'before-write' ? sql.startsWith('UPDATE keyring_records') : sql === 'COMMIT')) { injected = true; throw new Error('Injected commit fault'); }
      };
      if (fault === 'commit-applied') f.setAfter(fail); else f.setHook(fail);
      if (fault === 'commit-applied') assert.equal(await recovery.commit(proof), 'committed-locked');
      else await assert.rejects(recovery.commit(proof));
      f.setHook(); f.setAfter(); assert.equal(injected, true);
      assert.deepEqual(retained(f.read()), retained(before));
      if (fault !== 'commit-applied') assert.deepEqual(f.read(), before);
      await f.reopen(); await f.owner.unlock(fault === 'commit-applied' ? NEXT : OLD);
      assert.equal(f.owner.getSnapshot().phase, 'ready');
    } finally { f.setHook(); f.setAfter(); await recovery.dispose(); await f.close(); }
  });
}

test('changed snapshot and unknown data refuse replacement without overwriting the competing row', async () => {
  const f = await fixture(); f.owner.lock(); const recovery = f.coordinator();
  try {
    const before = f.read(), proof = await recovery.prepare(PHRASE, NEXT, () => undefined);
    const catalogue = JSON.parse(before.records.find((row) => row.key === WALLET_CATALOGUE_KEY)!.value);
    catalogue.accounts[0].label = 'Changed elsewhere'; f.write(WALLET_CATALOGUE_KEY, catalogue);
    const changed = f.read(); await assert.rejects(recovery.commit(proof), { code: 'STATE_CHANGED' }); assert.deepEqual(f.read(), changed);
    f.write('unsupported-private-note-domain', {}); const unknown = f.read();
    await assert.rejects(recovery.prepare(PHRASE, NEXT, () => undefined), { code: 'INVALID_SAVED_DATA' }); assert.deepEqual(f.read(), unknown);
  } finally { await recovery.dispose(); await f.close(); }
});

test('a pending retired imported journal without its private envelope blocks preservation', async () => {
  const f = await fixture(); let recovery: NativeRecoveryCoordinator | undefined;
  try {
    const before = f.read(), catalogue = JSON.parse(before.records.find((row) => row.key === WALLET_CATALOGUE_KEY)!.value);
    catalogue.nextImportedIndex = 1; catalogue.retiredImportedIndices = [0]; f.write(WALLET_CATALOGUE_KEY, catalogue);
    const network = getNativeNetwork('ethereum'), fingerprint = await f.store.getWalletFingerprint();
    const raw = await importedWallet.signTransaction({ type: 2, chainId: 1, nonce: 0, to: sourceWallet.address, value: 1n, gasLimit: 21000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n });
    const journal = new NativeTransferJournal(f.store.keyringStorage, { walletFingerprint: fingerprint, address: importedWallet.address, chainId: '1' }, () => undefined, () => 1000, 0, network, undefined, 'Imported');
    await journal.saveSigned(raw); f.owner.lock(); recovery = f.coordinator(); const state = f.read();
    await assert.rejects(recovery.prepare(PHRASE, NEXT, () => undefined), { code: 'INVALID_SAVED_DATA' }); assert.deepEqual(f.read(), state);
    assert.ok(state.records.find((row) => row.key === nativeTransferJournalKey(0, 'Imported')));
  } finally { await recovery?.dispose(); await f.close(); }
});

test('recovery waits for a locked old owner to drain an already running real SDK unlock', async () => {
  const pause = latch(); let hold = false;
  class DelayedUnlock extends sdk.SoftwareKeyring {
    async unlock(password: string) {
      const result = await super.unlock(password);
      if (hold) { pause.enter(); await pause.gate; }
      return result;
    }
  }
  const f = await fixture(async () => ({ ...sdk, SoftwareKeyring: DelayedUnlock }));
  f.owner.lock(); hold = true;
  const oldUnlock = f.owner.unlock(OLD).catch((error) => error);
  await pause.reached; f.owner.lock(); const recovery = f.coordinator();
  try {
    const pending = recovery.prepare(PHRASE, NEXT, () => undefined);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(f.opens, 1, 'recovery cannot acquire the old lease early');
    hold = false; pause.release(); await oldUnlock;
    const proof = await pending; assert.equal(f.opens, 2);
    await recovery.commit(proof); await f.reopen(); await f.owner.unlock(NEXT);
    assert.equal(f.owner.getSnapshot().phase, 'ready');
  } finally { pause.release(); await recovery.dispose(); await f.close(); }
});

for (const boundary of ['write', 'committed'] as const) {
  test(`cancellation at ${boundary} discards completion while preserving an atomic old or new state`, async () => {
    const f = await fixture(); f.owner.lock(); const recovery = f.coordinator(); const pause = latch();
    try {
      const before = f.read(), proof = await recovery.prepare(PHRASE, NEXT, () => undefined); let held = false;
      const pauseOnce: SqlHook = async (_kind, sql) => {
        if (!held && (boundary === 'write' ? sql.startsWith('UPDATE keyring_records') : sql === 'COMMIT')) { held = true; pause.enter(); await pause.gate; }
      };
      if (boundary === 'write') f.setHook(pauseOnce); else f.setAfter(pauseOnce);
      const pending = recovery.commit(proof); await pause.reached;
      recovery.cancel(); pause.release(); await assert.rejects(pending, { code: 'CANCELLED' });
      f.setHook(); f.setAfter();
      assert.deepEqual(retained(f.read()), retained(before));
      if (boundary === 'write') assert.deepEqual(f.read(), before);
      await f.reopen(); await f.owner.unlock(boundary === 'write' ? OLD : NEXT);
      assert.equal(f.owner.getSnapshot().phase, 'ready');
    } finally { pause.release(); f.setHook(); f.setAfter(); await recovery.dispose(); await f.close(); }
  });
}

test('normal unlock verifies the declared profile and stale data operations reject a changed pair with the same binding', async () => {
  const f = await fixture(); f.owner.lock(); const recovery = f.coordinator();
  try {
    const proof = await recovery.prepare(PHRASE, NEXT, () => undefined); await recovery.commit(proof);
    await f.reopen(); await f.owner.unlock(NEXT);
    const identity = (await f.store.recovery.readIdentity())!;
    const before = await f.store.recovery.readSnapshot(), pair = validPair(77);
    const write = await f.store.recovery.prepareReplacement!(before, { vault: pair.vault, keys: pair['vault-keys'] }, identity.root!);
    await f.store.recovery.commitReplacement!(write, () => undefined);
    await assert.rejects(f.runtime.tokens!.load(() => undefined), { code: 'CANCELLED' });
  } finally { await recovery.dispose(); await f.close(); }

  const g = await fixture();
  try {
    const identity = await g.store.recovery.readIdentity();
    const catalogue = JSON.parse(g.read().records.find((row) => row.key === WALLET_CATALOGUE_KEY)!.value);
    g.meta('identity', { version: 1, walletBindingId: identity!.walletBindingId, pairFingerprint: identity!.pairFingerprint,
      root: { address: catalogue.accounts[0].address, publicKey: catalogue.accounts[0].publicKey, profileId: `0x${'f'.repeat(64)}` } });
    g.owner.lock(); await assert.rejects(g.owner.unlock(OLD));
    assert.equal(g.owner.getSnapshot().phase, 'locked');
    await assert.rejects(g.runtime.transfers!.journal(() => undefined));
  } finally { await g.close(); }
});

test('operational SDK failure is sanitized and never charged as a wrong phrase', async () => {
  const f = await fixture(); f.owner.lock();
  class Failed extends sdk.SoftwareKeyring {
    constructor(...args: ConstructorParameters<typeof sdk.SoftwareKeyring>) { super(...args); this.createFirstAccount = async () => { throw new Error('private diagnostic must not escape'); }; }
  }
  const recovery = f.coordinator(async () => ({ ...sdk, SoftwareKeyring: Failed }));
  try {
    const before = f.read(); await assert.rejects(recovery.prepare(PHRASE, NEXT, () => undefined), { code: 'UNAVAILABLE', message: 'UNAVAILABLE' });
    assert.deepEqual(f.read(), before);
  } finally { await recovery.dispose(); await f.close(); }
});

test('five wrong phrases retain throttling and successful recovery does not invent an unconfirmed backup', async () => {
  const f = await fixture(undefined, false); f.owner.lock(); const recovery = f.coordinator();
  try {
    for (let i = 0; i < 5; i++) await assert.rejects(recovery.prepare(WRONG, NEXT, () => undefined), { code: 'WRONG_PHRASE' });
    await assert.rejects(recovery.prepare(PHRASE, NEXT, () => undefined), { code: 'AUTH_THROTTLED' });
    assert.equal(JSON.parse(f.read().metadata.find((row) => row.key === 'auth')!.value).failures, 5);
  } finally { await recovery.dispose(); await f.close(); }

  const g = await fixture(undefined, false); g.owner.lock(); const unconfirmed = g.coordinator();
  try {
    const proof = await unconfirmed.prepare(PHRASE, NEXT, () => undefined); await unconfirmed.commit(proof);
    await g.reopen(); await g.owner.unlock(NEXT);
    assert.equal(g.owner.getSnapshot().phase, 'backup-required');
    assert.equal(g.read().metadata.some((row) => row.key === 'backup'), false);
  } finally { await unconfirmed.dispose(); await g.close(); }
});

test('missing required vault keys refuse recovery without recreating or erasing the remaining data', async () => {
  const f = await fixture(); f.owner.lock(); f.remove('vault-keys'); const recovery = f.coordinator();
  try {
    const before = f.read(); await assert.rejects(recovery.prepare(PHRASE, NEXT, () => undefined), { code: 'UNAVAILABLE' });
    assert.deepEqual(f.read(), before);
  } finally { await recovery.dispose(); await f.close(); }
});

test('recovery retry cooldown elapses on the owned connection despite wall-clock changes', async () => {
  let monotonic = 0, wall = 1_000_000;
  const f = await fixture(undefined, false, { wall: () => wall, monotonic: () => monotonic });
  f.owner.lock(); const recovery = f.coordinator();
  try {
    for (let i = 0; i < 5; i++) await assert.rejects(recovery.prepare(WRONG, NEXT, () => undefined), { code: 'WRONG_PHRASE' });
    const saved = f.read(); monotonic = 29999; wall += 86400000;
    await assert.rejects(recovery.prepare(PHRASE, NEXT, () => undefined), { code: 'AUTH_THROTTLED' });
    assert.deepEqual(f.read(), saved);
    assert.equal(f.opens, 2, 'retryable attempts must retain one recovery-owned connection');
    monotonic = 30000; wall = 1;
    const proof = await recovery.prepare(PHRASE, NEXT, () => undefined);
    await recovery.commit(proof); await f.reopen(); await f.owner.unlock(NEXT);
    assert.equal(f.owner.getSnapshot().phase, 'backup-required');
    assert.equal(JSON.parse(f.read().metadata.find((row) => row.key === 'auth')!.value).failures, 0);
  } finally { await recovery.dispose(); await f.close(); }
});

test('recovery can wait out failures inherited from ordinary password authentication', async () => {
  let monotonic = 0;
  const f = await fixture(undefined, true, { wall: () => 1_000_000, monotonic: () => monotonic });
  f.owner.lock(); let recovery: NativeRecoveryCoordinator | undefined;
  try {
    for (let i = 0; i < 5; i++) await assert.rejects(f.owner.unlock('PUBLIC incorrect password'), { code: 'INVALID_CREDENTIAL' });
    recovery = f.coordinator();
    await assert.rejects(recovery.prepare(PHRASE, NEXT, () => undefined), { code: 'AUTH_THROTTLED' });
    monotonic = 29999;
    await assert.rejects(recovery.prepare(PHRASE, NEXT, () => undefined), { code: 'AUTH_THROTTLED' });
    assert.equal(f.opens, 2);
    monotonic = 30000; const proof = await recovery.prepare(PHRASE, NEXT, () => undefined);
    await recovery.commit(proof); await f.reopen(); await f.owner.unlock(NEXT);
    assert.equal(f.owner.getSnapshot().phase, 'ready');
  } finally { await recovery?.dispose(); await f.close(); }
});

test('another wrong phrase after waiting preserves escalation and cannot reset the throttle', async () => {
  let monotonic = 0;
  const f = await fixture(undefined, true, { wall: () => 1_000_000, monotonic: () => monotonic });
  f.owner.lock(); const recovery = f.coordinator();
  try {
    for (let i = 0; i < 5; i++) await assert.rejects(recovery.prepare(WRONG, NEXT, () => undefined), { code: 'WRONG_PHRASE' });
    monotonic = 30000;
    await assert.rejects(recovery.prepare(WRONG, NEXT, () => undefined), { code: 'WRONG_PHRASE' });
    const saved = f.read(); assert.equal(JSON.parse(saved.metadata.find((row) => row.key === 'auth')!.value).failures, 6);
    monotonic = 89999;
    await assert.rejects(recovery.prepare(PHRASE, NEXT, () => undefined), { code: 'AUTH_THROTTLED' });
    assert.deepEqual(f.read(), saved); assert.equal(f.opens, 2);
    monotonic = 90000; const proof = await recovery.prepare(PHRASE, NEXT, () => undefined);
    await recovery.commit(proof);
  } finally { await recovery.dispose(); await f.close(); }
});

test('cancel drains a retained recovery connection and a fresh owner still enforces restart cooldown', async () => {
  let monotonic = 0;
  const f = await fixture(undefined, true, { wall: () => 1_000_000, monotonic: () => monotonic });
  f.owner.lock(); const recovery = f.coordinator();
  try {
    for (let i = 0; i < 5; i++) await assert.rejects(recovery.prepare(WRONG, NEXT, () => undefined), { code: 'WRONG_PHRASE' });
    assert.equal(f.leased, true); const before = f.read();
    recovery.cancel(); await recovery.dispose(); assert.equal(f.leased, false); assert.deepEqual(f.read(), before);
    await f.reopen(); await assert.rejects(f.owner.unlock(OLD), { code: 'AUTH_THROTTLED' });
    monotonic = 30000; await f.owner.unlock(OLD); assert.equal(f.owner.getSnapshot().phase, 'ready');
  } finally { await recovery.dispose(); await f.close(); }
});

test('expiry closes a retryable recovery lease without another submission', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let monotonic = 0;
  const f = await fixture(undefined, true, { wall: () => 1_000_000, monotonic: () => monotonic });
  f.owner.lock(); const recovery = f.coordinator();
  try {
    await assert.rejects(recovery.prepare(WRONG, NEXT, () => undefined), { code: 'WRONG_PHRASE' });
    assert.equal(f.leased, true); const before = f.read();
    monotonic = 600001; context.mock.timers.tick(600001);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(f.leased, false); assert.deepEqual(f.read(), before);
  } finally { await recovery.dispose(); await f.close(); context.mock.timers.reset(); }
});

test('retained recovery close failure quarantines retries without changing saved bytes', async () => {
  const f = await fixture(); f.owner.lock(); const recovery = f.coordinator();
  try {
    await assert.rejects(recovery.prepare(WRONG, NEXT, () => undefined), { code: 'WRONG_PHRASE' });
    const before = f.read(); f.failClose(); recovery.cancel();
    await assert.rejects(recovery.dispose(), { code: 'REOPEN_REQUIRED' });
    await assert.rejects(recovery.prepare(PHRASE, NEXT, () => undefined), { code: 'NOT_READY' });
    assert.deepEqual(f.read(), before); assert.equal(f.opens, 2);
  } finally { await recovery.dispose().catch(() => undefined); await f.close(); }
});

test('an old recovery coordinator cannot charge or replace a newer recovered pair', async () => {
  const f = await fixture(); f.owner.lock(); const old = f.coordinator(); let next: NativeRecoveryCoordinator | undefined;
  try {
    await assert.rejects(old.prepare(WRONG, NEXT, () => undefined), { code: 'WRONG_PHRASE' });
    old.cancel(); await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(f.leased, false);
    await f.reopen(); next = f.coordinator();
    await next.commit(await next.prepare(PHRASE, NEXT, () => undefined));
    const committed = f.read();
    await assert.rejects(old.prepare(PHRASE, `${NEXT} stale`, () => undefined), { code: 'STATE_CHANGED' });
    assert.deepEqual(f.read(), committed);
  } finally { await old.dispose(); await next?.dispose(); await f.close(); }
});

test('a reentrant cancellation from the final commit guard rolls back before COMMIT', async () => {
  const f = await fixture(); f.owner.lock(); const recovery = f.coordinator();
  let metadataWrites = 0, finalChecks = 0, cancelled = false;
  const guard = () => {
    if (metadataWrites === 3 && ++finalChecks === 2) { cancelled = true; recovery.cancel(); }
  };
  try {
    const before = f.read(), proof = await recovery.prepare(PHRASE, NEXT, guard);
    f.setAfter((_kind, sql) => { if (sql.startsWith('INSERT INTO wallet_metadata')) metadataWrites++; });
    await assert.rejects(recovery.commit(proof), { code: 'CANCELLED' });
    assert.equal(cancelled, true);
    assert.deepEqual(f.read(), before);
  } finally { f.setAfter(); await recovery.dispose(); await f.close(); }
});

for (const boundary of ['cancellation', 'expiry'] as const) {
  test(`microtask ${boundary} after the operation guard stops before COMMIT dispatch`, async () => {
    const f = await fixture(); f.owner.lock(); let time = 0;
    const recovery = f.coordinator(undefined, () => time);
    let metadataWrites = 0, queued = false, revoked = false;
    const guard = () => {
      if (metadataWrites === 3 && !queued) {
        queued = true;
        queueMicrotask(() => { revoked = true; if (boundary === 'cancellation') recovery.cancel(); else time = 600001; });
      }
    };
    try {
      const before = f.read(), proof = await recovery.prepare(PHRASE, NEXT, guard);
      f.dispatched.length = 0;
      f.setAfter((_kind, sql) => { if (sql.startsWith('INSERT INTO wallet_metadata')) metadataWrites++; });
      await assert.rejects(recovery.commit(proof), { code: 'CANCELLED' });
      assert.equal(revoked, true);
      assert.equal(f.dispatched.includes('COMMIT'), false, 'revoked recovery must not dispatch a commit');
      assert.equal(f.dispatched.includes('ROLLBACK'), true);
      assert.deepEqual(f.read(), before);
    } finally { f.setAfter(); await recovery.dispose(); await f.close(); }
  });
}

test('cancellation after COMMIT dispatch reconciles the complete new pair without compensation', async () => {
  const f = await fixture(); f.owner.lock(); const recovery = f.coordinator();
  let queued = false;
  try {
    const before = f.read(), proof = await recovery.prepare(PHRASE, NEXT, () => undefined);
    f.dispatched.length = 0;
    f.setDispatch((sql) => { if (sql === 'COMMIT' && !queued) { queued = true; queueMicrotask(() => recovery.cancel()); } });
    await assert.rejects(recovery.commit(proof), { code: 'CANCELLED' });
    f.setDispatch();
    assert.equal(queued, true);
    assert.equal(f.dispatched.filter((sql) => sql === 'COMMIT').length, 1);
    assert.deepEqual(retained(f.read()), retained(before));
    assert.notDeepEqual(f.read().records.filter((row) => ['vault', 'vault-keys'].includes(row.key)),
      before.records.filter((row) => ['vault', 'vault-keys'].includes(row.key)));
    await f.reopen(); await f.owner.unlock(NEXT);
    assert.equal(f.owner.getSnapshot().phase, 'ready');
  } finally { f.setDispatch(); await recovery.dispose(); await f.close(); }
});

test('cancellation before the first snapshot cannot let an old helper adopt a newer pair', async () => {
  const f = await fixture(); f.owner.lock(); const old = f.coordinator();
  let next: NativeRecoveryCoordinator | undefined, cancelled = false;
  try {
    f.setAfter((_kind, sql) => {
      if (!cancelled && sql.includes('ORDER BY source, key LIMIT 70')) { cancelled = true; old.cancel(); }
    });
    await assert.rejects(old.prepare(PHRASE, NEXT, () => undefined), { code: 'CANCELLED' });
    f.setAfter(); assert.equal(cancelled, true);
    await f.reopen(); next = f.coordinator();
    await next.commit(await next.prepare(PHRASE, NEXT, () => undefined));
    const newer = f.read();
    await assert.rejects(old.prepare(PHRASE, `${NEXT} stale`, () => undefined), { code: 'STATE_CHANGED' });
    assert.deepEqual(f.read(), newer);
  } finally { f.setAfter(); await old.dispose(); await next?.dispose(); await f.close(); }
});

test('the first in-flight recovery retains its original pair across retirement and a newer recovery', async () => {
  const f = await fixture(); f.owner.lock(); const pause = latch();
  const old = new NativeRecoveryCoordinator({ owner: f.owner, retireControllers() {}, openStorage: f.open,
    ensureCryptoReady: async () => { pause.enter(); await pause.gate; } });
  let next: NativeRecoveryCoordinator | undefined;
  try {
    const pending = old.prepare(PHRASE, `${NEXT} stale`, () => undefined);
    await pause.reached;
    await f.reopen(); next = f.coordinator();
    await next.commit(await next.prepare(PHRASE, NEXT, () => undefined));
    const newer = f.read(); pause.release();
    await assert.rejects(pending, { code: 'STATE_CHANGED' });
    assert.deepEqual(f.read(), newer);
    await f.reopen(); await f.owner.unlock(NEXT);
    assert.equal(f.owner.getSnapshot().phase, 'ready');
  } finally { pause.release(); await old.dispose(); await next?.dispose(); await f.close(); }
});

test('original-pair capture drains runtime work outside authority pending before releasing its lease', async () => {
  const pause = latch(); let hold = false;
  class DelayedPhrase extends sdk.SoftwareKeyring {
    constructor(...args: ConstructorParameters<typeof sdk.SoftwareKeyring>) {
      super(...args); const read = this.getSeed.bind(this);
      this.getSeed = async (password) => { const phrase = await read(password); if (hold) { pause.enter(); await pause.gate; } return phrase; };
    }
  }
  const f = await fixture(async () => ({ ...sdk, SoftwareKeyring: DelayedPhrase }));
  const original = await f.store.getWalletFingerprint(); hold = true;
  const reading = f.runtime.backup!.readPhrase(OLD).catch((error: unknown) => error);
  await pause.reached;
  const owned = f.store, readPair = owned.getWalletFingerprint.bind(owned); let captures = 0;
  owned.getWalletFingerprint = async () => { captures++; assert.equal(hold, false); assert.equal(f.opens, 1); const pair = await readPair(); assert.equal(pair, original); return pair; };
  f.owner.lock(); const recovery = f.coordinator();
  try {
    const pending = recovery.prepare(PHRASE, NEXT, () => undefined);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(captures, 0); assert.equal(f.opens, 1);
    await assert.rejects(f.open(), /old authority must release its database lease/);
    hold = false; pause.release();
    assert.ok(await reading instanceof Error, 'the retired reader cannot disclose its phrase');
    const proof = await pending; assert.equal(captures, 1); assert.equal(f.opens, 2);
    await recovery.commit(proof); await f.reopen(); await f.owner.unlock(NEXT);
    assert.equal(f.owner.getSnapshot().phase, 'ready');
  } finally { hold = false; pause.release(); await recovery.dispose(); await f.close(); }
});

test('failure to capture the original pair still closes its lease and returns no recovery proof', async () => {
  const f = await fixture(); f.owner.lock(); const recovery = f.coordinator();
  const before = f.read();
  f.store.getWalletFingerprint = async () => { throw Error('private capture diagnostic'); };
  try {
    await assert.rejects(recovery.prepare(PHRASE, NEXT, () => undefined), { code: 'UNAVAILABLE', message: 'UNAVAILABLE' });
    assert.deepEqual(f.read(), before);
    // A failed retirement remains failed; a fresh owner must qualify a new lease.
    const replacement = new NativeCustodyAuthority(createKeyringRuntimeFactory({ ensureCryptoReady: async () => undefined, openStorage: f.open }));
    try { await replacement.initialize(); await replacement.unlock(OLD); assert.equal(replacement.getSnapshot().phase, 'ready'); }
    finally { await replacement.dispose(); }
  } finally { await recovery.dispose(); await f.close(); }
});

test('recovery view model drives the real SDK and SQLite coordinator then requires explicit fresh-owner unlock', async () => {
  const f = await fixture(); f.owner.lock(); let coordinator: NativeRecoveryCoordinator | undefined;
  const before = f.read(); let completed = false;
  const flow = new NativeRecoveryFlow({
    readInventory: () => readRecoveryInventory(f.store), isCurrent: () => true,
    createCoordinator() { coordinator = f.coordinator(); return coordinator; },
    async finish(outcome) {
      assert.equal(outcome.kind, 'success');
      await coordinator!.dispose(); await f.owner.dispose(); await f.reopen();
      assert.equal(f.owner.getSnapshot().phase, 'locked'); completed = true;
    },
  });
  const waitFor = async (condition: () => boolean) => {
    const deadline = performance.now() + 20000;
    while (!condition() && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
    assert(condition(), `unexpected recovery phase: ${flow.getSnapshot().phase}`);
  };
  try {
    flow.start(); await waitFor(() => flow.getSnapshot().phase === 'scope'); flow.enter();
    assert.equal(flow.submit({ phrase: PHRASE, password: NEXT, confirmation: NEXT }), true);
    await waitFor(() => flow.getSnapshot().phase === 'review');
    assert.equal(f.owner.getSnapshot().phase, 'disposed'); assert.deepEqual(f.read(), before);
    assert(!JSON.stringify(flow.getSnapshot()).includes(PHRASE)); assert(!JSON.stringify(flow.getSnapshot()).includes(NEXT));
    flow.commit(); await waitFor(() => completed && flow.getSnapshot().phase === 'closed');
    assert.deepEqual(retained(f.read()), retained(before));
    await assert.rejects(f.owner.unlock(OLD)); await f.owner.unlock(NEXT);
    assert.equal(f.owner.getSnapshot().phase, 'ready');
  } finally { flow.cancel(); await coordinator?.dispose(); await f.close(); }
});

/** Synthetic bearer notes only; real released SDK encryption, no private SDK fields. */
async function noteBundle(count = 17) {
  const values = new Map<string, unknown>();
  const keyring = new sdk.SoftwareKeyring(sdk.createSoftwareKeyringHost({
    async get(key) { return values.get(key); }, async set(key, value) { values.set(key, value); }, async deleteItem(key) { values.delete(key); },
    async createManyIfAbsent(items) { if (Object.keys(items).some((key) => values.has(key))) return false; Object.entries(items).forEach(([k, v]) => values.set(k, v)); return true; },
  }));
  await keyring.initializeSession(PHRASE, OLD);
  const profile = await keyring.getPrivateRecordProfileId(); let seq = 0;
  const id = () => `00000000-0000-4000-8000-${(++seq).toString().padStart(12, '0')}`;
  const notes = Array.from({ length: count }, (_, i) => ({ id: id(), createdAt: 1, note: `tornado-eth-1-1-0x${(i + 1).toString(16).padStart(124, '0')}` }));
  const shards = [];
  for (let i = 0; i < notes.length; i += 16) shards.push(await keyring.encryptPrivateRecord({ domain: 'org.syscoin.pali.privacy.notes.shard.v2', recordId: id(), plaintext: new TextEncoder().encode(JSON.stringify({ version: 1, notes: notes.slice(i, i + 16) })) }));
  if (!shards.length) shards.push(await keyring.encryptPrivateRecord({ domain: 'org.syscoin.pali.privacy.notes.shard.v2', recordId: id(), plaintext: new TextEncoder().encode(JSON.stringify({ version: 1, notes: [] })) }));
  const root = await keyring.encryptPrivateRecord({ domain: 'org.syscoin.pali.privacy.notes.v1', recordId: id(), plaintext: new TextEncoder().encode(JSON.stringify({
    format: 'pali-private-note-vault', version: 1, noteCount: count, capacity: count > 128 ? 512 : 128, restore: { version: 1 },
    shards: shards.map((shard, i) => ({ recordId: shard.recordId, hash: envelopeHash(shard), count: Math.min(16, count - i * 16) })),
  })) });
  return { keyring, profile, bundle: { format: 'pali-private-note-vault', version: 1, root, shards } };
}

test('realSDK multi-shard note domain survives password recovery byte-for-byte alongside existing records', async () => {
  const f = await fixture(), data = await noteBundle(); let recovery: NativeRecoveryCoordinator | undefined;
  try {
    f.notes(data.profile, data.bundle, await f.store.getWalletFingerprint());
    const original = f.read(); const inventory = await readRecoveryInventory(f.store);
    assert.equal(inventory.privateNotes, 'requires-matching-phrase-verification');
    assert.equal(JSON.stringify(inventory).includes(data.profile), false);
    f.owner.lock(); recovery = f.coordinator(); const proof = await recovery.prepare(PHRASE, NEXT, () => undefined);
    assert.equal(await recovery.commit(proof), 'committed-locked');
    assert.deepEqual(f.read().notes, original.notes); assert.deepEqual(retained(f.read()), retained(original));
    await f.reopen(); await f.owner.unlock(NEXT);
    const result = await readPrivateVaultBundle(data.bundle, { keyring: data.keyring, generation: 1, assertCurrent() {} });
    assert.equal(result.manifest.notes.length, 17);
  } finally { await data.keyring.lockWallet(); await recovery?.dispose(); await f.close(); }
});

test('matching phrase plus damaged retained note AEAD refuses recovery without any rewrite', async () => {
  const f = await fixture(), data = await noteBundle(1); let recovery: NativeRecoveryCoordinator | undefined;
  try {
    data.bundle.shards[0]!.ciphertext = (data.bundle.shards[0]!.ciphertext[0] === 'A' ? 'B' : 'A') + data.bundle.shards[0]!.ciphertext.slice(1);
    // Authenticate a root which references the damaged shard, so this reaches
    // the SDK AEAD rejection rather than only the outer shard-hash check.
    const rootBytes = await data.keyring.decryptPrivateRecord({ domain: data.bundle.root.domain, recordId: data.bundle.root.recordId, envelope: data.bundle.root });
    const root = JSON.parse(new TextDecoder().decode(rootBytes)); rootBytes.fill(0);
    root.shards[0].hash = envelopeHash(data.bundle.shards[0]!);
    data.bundle.root = await data.keyring.encryptPrivateRecord({ domain: data.bundle.root.domain, recordId: data.bundle.root.recordId, plaintext: new TextEncoder().encode(JSON.stringify(root)) });
    f.notes(data.profile, data.bundle, await f.store.getWalletFingerprint()); f.owner.lock(); recovery = f.coordinator(); const before = f.read();
    await assert.rejects(recovery.prepare(PHRASE, NEXT, () => undefined), { code: 'INVALID_SAVED_DATA' }); assert.deepEqual(f.read(), before);
  } finally { await data.keyring.lockWallet(); await recovery?.dispose(); await f.close(); }
});

test('a changed note row after proof invalidates the whole replacement CAS', async () => {
  const f = await fixture(), data = await noteBundle(1); let recovery: NativeRecoveryCoordinator | undefined;
  try {
    const binding = await f.store.getWalletFingerprint(); f.notes(data.profile, data.bundle, binding); f.owner.lock(); recovery = f.coordinator();
    const proof = await recovery.prepare(PHRASE, NEXT, () => undefined);
    data.bundle.root.ciphertext = (data.bundle.root.ciphertext[0] === 'A' ? 'B' : 'A') + data.bundle.root.ciphertext.slice(1); f.notes(data.profile, data.bundle, binding); const changed = f.read();
    await assert.rejects(recovery.commit(proof), { code: 'STATE_CHANGED' }); assert.deepEqual(f.read(), changed);
  } finally { await data.keyring.lockWallet(); await recovery?.dispose(); await f.close(); }
});

test('shared actualSDK inspector accepts512unique notes and rejects a duplicated shard identity', async () => {
  const data = await noteBundle(512);
  try {
    const session = { keyring: data.keyring, generation: 1, assertCurrent() {} };
    const result = await readPrivateVaultBundle(data.bundle, session); assert.equal(result.manifest.notes.length, 512); assert.equal(result.capacity, 512);
    assert.equal(new Set(result.manifest.notes.map((note) => note.id)).size, 512);
    assert.equal(new Set(result.manifest.notes.map((note) => note.note)).size, 512);
    const forged = { ...data.bundle, shards: [...data.bundle.shards, data.bundle.shards[0]!] };
    await assert.rejects(readPrivateVaultBundle(forged, session));
  } finally { await data.keyring.lockWallet(); }
});

test('cancellation during actualSDK note decrypt discards successful stale work and preserves bytes', async () => {
  const f = await fixture(), data = await noteBundle(1), pause = latch(); let recovery: NativeRecoveryCoordinator | undefined;
  class Delayed extends sdk.SoftwareKeyring {
    override async decryptPrivateRecord(params: Parameters<typeof data.keyring.decryptPrivateRecord>[0]) { pause.enter(); await pause.gate; return super.decryptPrivateRecord(params); }
  }
  try {
    f.notes(data.profile, data.bundle, await f.store.getWalletFingerprint()); f.owner.lock(); recovery = f.coordinator(async () => ({ ...sdk, SoftwareKeyring: Delayed }));
    const before = f.read(), pending = recovery.prepare(PHRASE, NEXT, () => undefined); await pause.reached; recovery.cancel(); pause.release();
    await assert.rejects(pending, { code: 'CANCELLED' }); assert.deepEqual(f.read(), before);
  } finally { pause.release(); await data.keyring.lockWallet(); await recovery?.dispose(); await f.close(); }
});

test('wrong valid phrase with retained notes counts one failure and leaves every note byte intact', async () => {
  const f = await fixture(), data = await noteBundle(1); let recovery: NativeRecoveryCoordinator | undefined;
  try {
    f.notes(data.profile, data.bundle, await f.store.getWalletFingerprint()); f.owner.lock(); recovery = f.coordinator(); const before = f.read();
    await assert.rejects(recovery.prepare(WRONG, NEXT, () => undefined), { code: 'WRONG_PHRASE' });
    assert.deepEqual(f.read().notes, before.notes); assert.deepEqual(f.read().records, before.records);
    assert.equal(JSON.parse(f.read().metadata.find((row) => row.key === 'auth')!.value).failures, 1);
  } finally { await data.keyring.lockWallet(); await recovery?.dispose(); await f.close(); }
});


test('shared actualSDK inspector rejects an authenticated bundle containing513unique notes', async () => {
  const data = await noteBundle(513);
  try {
    const rootBytes = await data.keyring.decryptPrivateRecord({ domain: data.bundle.root.domain, recordId: data.bundle.root.recordId, envelope: data.bundle.root });
    const root = JSON.parse(new TextDecoder().decode(rootBytes)); rootBytes.fill(0);
    assert.equal(root.noteCount, 513); assert.equal(root.capacity, 512); assert.equal(root.shards.length, 33);
    const ids = new Set<string>(), notes = new Set<string>();
    assert.equal(new Set(data.bundle.shards.map((shard) => shard.recordId)).size, 33);
    for (const [index, shard] of data.bundle.shards.entries()) {
      assert.equal(root.shards[index].hash, envelopeHash(shard));
      const bytes = await data.keyring.decryptPrivateRecord({ domain: shard.domain, recordId: shard.recordId, envelope: shard });
      const plain = JSON.parse(new TextDecoder().decode(bytes)); bytes.fill(0);
      assert.equal(plain.notes.length, root.shards[index].count);
      for (const note of plain.notes) { ids.add(note.id); notes.add(note.note); }
    }
    assert.equal(ids.size, 513); assert.equal(notes.size, 513);
    await assert.rejects(readPrivateVaultBundle(data.bundle, { keyring: data.keyring, generation: 1, assertCurrent() {} }), { message: 'privacy_vault_corrupt' });
  } finally { await data.keyring.lockWallet(); }
});
