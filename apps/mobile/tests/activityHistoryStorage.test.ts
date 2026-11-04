import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Wallet } from 'ethers/wallet';
import { keccak256 } from 'ethers/crypto';
import { NativeActivityHistory, ACTIVITY_STORAGE_KEY } from '../src/activity/historyStore.ts';
import { createActivityScope, type TerminalActivityRecord } from '../src/activity/types.ts';
import { NativeTransferJournal, journalRequiresReopen, nativeTransferJournalKey, type TransferJournalContainer } from '../src/custody/transferJournal.ts';
import { getNativeNetwork, type EvmNetworkId } from '../src/custody/networkContext.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { encodeStorageValue } from '../src/storage/json.ts';
import type { KeyringStoragePort } from '../src/storage/types.ts';
import { encodeErc20Transfer } from '../../../source/shared/erc20.ts';
import { digest, INSTALLATION, nodeConnection, validPair, type SqlHook } from './storageHelpers.ts';

const wallet = new Wallet(`0x${'1'.padStart(64, '0')}`);
const RECIPIENT = '0x1111111111111111111111111111111111111111';
const TOKEN = '0x2222222222222222222222222222222222222222';
const guard = () => undefined;
const entryHash = (index: number) => `0x${index.toString(16).padStart(64, '0')}`;
async function raw(nonce: number, network: EvmNetworkId = 'ethereum') {
  return wallet.signTransaction({ type: 2, chainId: BigInt(getNativeNetwork(network).chainId), nonce,
    to: RECIPIENT, value: 123n, gasLimit: 21000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n });
}
async function fixture(hooks: { before?: SqlHook; after?: SqlHook } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-activity-history-'));
  const file = path.join(directory, 'wallet.sqlite');
  let owned = nodeConnection(file, hooks);
  let storage = await SqliteWalletStorage.open(owned.connection, digest, INSTALLATION, true);
  await storage.keyringStorage.createManyIfAbsent(validPair());
  const fingerprint = await storage.getWalletFingerprint();
  return {
    fingerprint,
    get port() { return storage.keyringStorage; },
    history(port = storage.keyringStorage) { return new NativeActivityHistory(port); },
    scope(index = 0) { return createActivityScope(fingerprint, `hd:60:${index}`, wallet.address, 'ethereum'); },
    record(index: number, fields: Partial<TerminalActivityRecord> = {}): TerminalActivityRecord {
      const network = getNativeNetwork('ethereum');
      return { walletFingerprint: fingerprint, accountId: 'hd:60:0', address: wallet.address,
        networkId: network.id, registrationHash: network.registrationHash, chainId: network.chainId,
        hash: entryHash(index), phase: 'confirmed', nonce: index, createdAt: 1000 + index,
        recipient: RECIPIENT, amountUnits: '123', maximumFeeUnits: '42000', ...fields };
    },
    journal(network: EvmNetworkId = 'ethereum', index = 0, port = storage.keyringStorage,
      archive?: (record: TerminalActivityRecord, check: () => void) => Promise<void>, check = guard) {
      const registration = getNativeNetwork(network);
      return new NativeTransferJournal(port, { walletFingerprint: fingerprint, address: wallet.address, chainId: registration.chainId },
        check, () => 1000, index, registration, archive);
    },
    async value(index = 0) { return await storage.keyringStorage.get(nativeTransferJournalKey(index)) as TransferJournalContainer; },
    async reopen() {
      await storage.close().catch(() => undefined);
      owned = nodeConnection(file);
      storage = await SqliteWalletStorage.open(owned.connection, digest, INSTALLATION, false);
    },
    async cleanup() { await storage.close().catch(() => undefined); await rm(directory, { recursive: true, force: true }); },
  };
}
async function terminal(journal: NativeTransferJournal, network: EvmNetworkId = 'ethereum', nonce = 0) {
  const bytes = await raw(nonce, network);
  const saved = await journal.saveSigned(bytes);
  await journal.transition(saved.hash, 'attempted');
  await journal.transition(saved.hash, 'confirmed');
  return bytes;
}

