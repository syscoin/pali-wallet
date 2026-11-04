import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Wallet } from 'ethers/wallet';
import { keccak256 } from 'ethers/crypto';
import { NativeTransferJournal, journalRequiresReopen, nativeTransferJournalKey, inspectRecoveryJournal, terminalJournalForRemoval, type TransferJournalContainer, type TransferJournalPhase } from '../src/custody/transferJournal.ts';
import { getNativeNetwork, NATIVE_NETWORKS, type EvmNetworkId } from '../src/custody/networkContext.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { encodeStorageValue } from '../src/storage/json.ts';
import { NativeTransferRpc } from '../src/custody/transferRpc.ts';
import type { KeyringStoragePort } from '../src/storage/types.ts';
import { digest, INSTALLATION, nodeConnection, validPair, type SqlHook } from './storageHelpers.ts';

const wallet = new Wallet('0x' + '1'.padStart(64, '0'));
async function raw(id: EvmNetworkId = 'ethereum', nonce = 0, signer = wallet) {
  return signer.signTransaction({ type: 2, chainId: Number(getNativeNetwork(id).chainId), nonce,
    to: '0x1111111111111111111111111111111111111111', value: 1n, gasLimit: 21000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n });
}
async function fixture(hooks: { before?: SqlHook; after?: SqlHook } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-journal-container-'));
  const file = path.join(directory, 'wallet.sqlite');
  let owned = nodeConnection(file, hooks);
  let storage = await SqliteWalletStorage.open(owned.connection, digest, INSTALLATION, true);
  await storage.keyringStorage.createManyIfAbsent(validPair());
  const fingerprint = await storage.getWalletFingerprint();
  return {
    fingerprint,
    get port() { return storage.keyringStorage; },
    get database() { return owned.database; },
    journal(id: EvmNetworkId = 'ethereum', index = 0, signer = wallet, port = storage.keyringStorage, guard = () => undefined) {
      const registration = getNativeNetwork(id);
      return new NativeTransferJournal(port, { walletFingerprint: fingerprint, address: signer.address, chainId: registration.chainId }, guard, () => 1000, index, registration);
    },
    async value(index = 0) { return await storage.keyringStorage.get(nativeTransferJournalKey(index)) as TransferJournalContainer; },
    async reopen() {
      await storage.close().catch(() => undefined); owned = nodeConnection(file);
      storage = await SqliteWalletStorage.open(owned.connection, digest, INSTALLATION, false);
    },
    async cleanup() { await storage.close().catch(() => undefined); await rm(directory, { recursive: true, force: true }); },
  };
}

for (const phase of ['signed', 'attempted', 'submitted', 'confirmed', 'reverted', 'nonce-consumed'] as TransferJournalPhase[]) {
  test(`canonical ${phase} journal reads without writing and preserves bytes across restart`, async () => {
    const f = await fixture();
    try {
      const signed = await raw(); const journal = f.journal();
      const first = await journal.saveSigned(signed);
      if (phase !== 'signed') await journal.transition(first.hash, 'attempted');
      if (phase !== 'signed' && phase !== 'attempted') await journal.transition(first.hash, phase);
      const original = await f.value();
      assert.equal(await f.journal('base').load(), null);
      assert.deepEqual(await f.value(), original);
      await f.reopen();
      assert.equal((await f.journal().load())!.rawTransaction, signed);
      assert.equal((await f.journal().load())!.phase, phase);
      assert.deepEqual(await f.value(), original);
    } finally { await f.cleanup(); }
  });
}

test('old development flat journal shape is rejected and retained verbatim', async () => {
  const f = await fixture();
  try {
    const signed = await raw();
    const old = { version: 1, scope: { walletFingerprint: f.fingerprint, address: wallet.address, chainId: '1' },
      phase: 'attempted', rawTransaction: signed, hash: keccak256(signed), nonce: 0, createdAt: 42 };
    await f.port.set(nativeTransferJournalKey(0), old);
    await assert.rejects(f.journal().load(), /CORRUPT/);
    assert.deepEqual(await f.value(), old);
  } finally { await f.cleanup(); }
});

