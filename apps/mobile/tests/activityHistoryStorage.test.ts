import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Wallet } from 'ethers/wallet';
import { NativeActivityHistory, ACTIVITY_STORAGE_KEY, inspectRecoveryHistory } from '../src/activity/historyStore.ts';
import { createActivityScope, type TerminalActivityRecord } from '../src/activity/types.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { encodeStorageValue } from '../src/storage/json.ts';
import type { KeyringStoragePort } from '../src/storage/types.ts';
import { digest, INSTALLATION, nodeConnection, validPair, type SqlHook } from './storageHelpers.ts';

const wallet = new Wallet(`0x${'1'.padStart(64, '0')}`);
const RECIPIENT = '0x1111111111111111111111111111111111111111';
const TOKEN = '0x2222222222222222222222222222222222222222';
const guard = () => undefined;
const entryHash = (index: number) => `0x${index.toString(16).padStart(64, '0')}`;
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
    async reopen() {
      await storage.close().catch(() => undefined);
      owned = nodeConnection(file);
      storage = await SqliteWalletStorage.open(owned.connection, digest, INSTALLATION, false);
    },
    async cleanup() { await storage.close().catch(() => undefined); await rm(directory, { recursive: true, force: true }); },
  };
}
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

test('ERC20 archive preserves reviewed full-range metadata without retaining transaction secrets', async () => {
  const f = await fixture();
  try {
    const token = { contractAddress: TOKEN, decimals: 255, symbol: '😀'.repeat(64), name: '😀'.repeat(128) };
    const record = f.record(1, { recipient: RECIPIENT, amountUnits: '1234567', maximumFeeUnits: '100000', token });
    await f.history().archiveTerminal(record, guard);
    await f.reopen();
    const [archived] = (await f.history().load(f.scope(), guard)).archived;
    assert.equal(archived?.recipient, RECIPIENT); assert.equal(archived?.amountUnits, '1234567');
    assert.equal(archived?.maximumFeeUnits, '100000'); assert.deepEqual(archived?.token, token);
    assert.equal(Object.hasOwn(archived!, 'rawTransaction'), false);
  } finally { await f.cleanup(); }
});

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

test('empty cache groups stay within the existing limit without changing archived records or keys', async () => {
  const f = await fixture();
  try {
    const history = f.history(), record = f.record(1);
    await history.archiveTerminal(record, guard);
    const archived = encodeStorageValue((await history.load(f.scope(), guard)).archived);
    const pairBefore = [await f.port.get('vault'), await f.port.get('vault-keys')].map(encodeStorageValue);
    for (let index = 0; index < 25; index++) await history.saveCache(f.scope(index), [], guard);
    const stored = await f.port.get(ACTIVITY_STORAGE_KEY) as { cached: { sourceId: string; candidates: unknown[] }[]; archived: unknown[]; truncated: boolean };
    assert.equal(stored.cached.length, 24);
    assert.equal(stored.cached.reduce((count, group) => count + group.candidates.length, 0), 0);
    assert.equal(stored.cached[0]?.sourceId, f.scope(24).sourceId);
    assert.equal(stored.cached.some(group => group.sourceId === f.scope(0).sourceId), false);
    assert.equal(stored.truncated, true);
    assert.equal(inspectRecoveryHistory(stored, f.fingerprint).summaries, 1);
    assert.equal(encodeStorageValue(stored.archived), archived);
    assert.deepEqual([await f.port.get('vault'), await f.port.get('vault-keys')].map(encodeStorageValue), pairBefore);
    await f.reopen();
    const reopened = await f.history().load(f.scope(24), guard);
    assert.deepEqual(reopened.candidates, []);
    assert.equal(reopened.truncated, true);
    assert.equal(encodeStorageValue((await f.history().load(f.scope(), guard)).archived), archived);
    assert.deepEqual([await f.port.get('vault'), await f.port.get('vault-keys')].map(encodeStorageValue), pairBefore);
  } finally { await f.cleanup(); }
});