test('missing archive hook refuses terminal replacement and removal without touching signed recovery data', async () => {
  const f = await fixture();
  try {
    const journal = f.journal();
    await terminal(journal);
    const before = encodeStorageValue(await f.value());
    await assert.rejects(journal.saveSigned(await raw(1)), { code: 'HISTORY_UNAVAILABLE' });
    await assert.rejects(journal.removalSnapshot(), { code: 'HISTORY_UNAVAILABLE' });
    assert.equal(encodeStorageValue(await f.value()), before);
    assert.equal(await f.port.get(ACTIVITY_STORAGE_KEY), undefined);
  } finally { await f.cleanup(); }
});

test('a public terminal summary is durably archived before the old journal is replaced', async () => {
  const f = await fixture();
  try {
    const oldBytes = await terminal(f.journal());
    const history = f.history();
    let callbackRecord: TerminalActivityRecord | undefined;
    let replacementAttempts = 0;
    const port: KeyringStoragePort = { ...f.port, async compareAndSet(key, ...rest) {
      if (key === nativeTransferJournalKey(0)) {
        replacementAttempts++;
        const snapshot = await history.load(f.scope(), guard);
        assert.equal(snapshot.archived.length, 1, 'archive readback must precede journal CAS');
        assert.equal(snapshot.archived[0]?.hash, keccak256(oldBytes));
      }
      return f.port.compareAndSet(key, ...rest);
    } };
    const journal = f.journal('ethereum', 0, port, async (record, check) => {
      callbackRecord = record;
      check(); await history.archiveTerminal(record, check); check();
    });
    const newBytes = await raw(1);
    await journal.saveSigned(newBytes);
    assert.equal(replacementAttempts, 1);
    assert(callbackRecord);
    assert.equal(callbackRecord.amountUnits, '123');
    assert.equal(callbackRecord.maximumFeeUnits, '42000');
    assert.equal(Object.hasOwn(callbackRecord, 'rawTransaction'), false);
    assert.equal(JSON.stringify(callbackRecord).includes(oldBytes), false);
    assert.equal(JSON.stringify(await f.port.get(ACTIVITY_STORAGE_KEY)).includes(oldBytes), false);
    assert.equal((await journal.load())?.rawTransaction, newBytes);
    await f.reopen();
    assert.equal((await f.history().load(f.scope(), guard)).archived[0]?.hash, keccak256(oldBytes));
    assert.equal((await f.journal().load())?.hash, keccak256(newBytes));
  } finally { await f.cleanup(); }
});

test('identical archive retries do not rewrite the document and conflicting duplicates are refused', async () => {
  const f = await fixture();
  try {
    const history = f.history(); const record = f.record(1);
    await history.archiveTerminal(record, guard);
    const before = encodeStorageValue(await f.port.get(ACTIVITY_STORAGE_KEY));
    await history.archiveTerminal({ ...record }, guard);
    assert.equal(encodeStorageValue(await f.port.get(ACTIVITY_STORAGE_KEY)), before);
    await assert.rejects(history.archiveTerminal({ ...record, amountUnits: '999' }, guard), { code: 'INVALID' });
    assert.equal(encodeStorageValue(await f.port.get(ACTIVITY_STORAGE_KEY)), before);
  } finally { await f.cleanup(); }
});

test('ERC20 archive preserves the reviewed recipient and token units independently of the contract and ETH fee', async () => {
  const f = await fixture();
  try {
    const token = { contractAddress: TOKEN, decimals: 6, symbol: 'TOK', name: 'Fixture token' };
    const intent = { kind: 'erc20-transfer' as const, chainId: '1', token, recipient: RECIPIENT, amountUnits: '1234567' };
    const signed = await wallet.signTransaction({ type: 2, chainId: 1, nonce: 0, to: TOKEN, value: 0n,
      gasLimit: 50000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, data: encodeErc20Transfer(RECIPIENT, intent.amountUnits) });
    const initial = f.journal();
    const saved = await initial.saveSigned(signed, intent);
    await initial.transition(saved.hash, 'attempted'); await initial.transition(saved.hash, 'confirmed');
    const history = f.history();
    await f.journal('ethereum', 0, f.port, (record, check) => history.archiveTerminal(record, check)).saveSigned(await raw(1));
    const [archived] = (await history.load(f.scope(), guard)).archived;
    assert.equal(archived?.recipient, RECIPIENT);
    assert.equal(archived?.amountUnits, '1234567');
    assert.equal(archived?.maximumFeeUnits, '100000');
    assert.deepEqual(archived?.token, token);
    assert.equal(JSON.stringify(archived).includes(signed), false);
  } finally { await f.cleanup(); }
});