test('independent storage wrappers merge concurrent different-chain writes and transitions through CAS', async () => {
  const f = await fixture();
  try {
    let attempts = 0;
    const wrapped = (): KeyringStoragePort => ({ ...f.port, async compareAndSet(...args) { attempts++; return f.port.compareAndSet(...args); } });
    const ethereum = f.journal('ethereum', 0, wallet, wrapped());
    const base = f.journal('base', 0, wallet, wrapped());
    const [eth, other] = await Promise.all([ethereum.saveSigned(await raw()), base.saveSigned(await raw('base'))]);
    await Promise.all([ethereum.transition(eth.hash, 'attempted'), base.transition(other.hash, 'attempted')]);
    const value = await f.value();
    assert.deepEqual(value.entries.map((entry) => entry.registration.chainId), ['1', '8453']);
    assert.equal(value.entries.every((entry) => entry.phase === 'attempted'), true);
    assert.ok(attempts >= 3);
    assert.equal(value.revision, 3);
    await f.reopen();
    assert.equal((await f.journal().load())!.hash, eth.hash);
    assert.equal((await f.journal('base').load())!.hash, other.hash);
  } finally { await f.cleanup(); }
});

test('three definitive CAS conflicts preserve the row without requiring reopen', async () => {
  const f = await fixture();
  try {
    const first = await f.journal().saveSigned(await raw());
    const old = await f.value();
    let attempts = 0;
    const port: KeyringStoragePort = { ...f.port, async compareAndSet() { attempts++; return false; } };
    await assert.rejects(f.journal('ethereum', 0, wallet, port).transition(first.hash, 'attempted'), { code: 'CONFLICT' });
    assert.equal(attempts, 3);
    assert.equal(journalRequiresReopen(port), false);
    assert.deepEqual(await f.value(), old);
  } finally { await f.cleanup(); }
});

for (const phase of ['before-commit', 'lost-ack'] as const) {
  test(`container ${phase} quarantines and reopens the complete committed state`, async () => {
    let enabled = false;
    const fail: SqlHook = (kind, sql) => { if (enabled && kind === 'exec' && sql === 'COMMIT') { enabled = false; throw Error('interrupted acknowledgement'); } };
    const f = await fixture(phase === 'lost-ack' ? { after: fail } : { before: fail });
    try {
      const signed = await raw(); enabled = true;
      await assert.rejects(f.journal().saveSigned(signed), { code: 'REOPEN_REQUIRED' });
      assert.equal(journalRequiresReopen(f.port), true);
      await assert.rejects(f.journal().load(), { code: 'REOPEN_REQUIRED' });
      await f.reopen();
      assert.equal(journalRequiresReopen(f.port), false);
      const saved = await f.journal().load();
      assert.equal(saved?.rawTransaction, phase === 'lost-ack' ? signed : undefined);
    } finally { await f.cleanup(); }
  });
}

for (const operation of ['create', 'transition'] as const) {
  test(`context revocation after acknowledged ${operation} discards only the stale result`, async () => {
    let enabled = false, current = true;
    const f = await fixture({ after: (kind, sql) => { if (enabled && kind === 'exec' && sql === 'COMMIT') { enabled = false; current = false; } } });
    try {
      const signed = await raw();
      if (operation === 'transition') await f.journal().saveSigned(signed);
      const guarded = f.journal('ethereum', 0, wallet, f.port, () => { if (!current) throw Error('REVOKED'); });
      enabled = true;
      const action = operation === 'create' ? guarded.saveSigned(signed) : guarded.transition(keccak256(signed), 'attempted');
      await assert.rejects(action, /REVOKED/);
      assert.equal(journalRequiresReopen(f.port), false);
      assert.equal((await f.value()).version, 1);
      const fresh = await f.journal().load();
      assert.equal(fresh!.rawTransaction, signed);
      assert.equal(fresh!.phase, operation === 'create' ? 'signed' : 'attempted');
    } finally { await f.cleanup(); }
  });
}

test('nonboolean commit acknowledgement quarantines without erasing the committed entry', async () => {
  const f = await fixture();
  try {
    const first = await f.journal().saveSigned(await raw());
    const port: KeyringStoragePort = { ...f.port, async compareAndSet(...args) {
      await f.port.compareAndSet(...args); return undefined as unknown as boolean;
    } };
    await assert.rejects(f.journal('ethereum', 0, wallet, port).transition(first.hash, 'attempted'), { code: 'REOPEN_REQUIRED' });
    assert.equal(journalRequiresReopen(port), true);
    await f.reopen();
    assert.equal((await f.journal().load())!.phase, 'attempted');
  } finally { await f.cleanup(); }
});