for (const operation of ['replacement', 'removal'] as const) {
  test(`full-range reviewed ERC20 metadata survives terminal ${operation}`, async () => {
    const f = await fixture();
    try {
      const token = { contractAddress: TOKEN, decimals: 255, symbol: '😀'.repeat(64), name: '😀'.repeat(128) };
      const intent = { kind: 'erc20-transfer' as const, chainId: '1', token, recipient: RECIPIENT, amountUnits: '1' };
      const signed = await wallet.signTransaction({ type: 2, chainId: 1, nonce: 0, to: TOKEN, value: 0n,
        gasLimit: 50000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, data: encodeErc20Transfer(RECIPIENT, intent.amountUnits) });
      const initial = f.journal();
      const saved = await initial.saveSigned(signed, intent);
      await initial.transition(saved.hash, 'attempted');
      await initial.transition(saved.hash, 'confirmed');
      const before = await f.value();
      const history = f.history();
      const journal = f.journal('ethereum', 0, f.port, (record, check) => history.archiveTerminal(record, check));
      if (operation === 'replacement') await journal.saveSigned(await raw(1));
      else assert.deepEqual(await journal.removalSnapshot(), before);
      assert.deepEqual((await history.load(f.scope(), guard)).archived[0]?.token, token);
      await f.reopen();
      assert.deepEqual((await f.history().load(f.scope(), guard)).archived[0]?.token, token);
    } finally { await f.cleanup(); }
  });
}

test('archive rejects malformed or unsafe ERC20 metadata without persisting it', async () => {
  const f = await fixture();
  try {
    const token = { contractAddress: TOKEN, decimals: 18, symbol: 'TOK', name: 'Fixture token' };
    const invalid = [
      { ...token, symbol: 'A'.repeat(65) },
      { ...token, name: '😀'.repeat(129) },
      { ...token, symbol: 'TOK\u200b' },
      { ...token, name: 'Token\u202e' },
      { ...token, decimals: 256 },
      { ...token, decimals: -1 },
      { ...token, extra: true },
      { ...token, name: '' },
    ];
    const history = f.history();
    for (const metadata of invalid)
      await assert.rejects(async () => history.archiveTerminal(f.record(1, { token: metadata }), guard));
    let accessed = false;
    await assert.rejects(async () => history.archiveTerminal(f.record(1, { token: {
      ...token, get symbol() { accessed = true; return 'TOK'; },
    } }), guard));
    assert.equal(accessed, false);
    assert.equal(await f.port.get(ACTIVITY_STORAGE_KEY), undefined);
  } finally { await f.cleanup(); }
});

for (const failure of ['write', 'readback'] as const) {
  test(`archive ${failure} failure preserves the old journal and prevents its CAS`, async () => {
    const f = await fixture();
    try {
      await terminal(f.journal()); const before = encodeStorageValue(await f.value());
      let archiveWritten = false, journalWrites = 0;
      const port: KeyringStoragePort = { ...f.port,
        async createManyIfAbsent(items) {
          if (Object.hasOwn(items, ACTIVITY_STORAGE_KEY)) {
            if (failure === 'write') throw Error('injected archive write failure');
            const result = await f.port.createManyIfAbsent(items); archiveWritten = true; return result;
          }
          return f.port.createManyIfAbsent(items);
        },
        async get(key) {
          if (key === ACTIVITY_STORAGE_KEY && failure === 'readback' && archiveWritten) throw Error('lost archive readback');
          return f.port.get(key);
        },
        async compareAndSet(key, ...rest) { if (key === nativeTransferJournalKey(0)) journalWrites++; return f.port.compareAndSet(key, ...rest); },
      };
      const history = f.history(port);
      await assert.rejects(f.journal('ethereum', 0, port, (record, check) => history.archiveTerminal(record, check)).saveSigned(await raw(1)), { code: 'REOPEN_REQUIRED' });
      assert.equal(history.requiresReopen, true);
      assert.equal(journalWrites, 0);
      assert.equal(encodeStorageValue(await f.value()), before);
      assert.equal(!!await f.port.get(ACTIVITY_STORAGE_KEY), failure === 'readback');
    } finally { await f.cleanup(); }
  });
}