test('twenty accounts across seven chains consume one bounded row per account', async (t) => {
  const f = await fixture();
  try {
    let largestContainerBytes = 0;
    for (let index = 0; index < 20; index++) {
      const signer = new Wallet('0x' + (index + 1).toString(16).padStart(64, '0'));
      for (const network of NATIVE_NETWORKS) await f.journal(network.id, index, signer).saveSigned(await raw(network.id, 0, signer));
      const value = await f.value(index);
      assert.equal(value.entries.length, 7);
      const bytes = Buffer.byteLength(encodeStorageValue(value));
      largestContainerBytes = Math.max(largestContainerBytes, bytes);
      assert.ok(bytes < 65536);
    }
    const count = f.database.prepare('SELECT COUNT(*) AS count FROM keyring_records').get() as { count: number };
    assert.equal(count.count, 22, 'two wallet records plus twenty complete per-account containers');
    t.diagnostic(`20 accounts × 7 chains: ${count.count} retained rows; largest encoded container ${largestContainerBytes} bytes`);
  } finally { await f.cleanup(); }
});

test('malformed or foreign container entries fail closed without deleting unrelated chains', async () => {
  const f = await fixture();
  try {
    await f.journal().saveSigned(await raw()); await f.journal('base').saveSigned(await raw('base'));
    const original = await f.value();
    const cases = [
      { ...original, entries: [...original.entries, original.entries[0]] },
      { ...original, entries: original.entries.map((entry) => ({ ...entry, registration: { ...entry.registration, rpcUrl: 'https://changed.invalid' } })) },
      { ...original, account: { ...original.account, index: 1 } },
      { ...original, walletFingerprint: '2'.repeat(64) },
      { ...original, entries: [{ ...original.entries[0], rawTransaction: original.entries[1]!.rawTransaction }] },
      { ...original, entries: Array.from({ length: 13 }, () => original.entries[0]) },
    ];
    for (const corrupted of cases) {
      await f.port.set(nativeTransferJournalKey(0), JSON.parse(JSON.stringify(corrupted)));
      await assert.rejects(f.journal().load(), /CORRUPT|CONTEXT_CHANGED/);
      assert.deepEqual(await f.port.get(nativeTransferJournalKey(0)), corrupted);
    }
  } finally { await f.cleanup(); }
});


test('revoked readback after a true commit does not quarantine the acknowledged row', async () => {
  let enabled = false, committed = false, current = true;
  const f = await fixture({
    after: (kind, sql) => { if (enabled && kind === 'exec' && sql === 'COMMIT') committed = true; },
    before: (kind, sql) => {
      if (enabled && committed && kind === 'get' && sql.includes('FROM keyring_records WHERE key = ?')) {
        enabled = false; current = false; throw Error('readback cancelled by close');
      }
    },
  });
  try {
    const journal = f.journal('ethereum', 0, wallet, f.port, () => { if (!current) throw Error('REVOKED'); });
    const signed = await raw(); enabled = true;
    await assert.rejects(journal.saveSigned(signed), /REVOKED/);
    assert.equal(journalRequiresReopen(f.port), false);
    assert.equal((await f.journal().load())!.rawTransaction, signed);
  } finally { await f.cleanup(); }
});