test('lost journal commit acknowledgement leaves the old archive and the new signed journal recoverable', async () => {
  let failNextCommit = false;
  const hook: SqlHook = (kind, sql) => {
    if (failNextCommit && kind === 'exec' && sql === 'COMMIT') { failNextCommit = false; throw Error('lost journal commit acknowledgement'); }
  };
  const f = await fixture({ after: hook });
  try {
    const oldBytes = await terminal(f.journal()); const history = f.history(); const oldPort = f.port;
    const journal = f.journal('ethereum', 0, f.port, async (record, check) => {
      await history.archiveTerminal(record, check);
      failNextCommit = true;
    });
    const newBytes = await raw(1);
    await assert.rejects(journal.saveSigned(newBytes), { code: 'REOPEN_REQUIRED' });
    assert.equal(journalRequiresReopen(oldPort), true);
    await f.reopen();
    const archived = (await f.history().load(f.scope(), guard)).archived;
    assert.equal(archived[0]?.hash, keccak256(oldBytes));
    assert.equal((await f.journal().load())?.rawTransaction, newBytes);
    assert.equal((await f.journal().load())?.phase, 'signed');
  } finally { await f.cleanup(); }
});

test('lost archive commit acknowledgement never advances the old journal and remains idempotent after reopen', async () => {
  let failNextCommit = false;
  const hook: SqlHook = (kind, sql) => {
    if (failNextCommit && kind === 'exec' && sql === 'COMMIT') { failNextCommit = false; throw Error('lost archive commit acknowledgement'); }
  };
  const f = await fixture({ after: hook });
  try {
    const oldBytes = await terminal(f.journal()); const history = f.history();
    failNextCommit = true;
    await assert.rejects(f.journal('ethereum', 0, f.port, (record, check) => history.archiveTerminal(record, check)).saveSigned(await raw(1)), { code: 'REOPEN_REQUIRED' });
    await f.reopen();
    assert.equal((await f.journal().load())?.hash, keccak256(oldBytes));
    assert.equal((await f.history().load(f.scope(), guard)).archived[0]?.hash, keccak256(oldBytes));
    await f.journal('ethereum', 0, f.port, (record, check) => f.history().archiveTerminal(record, check)).saveSigned(await raw(1));
    assert.equal((await f.history().load(f.scope(), guard)).archived.length, 1);
  } finally { await f.cleanup(); }
});

test('context revocation after archive acknowledgement leaves a harmless duplicate and the old journal', async () => {
  const f = await fixture();
  try {
    const oldBytes = await terminal(f.journal()); const history = f.history();
    let current = true;
    const journal = f.journal('ethereum', 0, f.port, async (record, check) => {
      await history.archiveTerminal(record, check); current = false;
    }, () => { if (!current) throw Error('context revoked'); });
    await assert.rejects(journal.saveSigned(await raw(1)), /context revoked/);
    assert.equal((await f.journal().load())?.hash, keccak256(oldBytes));
    assert.equal((await history.load(f.scope(), guard)).archived[0]?.hash, keccak256(oldBytes));
  } finally { await f.cleanup(); }
});

test('removal archives all terminal chain entries before returning the exact removable snapshot', async () => {
  const f = await fixture();
  try {
    await terminal(f.journal('ethereum', 1)); await terminal(f.journal('base', 1), 'base');
    const before = await f.value(1); const history = f.history(); const seen: string[] = [];
    const journal = f.journal('ethereum', 1, f.port, async (record, check) => {
      seen.push(record.chainId); await history.archiveTerminal(record, check);
    });
    assert.deepEqual(await journal.removalSnapshot(), before);
    assert.deepEqual(seen, ['1', '8453']);
    const stored = await f.port.get(ACTIVITY_STORAGE_KEY) as { archived: TerminalActivityRecord[] };
    assert.deepEqual(stored.archived.map((record) => record.chainId), ['1', '8453']);
    assert.equal(stored.archived.every((record) => record.accountId === 'hd:60:1'), true);
    assert.deepEqual(await f.value(1), before, 'only the catalogue mutation may delete the snapshot');
  } finally { await f.cleanup(); }
});

test('a pending sibling chain prevents removal before any terminal archive is written', async () => {
  const f = await fixture();
  try {
    await terminal(f.journal('ethereum', 1)); await f.journal('base', 1).saveSigned(await raw(0, 'base'));
    let called = false;
    await assert.rejects(f.journal('ethereum', 1, f.port, async () => { called = true; }).removalSnapshot(), { code: 'PENDING_TRANSFER' });
    assert.equal(called, false);
    assert.equal(await f.port.get(ACTIVITY_STORAGE_KEY), undefined);
  } finally { await f.cleanup(); }
});