test('terminal journal capacity is reclaimed only after durable archive acknowledgment', async () => {
  const f = await fixture();
  try {
    const { createNativeNetwork } = await import('../src/custody/networkContext.ts');
    const history = new (await import('../src/activity/historyStore.ts')).NativeActivityHistory(f.port);
    const network = (index: number) => createNativeNetwork({ id: `chain-${index}`, name: `Chain ${index}`, kind: 'evm', chainId: String(index), slip44: 60,
      rpcUrl: `https://chain-${index}.example`, symbol: 'GAS', decimals: 18, testnet: true });
    const make = (index: number, archive = (record: import('../src/activity/types.ts').TerminalActivityRecord, check: () => void) => history.archiveTerminal(record, check), port = f.port) =>
      new NativeTransferJournal(port, { walletFingerprint: f.fingerprint, address: wallet.address, chainId: String(index) }, () => undefined,
        () => index, 0, network(index), archive);
    const sign = (index: number) => wallet.signTransaction({ type: 2, chainId: index, nonce: 0, to: '0x1111111111111111111111111111111111111111', value: 1n,
      gasLimit: 25200n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n });
    for (let index = 100; index < 112; index++) {
      const journal = make(index), entry = await journal.saveSigned(await sign(index));
      await journal.transition(entry.hash, 'attempted'); await journal.transition(entry.hash, 'confirmed');
    }
    const before = await f.value();
    const refused = make(112, async () => { throw new Error('Archive failed'); });
    await assert.rejects(refused.saveSigned(await sign(112)), { code: 'HISTORY_UNAVAILABLE' });
    assert.deepEqual(await f.value(), before);
    await make(112).saveSigned(await sign(112));
    const after = await f.value();
    assert.equal(after.entries.length, 12);
    assert.equal(after.entries.some((entry) => entry.registration.chainId === '100'), false);
    const scope = (await import('../src/activity/types.ts')).createActivityScope(f.fingerprint, 'hd:60:0', wallet.address, network(100));
    assert.equal((await history.load(scope, () => undefined)).archived[0]!.hash, before.entries[0]!.hash);
    // A competing writer revives the initially selected terminal record before CAS.
    // The retry must retain it and choose another confirmed record instead.
    let raced = false;
    const revived = after.entries.find((entry) => entry.phase === 'confirmed')!;
    const wrapped = { ...f.port, async compareAndSet(key: string, expected: unknown, next: unknown) {
      if (!raced) {
        raced = true;
        const updated = structuredClone(expected) as TransferJournalContainer;
        const changed = { ...updated, revision: updated.revision + 1,
          entries: updated.entries.map((entry) => entry.hash === revived.hash ? { ...entry, phase: 'submitted' as const } : entry) };
        assert.equal(await f.port.compareAndSet(key, expected, changed), true);
      }
      return f.port.compareAndSet(key, expected, next);
    } };
    await make(113, (record, check) => history.archiveTerminal(record, check), wrapped).saveSigned(await sign(113));
    assert.equal(raced, true);
    const racedRow = await f.value();
    assert.equal(racedRow.entries.find((entry) => entry.hash === revived.hash)!.phase, 'submitted');
    assert.equal(racedRow.entries.find((entry) => entry.hash === revived.hash)!.rawTransaction, revived.rawTransaction);
    assert.equal(racedRow.entries.length, 12);
    for (const phase of ['submitted', 'nonce-consumed'] as const) {
      const unresolved = { ...racedRow, revision: racedRow.revision + 1,
        entries: racedRow.entries.map((entry) => ({ ...entry, phase })) };
      await f.port.set(nativeTransferJournalKey(0), unresolved);
      await assert.rejects(make(114).saveSigned(await sign(114)), { code: 'CAPACITY' });
      assert.deepEqual(await f.value(), unresolved);
    }

  } finally { await f.cleanup(); }
});


for (const type of [0, 2] as const) test(`SQLite preserves current-format type ${type} over-cap terminal bytes but refuses new admission`, async () => {
  const f = await fixture();
  try {
    const signed = await wallet.signTransaction({ type, chainId: 1, nonce: 0,
      to: '0x1111111111111111111111111111111111111111', value: 1n, gasLimit: 17000000n,
      ...(type === 0 ? { gasPrice: 2n } : { maxFeePerGas: 2n, maxPriorityFeePerGas: 1n }) });
    const saved: TransferJournalContainer = { version: 1, revision: 0, walletFingerprint: f.fingerprint,
      account: { id: 'hd:60:0', index: 0, type: 'HDAccount', slip44: 60, address: wallet.address },
      entries: [{ registration: getNativeNetwork('ethereum'), phase: 'confirmed', rawTransaction: signed,
        hash: keccak256(signed), nonce: 0, createdAt: 1000 }] };
    await f.port.set(nativeTransferJournalKey(0), saved);
    const before = encodeStorageValue(await f.value());
    await f.reopen();
    assert.equal((await f.journal().load())?.rawTransaction, signed);
    assert.equal((await f.journal().activity())?.maximumFeeUnits, '34000000');
    assert.equal(inspectRecoveryJournal(nativeTransferJournalKey(0), await f.value(), f.fingerprint).pending, 0);
    assert.equal(encodeStorageValue(terminalJournalForRemoval(await f.value(), { walletFingerprint: f.fingerprint, address: wallet.address })), encodeStorageValue(saved));
    assert.equal(encodeStorageValue(await f.value()), before);
    assert.throws(() => f.journal().saveSigned(signed), { code: 'CORRUPT' });
    let calls = 0;
    const rpc = new NativeTransferRpc({ networkId: 'ethereum', fetch: async () => { calls++; throw new Error('Must not dispatch'); } });
    await assert.rejects(rpc.broadcast(signed, keccak256(signed), new AbortController().signal), { code: 'INVALID_RESPONSE' });
    assert.equal(calls, 0); assert.equal(journalRequiresReopen(f.port), false);
    assert.equal(encodeStorageValue(await f.value()), before);
  } finally { await f.cleanup(); }
});