test('archive retention is bounded and discloses count pruning while preserving the newest record', async () => {
  const f = await fixture();
  try {
    const history = f.history();
    for (let index = 1; index <= 50; index++) await history.archiveTerminal(f.record(index), guard);
    const snapshot = await history.load(f.scope(), guard);
    assert.equal(snapshot.archived.length, 48);
    assert.equal(snapshot.truncated, true);
    assert.equal(snapshot.archived[0]?.hash, entryHash(3));
    assert.equal(snapshot.archived.at(-1)?.hash, entryHash(50));
    assert(new TextEncoder().encode(encodeStorageValue(await f.port.get(ACTIVITY_STORAGE_KEY))).length <= 60 * 1024);
  } finally { await f.cleanup(); }
});

test('byte pruning stays inside the global document budget with explicit coverage and a retained new archive', async () => {
  const f = await fixture();
  try {
    const history = f.history();
    const token = { contractAddress: TOKEN, decimals: 255, name: '\uffff'.repeat(128), symbol: '\uffff'.repeat(32) };
    for (let index = 1; index <= 48; index++) await history.archiveTerminal(f.record(index, {
      token, amountUnits: '9'.repeat(78), maximumFeeUnits: '9'.repeat(78),
    }), guard);
    for (let index = 0; index < 20; index++) await history.saveView(f.scope(index), { filter: 'received', showZero: true, anchor: entryHash(index + 1), offset: 9999 }, guard);
    await history.saveCache(f.scope(), Array.from({ length: 24 }, (_, index) => ({ hash: entryHash(100 + index), blockNumber: '9'.repeat(78), timestamp: Number.MAX_SAFE_INTEGER, tokenHint: true })), guard);
    assert.equal((await history.load(f.scope(), guard)).truncated, true, 'byte pressure must be disclosed even before a count cap is exceeded');
    await history.archiveTerminal(f.record(49, { token, amountUnits: '9'.repeat(78), maximumFeeUnits: '9'.repeat(78) }), guard);
    const snapshot = await history.load(f.scope(), guard);
    assert.equal(snapshot.truncated, true);
    assert.equal(snapshot.archived.at(-1)?.hash, entryHash(49));
    assert(new TextEncoder().encode(encodeStorageValue(await f.port.get(ACTIVITY_STORAGE_KEY))).length <= 60 * 1024);
  } finally { await f.cleanup(); }
});

test('archive byte cap includes revision digit growth and preserves the newly archived record', async () => {
  const f = await fixture();
  try {
    const limit = 60 * 1024;
    const maximumUnits = ((1n << 256n) - 1n).toString();
    const records = Array.from({ length: 48 }, (_, index) => f.record(index + 1, {
      token: { contractAddress: TOKEN, decimals: 255, name: '\uffff'.repeat(128), symbol: '\uffff'.repeat(32) },
      amountUnits: maximumUnits, maximumFeeUnits: maximumUnits,
    }));
    const proposed = { version: 1, walletFingerprint: f.fingerprint, revision: 99, truncated: false,
      archived: records, cached: [], views: [] as { sourceId: string; view: { filter: 'all'; showZero: false; anchor: null; offset: number } }[] };
    const bytes = () => new TextEncoder().encode(encodeStorageValue(proposed)).length;
    while (bytes() <= limit && proposed.views.length < 20)
      proposed.views.push({ sourceId: f.scope(proposed.views.length).sourceId, view: { filter: 'all', showZero: false, anchor: null, offset: 0 } });
    assert(bytes() > limit);
    // Adjust valid old metadata until adding the next record exactly fills the
    // pre-increment budget. The 99 -> 100 revision then needs one more byte.
    for (let index = 0; bytes() > limit && index < records.length - 1; index++) {
      const record = records[index]!;
      const excess = bytes() - limit;
      const remove = Math.min(127, Math.floor(excess / 3));
      let name = record.token!.name.slice(remove);
      const remainder = excess - remove * 3;
      if (remainder === 1) name = `é${name.slice(1)}`;
      else if (remainder === 2) name = `A${name.slice(1)}`;
      records[index] = { ...record, token: { ...record.token!, name } };
    }
    assert.equal(bytes(), limit);
    const newest = records.at(-1)!;
    await f.port.set(ACTIVITY_STORAGE_KEY, { ...proposed, archived: records.slice(0, -1) });
    await f.history().archiveTerminal(newest, guard);
    const stored = await f.port.get(ACTIVITY_STORAGE_KEY) as typeof proposed;
    assert.equal(stored.revision, 100);
    assert(new TextEncoder().encode(encodeStorageValue(stored)).length <= limit);
    assert.equal(stored.truncated, true);
    assert.deepEqual(stored.archived.at(-1), newest);
    await f.reopen();
    assert.equal((await f.history().load(f.scope(), guard)).archived.at(-1)?.hash, newest.hash);
  } finally { await f.cleanup(); }
});

test('cache admission discloses its input truncation and source changes do not relabel cached data', async () => {
  const f = await fixture();
  try {
    const history = f.history(); const scope = f.scope();
    await history.saveCache(scope, Array.from({ length: 25 }, (_, index) => ({ hash: entryHash(index + 1), blockNumber: '1', timestamp: null, tokenHint: false })), guard);
    const snapshot = await history.load(scope, guard);
    assert.equal(snapshot.candidates.length, 24);
    assert.equal(snapshot.truncated, true);
    const anotherSource = { ...scope, sourceId: entryHash(1234), apiUrl: 'https://another.example/api' };
    assert.deepEqual((await history.load(anotherSource, guard)).candidates, []);
  } finally { await f.cleanup(); }
});

test('untyped archive commit acknowledgement requires reopen even if the write happened', async () => {
  const f = await fixture();
  try {
    const port: KeyringStoragePort = { ...f.port, async createManyIfAbsent(items) {
      await f.port.createManyIfAbsent(items); return 1 as unknown as boolean;
    } };
    const history = f.history(port);
    await assert.rejects(history.archiveTerminal(f.record(1), guard), { code: 'REOPEN_REQUIRED' });
    assert.equal(history.requiresReopen, true);
    assert.equal((await f.history().load(f.scope(), guard)).archived.length, 1);
  } finally { await f.cleanup(); }
});

test('corrupt persisted history is preserved and never presented as a new empty document', async () => {
  const f = await fixture();
  try {
    const corrupt = { version: 1, walletFingerprint: f.fingerprint, archived: [] };
    await f.port.set(ACTIVITY_STORAGE_KEY, corrupt);
    const history = f.history();
    await assert.rejects(history.load(f.scope(), guard), { code: 'INVALID' });
    await assert.rejects(history.archiveTerminal(f.record(1), guard), { code: 'INVALID' });
    assert.deepEqual(await f.port.get(ACTIVITY_STORAGE_KEY), corrupt);
  } finally { await f.cleanup(); }
});

test('imported history retains its own identity across retirement and never appears in HD scope', async () => {
  const f = await fixture();
  try {
    const history = f.history();
    await history.archiveTerminal(f.record(1), guard);
    await history.archiveTerminal(f.record(2, { accountId: 'imported:60:0' }), guard);
    assert.deepEqual((await history.load(f.scope(), guard)).archived.map((entry) => entry.hash), [entryHash(1)]);
    const importedScope = createActivityScope(f.fingerprint, 'imported:60:0', wallet.address, 'ethereum');
    assert.deepEqual((await history.load(importedScope, guard)).archived.map((entry) => entry.hash), [entryHash(2)]);
    const reimportedScope = createActivityScope(f.fingerprint, 'imported:60:1', wallet.address, 'ethereum');
    assert.deepEqual((await history.load(reimportedScope, guard)).archived, []);
    await f.reopen();
    assert.deepEqual((await f.history().load(importedScope, guard)).archived.map((entry) => entry.hash), [entryHash(2)]);
  } finally { await f.cleanup(); }
});

test('revising an observed outcome preserves immutable archived transaction identity', async () => {
  const f = await fixture();
  try {
    const history = f.history(), original = f.record(1);
    await history.archiveTerminal(original, guard);
    await history.archiveTerminal({ ...original, phase: 'reverted' }, guard);
    assert.equal((await history.load(f.scope(), guard)).archived[0]!.phase, 'reverted');
    await assert.rejects(history.archiveTerminal({ ...original, phase: 'reverted', amountUnits: '999' }, guard), { code: 'INVALID' });
    assert.equal((await history.load(f.scope(), guard)).archived[0]!.amountUnits, original.amountUnits);
  } finally { await f.cleanup(); }
});
