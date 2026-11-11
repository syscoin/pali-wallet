import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createSLHDSAProvisionedState,
  createSlhDsaStateStore,
  type SlhDsaStateStorage,
} from '../../../source/wallet/slhDsaState.ts';
import { createSlhDsaSigner } from '../../../source/wallet/slhDsaSigner.ts';
import { createNativeSlhDsaRuntime, readNativeSlhPublicStates, type NativeSlhActionSecrets, type NativeSlhExecutionFactory } from '../src/smartAccount/slhDsaRuntime.ts';
import type { NativeSlhKey, NativeSlhTree } from '../src/crypto/slhDsaNativeExecution.ts';
import type { SlhDsaExecutionHost } from '../../../source/wallet/slhDsaExecution.ts';
import { createSlhDsaProfileStateCrypto } from '../../../source/wallet/slhDsaStateCrypto.ts';
import { deriveSLHDSASeedMaterial } from '../../../source/utils/slhDsa/derivation.ts';
import { getSLHDSAStateStorageKey } from '../../../source/utils/slhDsa/constants.ts';
import { bytesToHex } from '../../../source/utils/slhDsa/hex.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { digest, INSTALLATION, nodeConnection, type SqlHook } from './storageHelpers.ts';

const require = createRequire(import.meta.url);
const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'Public SLH composition fixture 1!';
let savedFetch: typeof fetch;
let networkCalls = 0;
before(() => {
  savedFetch = globalThis.fetch;
  globalThis.fetch = (() => { networkCalls++; throw Error('Network forbidden in SLH composition tests'); }) as typeof fetch;
});
after(() => { globalThis.fetch = savedFetch; assert.equal(networkCalls, 0); });
const gate = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
};
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

/** Fake public primitives only; actual SDK profile encryption and SQLite are used below. */
async function nativeFixture(phrase = PHRASE) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-slh-state-'));
  const file = path.join(directory, 'wallet.sqlite');
  const hooks: { before?: SqlHook; after?: SqlHook } = {};
  const { connection } = nodeConnection(file, hooks);
  const storage = await SqliteWalletStorage.open(connection, digest, INSTALLATION, true);
  const { SoftwareKeyring, createKeyringHost } = require('@sidhujag/sysweb3-keyring/cjs/software');
  const keyring = new SoftwareKeyring(createKeyringHost(storage.keyringStorage), { captureEvmSubmission: null, secretLifetime: 'session' });
  const vaultState = { activeAccount: { id: 0, type: 'HDAccount' }, activeNetwork: {
    kind: 'ethereum', chainId: 1, slip44: 60, currency: 'ETH', url: 'https://offline.invalid',
  }, accounts: { HDAccount: {} as Record<number, unknown>, Imported: {}, Ledger: {}, Trezor: {}, SmartAccount: {} } };
  keyring.setVaultStateGetter(() => vaultState);
  vaultState.accounts.HDAccount[0] = await keyring.initializeWalletSecurely(phrase, PASSWORD);
  const lifetime = new AbortController();
  let valid = true, faults = 0, opened = 0, retired = 0, signatures = 0;
  let finish: (() => Promise<Uint8Array>) | undefined;
  let holdEncrypt: (() => Promise<void>) | undefined;
  let holdRead: (() => Promise<void>) | undefined;
  let holdRetire: (() => Promise<void>) | undefined;
  let authorizationOpen = false, scopedAccessOpen = false;
  const seedInputs: Uint8Array[] = [];
  const trees = new Map<string, Uint8Array>();
  const roots = new WeakMap<NativeSlhTree, Uint8Array>();
  const pending = new Set<Promise<unknown>>();
  const backgrounds: (() => void)[] = [];
  const captured = keyring.captureUnlockedSessionGuard();
  const wallet = () => { if (!valid) throw Error('retired wallet'); captured(); };
  const namespace = await keyring.getPrivateRecordProfileId();
  const originalEncrypt = keyring.encryptPrivateRecord.bind(keyring);
  const boundKeyring = {
    deriveSLHDSASetupSecretForAccount: keyring.deriveSLHDSASetupSecretForAccount.bind(keyring),
    decryptPrivateRecord: keyring.decryptPrivateRecord.bind(keyring),
    async encryptPrivateRecord(input: Parameters<typeof originalEncrypt>[0]) {
      const encrypted = await originalEncrypt(input);
      await holdEncrypt?.();
      return encrypted;
    },
  };
  const readPublicStates = async (ring = boundKeyring, saved = storage, check = wallet) => {
    const rows = (await saved.recovery.readSnapshot()).records;
    const decoded = await Promise.all(rows.map(async row => ({ key: row.key, value: await saved.keyringStorage.get(row.key) })));
    return readNativeSlhPublicStates(decoded, ring, check);
  };
  const authorize = async <T>(purpose: 'setup' | 'sign', accountIndex: number | null, signal: AbortSignal, check: () => void, work: (secrets: NativeSlhActionSecrets) => Promise<T>): Promise<T> => {
    check(); if (signal.aborted) throw Error('SLH_DSA_EXECUTION_RETIRED');
    const setup = purpose === 'setup' ? await boundKeyring.deriveSLHDSASetupSecretForAccount({ accountIndex: accountIndex! }) : null;
    check(); if (signal.aborted) throw Error('SLH_DSA_EXECUTION_RETIRED');
    authorizationOpen = true; scopedAccessOpen = true;
    try { return await work({ setup, crypto: boundKeyring, dispose() { scopedAccessOpen = false; } }); }
    finally { authorizationOpen = false; }
  };
  const openExecution: NativeSlhExecutionFactory = owner => {
    wallet(); assert.equal(owner.namespace, namespace); opened++;
    let contextClosed = false;
    backgrounds.push(() => { contextClosed = true; });
    const host: SlhDsaExecutionHost<NativeSlhTree, NativeSlhKey> = {
      leafConcurrency: 1, forsConcurrency: 1,
      allocateTree() { const tree = { async release() {} }; roots.set(tree, new Uint8Array(16).fill(0x44)); return tree; },
      releaseTree: (tree, erase) => tree.release(erase),
      readTree(tree, offset, length) { assert.equal(offset, 134217696); assert.equal(length, 16); return roots.get(tree)!.slice(); },
      writeTree() { throw Error('serial fixture has no leaf lanes'); },
      async loadTree(keyId) { const root = trees.get(keyId); if (!root) return null; const tree = { async release() {} }; roots.set(tree, root.slice()); return { tree, keyId, bytes: 134217712 }; },
      async saveTree(keyId, tree) { trees.set(keyId, roots.get(tree)!.slice()); },
      openSetup(seed) { seedInputs.push(seed.slice()); return { buildChunk: (_tree, _level, _start, count) => count, dispose() {} }; },
      createLeafLanes() { throw Error('native serial fixture has no browser workers'); },
      importKey() { return { destroy() {} }; }, releaseKey: key => key.destroy(),
      signPrelude(_key, message) { assert.equal(message.length, 34); assert.deepEqual([...message.subarray(0, 2)], [0, 0]); return new Uint8Array(46); },
      async signForsTree(_key, _prelude, treeIndex) { return { treeIndex, shard: new Uint8Array(416) }; },
      finishSignature() {
        signatures++;
        const work = finish ? finish() : Promise.resolve(new Uint8Array(3856).fill(9));
        pending.add(work);
        void work.then(() => pending.delete(work), () => pending.delete(work));
        return work;
      },
      signCached() { throw Error('cached fallback must not occur in this fixture'); },
      randomFill: bytes => { bytes.fill(0x77); }, yield: async () => undefined,
    };
    return { host, retire() { contextClosed = true; retired++; return Promise.allSettled([...pending]).then(() => holdRetire?.()); }, isRetired: () => contextClosed, async verify() { throw Error('Signature verification requires a qualified native backend'); } };
  };
  const runtime = createNativeSlhDsaRuntime({ namespace, publicStates: await readPublicStates(), authorize, storage: { ...storage.keyringStorage, async get(key) { const value = await storage.keyringStorage.get(key); await holdRead?.(); return value; } },
    assertCurrent: wallet, openExecution, now: () => 1234,
    onStorageFault() { faults++; valid = false; void keyring.lockWallet(); void runtime.retire().catch(() => undefined); },
  });
  const crypto = createSlhDsaProfileStateCrypto(keyring, wallet);
  return {
    runtime, keyring, storage, hooks, crypto, wallet, namespace, seedInputs, file, vaultState, authorize, readPublicStates, signal: lifetime.signal,
    counts: () => ({ faults, opened, retired, signatures }),
    holdFinish: (next: () => Promise<Uint8Array>) => { finish = next; },
    holdEncrypt: (next: () => Promise<void>) => { holdEncrypt = next; },
    holdRead: (next: () => Promise<void>) => { holdRead = next; },
    holdRetire: (next: () => Promise<void>) => { holdRetire = next; },
    authorization: () => ({ open: authorizationOpen, access: scopedAccessOpen }),
    stopWallet() { valid = false; lifetime.abort(); void keyring.lockWallet(); },
    async close() { lifetime.abort(); await runtime.retire(); await keyring.lockWallet(); await storage.close(); await rm(directory, { recursive: true, force: true }); },
    async fileBytes() { return readFile(file); },
    dropCache() { trees.clear(); },
    background() { for (const close of backgrounds) close(); },
    async reopenRuntime() { return createNativeSlhDsaRuntime({ namespace, publicStates: await readPublicStates(), authorize, storage: storage.keyringStorage, assertCurrent: wallet, openExecution, now: Date.now, onStorageFault() { faults++; valid = false; void keyring.lockWallet(); } }); },
    openExecution,
  };
}

test('SLH failed native acquisition releases authorization before draining the orphan context', async () => {
  const f = await nativeFixture(), cleanup = gate<void>(), entered = gate<void>();
  let runtime: ReturnType<typeof createNativeSlhDsaRuntime> | undefined, work: Promise<unknown> | undefined;
  try {
    f.holdRetire(async () => { entered.resolve(); await cleanup.promise; });
    runtime = createNativeSlhDsaRuntime({ namespace: f.namespace, publicStates: await f.readPublicStates(), authorize: f.authorize,
      storage: f.storage.keyringStorage, assertCurrent: f.wallet, now: Date.now, onStorageFault() { f.stopWallet(); },
      openExecution(owner) { return { ...f.openExecution(owner), isRetired: () => true }; },
    });
    work = runtime.prepareFresh(0, f.wallet, () => undefined, f.signal, null);
    void work.catch(() => undefined);
    await entered.promise;
    assert.equal(f.authorization().open, false);
    assert.equal(f.authorization().access, false);
    cleanup.resolve();
    await assert.rejects(work, /SLH_DSA_EXECUTION_RETIRED/);
    assert.equal(f.counts().retired, 1);
    assert.equal(f.counts().signatures, 0);
  } finally { cleanup.resolve(); await Promise.allSettled([work]); await runtime?.retire(); await f.close(); }
});

test('SLH native cleanup failure remains fail-closed after authorization releases', async () => {
  const f = await nativeFixture();
  try {
    const state = await f.runtime.prepareFresh(0, f.wallet, () => undefined, f.signal, null);
    f.holdRetire(async () => {
      assert.equal(f.authorization().open, false);
      assert.equal(f.authorization().access, false);
      throw Error('native cleanup failed');
    });
    await assert.rejects(f.runtime.signActionHash({ ...state, actionHash: `0x${'aa'.repeat(32)}` }, null, f.wallet, f.signal, null), /native cleanup failed/);
    assert.equal(f.counts().faults, 1);
    assert.throws(() => f.runtime.signActionHash({ ...state, actionHash: `0x${'bb'.repeat(32)}` }, null, f.wallet, f.signal, null), /retired/);
    assert.equal(f.counts().signatures, 1);
  } finally { await f.close(); }
});

test('shared SLH state round trips directly without browser globals or a module resolver', async () => {
  assert.equal(typeof (globalThis as { chrome?: unknown }).chrome, 'undefined');
  const rows = new Map<string, unknown>();
  let current = true;
  const assertOwner = () => {
    if (!current) throw new Error('retired owner');
  };
  const read: SlhDsaStateStorage['read'] = async (key) =>
    rows.has(key)
      ? { present: true, value: rows.get(key) }
      : { present: false };
  const store = createSlhDsaStateStore({
    read,
    async mutate(owner, run) {
      owner();
      const result = await run({
        read,
        async write(key, value) {
          rows.set(key, structuredClone(value));
        },
        async remove(key) {
          rows.delete(key);
        },
      });
      owner();
      return result;
    },
  });
  // Public fixture codec only. Native encryption has a separate qualification.
  const crypto = {
    async encrypt(value: string, keyId: string) {
      return JSON.stringify({ keyId, value });
    },
    async decrypt(envelope: string, keyId: string) {
      const parsed = JSON.parse(envelope);
      assert.equal(parsed.keyId, keyId);
      return parsed.value;
    },
  };
  const state = createSLHDSAProvisionedState({
    keyId: 'public-node-fixture',
    accountIndex: 0,
    derivationLabel: 'public fixture',
    pkRoot: '0x' + '11'.repeat(16),
    pkSeed: '0x' + '22'.repeat(16),
    secretKeyHex: '0x' + '33'.repeat(64),
  });
  state.signatureCount = 7;
  await store.save(state, crypto, assertOwner);
  assert.deepEqual(
    await store.load({ crypto, keyId: state.keyId, assertOwner }),
    state
  );
  const retained = structuredClone([...rows]);
  current = false;
  await assert.rejects(
    store.save({ ...state, signatureCount: 8 }, crypto, assertOwner),
    /retired owner/
  );
  await assert.rejects(
    store.load({ crypto, keyId: state.keyId, assertOwner }),
    /retired owner/
  );
  assert.deepEqual([...rows], retained);
  current = true;
  await store.remove(state.keyId, assertOwner);
  assert.equal(
    await store.load({ crypto, keyId: state.keyId, assertOwner }),
    null
  );
});

test('shared SLH signer factory imports directly and requires explicit host ports', () => {
  assert.equal(typeof (globalThis as { chrome?: unknown }).chrome, 'undefined');
  assert.throws(
    () =>
      createSlhDsaSigner({
        stateStore: undefined as never,
        execution: undefined as never,
        now: () => 0,
      }),
    /signer host is unavailable/
  );
});

test('native composition uses the real SDK derivation and complete profile-encrypted SQLite state', async () => {
  const f = await nativeFixture();
  try {
    for (const accountIndex of [0, 1]) {
      const expected = await f.keyring.deriveSLHDSASetupSecretForAccount({ accountIndex });
      const material = await deriveSLHDSASeedMaterial(expected.setupSecretHex);
      const state = await f.runtime.prepareFresh(accountIndex, f.wallet, () => undefined, f.signal, null);
      assert.equal(state.accountIndex, accountIndex);
      assert.equal(state.derivationLabel, expected.derivationLabel);
      assert.equal(bytesToHex(f.seedInputs[accountIndex]!), material.seed48Hex);
      assert.equal('secretKeyHex' in state, false);
      const row = await f.storage.keyringStorage.get(getSLHDSAStateStorageKey(state.keyId)) as { cipherText: string };
      const privateRecord = JSON.parse(row.cipherText);
      assert.equal(privateRecord.profileId, f.namespace);
      assert.equal(privateRecord.domain, 'org.syscoin.pali.slh-dsa-state.v1');
      const restored = JSON.parse(await f.crypto.decrypt(row.cipherText, state.keyId));
      assert.equal(restored.keyId, state.keyId);
      assert.equal(restored.signatureCount, 0);
      assert.equal(typeof restored.secretKeyHex, 'string');
      assert.equal(JSON.stringify(row).includes(restored.secretKeyHex), false);
      assert.equal((await f.fileBytes()).includes(Buffer.from(restored.secretKeyHex)), false);
    }
    assert.notEqual(bytesToHex(f.seedInputs[0]!), bytesToHex(f.seedInputs[1]!));
  } finally { await f.close(); }
});

test('signature delivery waits for the real guarded SQLite COMMIT and restores saved high-water state', async () => {
  const f = await nativeFixture(); const held = gate<void>(), entered = gate<void>();
  try {
    const state = await f.runtime.prepareFresh(0, f.wallet, () => undefined, f.signal, null);
    let armed = true;
    f.hooks.before = async (kind, sql) => { if (armed && kind === 'exec' && sql === 'COMMIT') { armed = false; entered.resolve(); await held.promise; } };
    let delivered = false;
    const signing = f.runtime.signActionHash({ ...state, actionHash: `0x${'aa'.repeat(32)}` }, null, f.wallet, f.signal, null).then(value => { delivered = true; return value; });
    await entered.promise; await tick();
    assert.equal(delivered, false);
    held.resolve();
    assert.equal((await signing).length, 2 + 3856 * 2);
    await f.runtime.retire();
    const reopened = createNativeSlhDsaRuntime({ namespace: f.namespace, publicStates: await f.readPublicStates(), authorize: f.authorize, storage: f.storage.keyringStorage,
      assertCurrent: f.wallet, openExecution: f.openExecution, now: Date.now, onStorageFault() { throw Error('unexpected storage fault'); } });
    try {
      assert.equal((await reopened.hydrateInstalled(state, f.wallet)).signatureCount, 1);
      await reopened.signActionHash({ ...state, actionHash: `0x${'bb'.repeat(32)}` }, null, f.wallet, f.signal, null);
      const row = await f.storage.keyringStorage.get(getSLHDSAStateStorageKey(state.keyId)) as { cipherText: string };
      assert.equal(JSON.parse(await f.crypto.decrypt(row.cipherText, state.keyId)).signatureCount, 2);
    } finally { await reopened.retire(); }
  } finally { held.resolve(); await f.close(); }
});

test('a different raw row read during held encryption cannot authorize a stale counter overwrite', async () => {
  const f = await nativeFixture(); const held = gate<void>(), entered = gate<void>();
  try {
    const state = await f.runtime.prepareFresh(0, f.wallet, () => undefined, f.signal, null);
    const key = getSLHDSAStateStorageKey(state.keyId);
    const before = await f.storage.keyringStorage.get(key) as { cipherText: string; updatedAt: number };
    const plain = JSON.parse(await f.crypto.decrypt(before.cipherText, state.keyId));
    const advanced = { ...before, cipherText: await f.crypto.encrypt(JSON.stringify({ ...plain, signatureCount: 10 }), state.keyId), updatedAt: before.updatedAt + 1 };
    f.holdEncrypt(async () => { entered.resolve(); await held.promise; });
    const signing = f.runtime.signActionHash({ ...state, actionHash: `0x${'aa'.repeat(32)}` }, null, f.wallet, f.signal, null);
    await entered.promise;
    assert.equal(await f.storage.keyringStorage.compareAndSet(key, before, advanced, undefined, f.wallet), true);
    await assert.rejects(f.runtime.hydrateInstalled(state, f.wallet), /STORAGE_CHANGED|retired wallet|session/i);
    held.resolve();
    await assert.rejects(signing);
    assert.deepEqual(await f.storage.keyringStorage.get(key), advanced);
    assert.equal(f.counts().faults, 1);
  } finally { held.resolve(); await f.close(); }
});

test('lost COMMIT acknowledgement preserves the record and suppresses signature release', async () => {
  const f = await nativeFixture();
  try {
    const state = await f.runtime.prepareFresh(0, f.wallet, () => undefined, f.signal, null);
    let armed = true;
    f.hooks.after = (kind, sql) => { if (armed && kind === 'exec' && sql === 'COMMIT') { armed = false; throw Error('acknowledgement lost'); } };
    await assert.rejects(f.runtime.signActionHash({ ...state, actionHash: `0x${'aa'.repeat(32)}` }, null, f.wallet, f.signal, null));
    assert.equal(f.counts().faults, 1);
    assert.equal(f.counts().signatures, 1);
    await assert.rejects(f.storage.keyringStorage.get(getSLHDSAStateStorageKey(state.keyId)), /STORAGE_REOPEN_REQUIRED/);
  } finally { await f.close(); }
});

test('request retirement after dispatch persists usage but cannot deliver the signature', async () => {
  const f = await nativeFixture(); const held = gate<Uint8Array>(), entered = gate<void>();
  try {
    const state = await f.runtime.prepareFresh(0, f.wallet, () => undefined, f.signal, null);
    let requestCurrent = true;
    const request = () => { if (!requestCurrent) throw Error('retired request'); };
    f.holdFinish(() => { entered.resolve(); return held.promise; });
    const signing = f.runtime.signActionHash({ ...state, actionHash: `0x${'aa'.repeat(32)}` }, {
      assertCurrent: request, checkDocument: async () => { request(); },
    }, request, f.signal, null);
    await entered.promise; requestCurrent = false;
    held.resolve(new Uint8Array(3856).fill(9));
    await assert.rejects(signing, /retired request/);
    const row = await f.storage.keyringStorage.get(getSLHDSAStateStorageKey(state.keyId)) as { cipherText: string };
    assert.equal(JSON.parse(await f.crypto.decrypt(row.cipherText, state.keyId)).signatureCount, 1);
    assert.equal(f.counts().faults, 0);
  } finally { held.resolve(new Uint8Array(3856)); await f.close(); }
});

test('pre-dispatch rejection starts no primitive and changes no durable usage', async () => {
  const f = await nativeFixture();
  try {
    const state = await f.runtime.prepareFresh(0, f.wallet, () => undefined, f.signal, null);
    const before = await f.storage.keyringStorage.get(getSLHDSAStateStorageKey(state.keyId));
    await assert.rejects(f.runtime.signActionHash({ ...state, actionHash: `0x${'aa'.repeat(32)}` }, {
      assertCurrent: () => undefined, checkDocument: async () => { throw Error('consent retired'); },
    }, f.wallet, f.signal, null), /consent retired/);
    assert.equal(f.counts().signatures, 0);
    assert.deepEqual(await f.storage.keyringStorage.get(getSLHDSAStateStorageKey(state.keyId)), before);
  } finally { await f.close(); }
});

test('wallet retirement synchronously revokes the context and joins started execution', async () => {
  const f = await nativeFixture(); const held = gate<Uint8Array>(), entered = gate<void>();
  try {
    const state = await f.runtime.prepareFresh(0, f.wallet, () => undefined, f.signal, null);
    f.holdFinish(() => { entered.resolve(); return held.promise; });
    const signing = f.runtime.signActionHash({ ...state, actionHash: `0x${'aa'.repeat(32)}` }, null, f.wallet, f.signal, null);
    await entered.promise;
    f.stopWallet();
    let closed = false;
    const closing = f.runtime.retire().then(() => { closed = true; });
    assert.equal(f.counts().retired, 2); await tick(); assert.equal(closed, false);
    held.resolve(new Uint8Array(3856).fill(9));
    await assert.rejects(signing); await closing;
    assert.equal(closed, true);
  } finally { held.resolve(new Uint8Array(3856)); await f.close(); }
});

test('missing installed state refuses hydration and rebuild without invoking native setup', async () => {
  const f = await nativeFixture();
  let reopened: ReturnType<typeof createNativeSlhDsaRuntime> | undefined;
  try {
    const state = await f.runtime.prepareFresh(0, f.wallet, () => undefined, f.signal, null);
    await f.runtime.retire();
    const key = getSLHDSAStateStorageKey(state.keyId), before = await f.storage.keyringStorage.get(key);
    assert.equal(await f.storage.keyringStorage.compareAndSetMany([{ key, expected: before, value: undefined }], f.wallet), true);
    reopened = await f.reopenRuntime();
    await assert.rejects(reopened.hydrateInstalled(state, f.wallet), /INSTALLED_STATE_MISSING/);
    await assert.rejects(reopened.rebuildInstalled(state, f.wallet, () => undefined, f.signal, null), /INSTALLED_STATE_MISSING/);
    assert.equal(f.counts().opened, 1);
    assert.equal(f.seedInputs.length, 1);
  } finally { await reopened?.retire(); await f.close(); }
});

test('cache loss rebuilds only the verified saved key and preserves its durable high-water count', async () => {
  const f = await nativeFixture();
  let reopened: ReturnType<typeof createNativeSlhDsaRuntime> | undefined;
  try {
    const state = await f.runtime.prepareFresh(0, f.wallet, () => undefined, f.signal, null);
    await f.runtime.signActionHash({ ...state, actionHash: `0x${'aa'.repeat(32)}` }, null, f.wallet, f.signal, null);
    await f.runtime.retire(); f.dropCache();
    reopened = await f.reopenRuntime();
    assert.equal((await reopened.hydrateInstalled(state, f.wallet)).signatureCount, 1);
    await assert.rejects(reopened.signActionHash({ ...state, actionHash: `0x${'aa'.repeat(32)}` }, null, f.wallet, f.signal, null), /cache is missing/);
    const rebuilt = await reopened.rebuildInstalled(state, f.wallet, () => undefined, f.signal, null);
    assert.equal(rebuilt.keyId, state.keyId); assert.equal(rebuilt.signatureCount, 1);
    await reopened.signActionHash({ ...state, actionHash: `0x${'bb'.repeat(32)}` }, null, f.wallet, f.signal, null);
    const row = await f.storage.keyringStorage.get(getSLHDSAStateStorageKey(state.keyId)) as { cipherText: string };
    assert.equal(JSON.parse(await f.crypto.decrypt(row.cipherText, state.keyId)).signatureCount, 2);
  } finally { await reopened?.retire(); await f.close(); }
});

test('a record encrypted for another real SDK profile cannot become native signing state', async () => {
  const a = await nativeFixture();
  const b = await nativeFixture('legal winner thank year wave sausage worth useful legal winner thank yellow');
  try {
    const state = await a.runtime.prepareFresh(0, a.wallet, () => undefined, a.signal, null);
    const key = getSLHDSAStateStorageKey(state.keyId), row = await a.storage.keyringStorage.get(key);
    assert.notEqual(a.namespace, b.namespace);
    assert.equal(await b.storage.keyringStorage.compareAndSetMany([{ key, expected: undefined, value: row }], b.wallet), true);
    await assert.rejects(b.runtime.hydrateInstalled(state, b.wallet));
    assert.equal(b.counts().opened, 0); assert.equal(b.counts().faults, 1);
  } finally { await Promise.all([a.close(), b.close()]); }
});

test('cold SQLite and real SDK unlock recover the saved private record without deriving a new key', async () => {
  const f = await nativeFixture();
  let reopened: SqliteWalletStorage | undefined;
  let hydrated: ReturnType<typeof createNativeSlhDsaRuntime> | undefined;
  let ring: typeof f.keyring;
  try {
    const state = await f.runtime.prepareFresh(0, f.wallet, () => undefined, f.signal, null);
    await f.runtime.signActionHash({ ...state, actionHash: `0x${'aa'.repeat(32)}` }, null, f.wallet, f.signal, null);
    await f.runtime.retire(); await f.keyring.lockWallet(); await f.storage.close();
    reopened = await SqliteWalletStorage.open(nodeConnection(f.file).connection, digest, INSTALLATION, false);
    const { SoftwareKeyring, createKeyringHost } = require('@sidhujag/sysweb3-keyring/cjs/software');
    ring = new SoftwareKeyring(createKeyringHost(reopened.keyringStorage), { captureEvmSubmission: null, secretLifetime: 'session' });
    ring.setVaultStateGetter(() => f.vaultState);
    assert.equal((await ring.unlock(PASSWORD)).canLogin, true);
    const namespace = await ring.getPrivateRecordProfileId(); assert.equal(namespace, f.namespace);
    const check = ring.captureUnlockedSessionGuard();
    hydrated = createNativeSlhDsaRuntime({ namespace, publicStates: await f.readPublicStates(ring, reopened, check),
      async authorize(purpose, accountIndex, signal, guard, work) {
        check(); guard(); if (signal.aborted) throw Error('SLH_DSA_EXECUTION_RETIRED');
        const setup = purpose === 'setup' ? await ring.deriveSLHDSASetupSecretForAccount({ accountIndex: accountIndex! }) : null;
        return work({ setup, crypto: ring, dispose() {} });
      }, storage: reopened.keyringStorage,
      assertCurrent: check, openExecution() { throw Error('hydration must not rederive or start native crypto'); },
      onStorageFault() { throw Error('unexpected cold storage fault'); }, now: Date.now,
    });
    assert.equal((await hydrated.hydrateInstalled(state, check)).signatureCount, 1);
  } finally { await hydrated?.retire(); await ring?.lockWallet(); await reopened?.close(); await f.close(); }
});

test('an installed saved key that cannot match SDK derivation refuses rebuild without resetting usage', async () => {
  const f = await nativeFixture();
  let reopened: ReturnType<typeof createNativeSlhDsaRuntime> | undefined;
  try {
    const state = await f.runtime.prepareFresh(0, f.wallet, () => undefined, f.signal, null);
    await f.runtime.signActionHash({ ...state, actionHash: `0x${'aa'.repeat(32)}` }, null, f.wallet, f.signal, null);
    await f.runtime.retire(); f.dropCache();
    const key = getSLHDSAStateStorageKey(state.keyId), before = await f.storage.keyringStorage.get(key) as { cipherText: string };
    const imported = JSON.parse(await f.crypto.decrypt(before.cipherText, state.keyId));
    const derivation = await f.keyring.deriveSLHDSASetupSecretForAccount({ accountIndex: 1 });
    const next = { ...before, cipherText: await f.crypto.encrypt(JSON.stringify({ ...imported,
      accountIndex: 1, derivationLabel: derivation.derivationLabel }), state.keyId) };
    assert.equal(await f.storage.keyringStorage.compareAndSetMany([{ key, expected: before, value: next }], f.wallet), true);
    reopened = await f.reopenRuntime();
    assert.equal((await reopened.hydrateInstalled(state, f.wallet)).signatureCount, 1);
    await assert.rejects(reopened.rebuildInstalled(state, f.wallet, () => undefined, f.signal, null), /does not match/);
    assert.deepEqual(await f.storage.keyringStorage.get(key), next);
  } finally { await reopened?.retire(); await f.close(); }
});

test('retired native contexts never retry old work and reopen only for a new explicit review', async () => {
  const f = await nativeFixture(); const held = gate<Uint8Array>(), entered = gate<void>();
  try {
    const state = await f.runtime.prepareFresh(0, f.wallet, () => undefined, f.signal, null);
    let first = true;
    f.holdFinish(() => {
      if (first) { first = false; entered.resolve(); return held.promise; }
      return Promise.resolve(new Uint8Array(3856).fill(9));
    });
    const old = f.runtime.signActionHash({ ...state, actionHash: `0x${'aa'.repeat(32)}` }, null, f.wallet, f.signal, null);
    await entered.promise; f.background(); held.resolve(new Uint8Array(3856).fill(9));
    await assert.rejects(old, /EXECUTION_RETIRED/);
    assert.equal(f.counts().opened, 2); assert.equal(f.counts().signatures, 1);
    assert.equal((await f.runtime.hydrateInstalled(state, f.wallet)).signatureCount, 0);
    assert.equal(f.counts().opened, 2);
    await f.runtime.signActionHash({ ...state, actionHash: `0x${'bb'.repeat(32)}` }, null, f.wallet, f.signal, null);
    assert.equal(f.counts().opened, 3); assert.equal(f.counts().signatures, 2);
    assert.equal((await f.runtime.hydrateInstalled(state, f.wallet)).signatureCount, 1);
  } finally { held.resolve(new Uint8Array(3856)); await f.close(); }
});

test('local consent retired during a held state read cannot dispatch native signing', async () => {
  const f = await nativeFixture(); const held = gate<void>(), entered = gate<void>();
  try {
    const state = await f.runtime.prepareFresh(0, f.wallet, () => undefined, f.signal, null);
    let current = true;
    const review = () => { if (!current) throw Error('local review retired'); };
    f.holdRead(async () => { entered.resolve(); await held.promise; });
    const signing = f.runtime.signActionHash({ ...state, actionHash: `0x${'aa'.repeat(32)}` }, null, review, f.signal, null);
    await entered.promise; current = false; held.resolve();
    await assert.rejects(signing, /local review retired/);
    assert.equal(f.counts().signatures, 0); assert.equal(f.counts().faults, 0);
  } finally { held.resolve(); await f.close(); }
});

test('an old pre-dispatch review cannot adopt a replacement execution context', async () => {
  const f = await nativeFixture(); const held = gate<void>(), entered = gate<void>();
  try {
    const state = await f.runtime.prepareFresh(0, f.wallet, () => undefined, f.signal, null);
    let first = true;
    f.holdRead(async () => { if (first) { first = false; entered.resolve(); await held.promise; } });
    let current = true;
    const originalReview = () => { if (!current) throw Error('original review retired'); };
    const old = f.runtime.signActionHash({ ...state, actionHash: `0x${'aa'.repeat(32)}` }, null, originalReview, f.signal, null);
    await entered.promise; current = false;
    await f.runtime.hydrateInstalled(state, f.wallet);
    held.resolve();
    await assert.rejects(old, /original review retired/);
    assert.equal(f.counts().opened, 1); assert.equal(f.counts().signatures, 0);
    await f.runtime.signActionHash({ ...state, actionHash: `0x${'bb'.repeat(32)}` }, null, f.wallet, f.signal, null);
    assert.equal(f.counts().opened, 2); assert.equal(f.counts().signatures, 1);
  } finally { held.resolve(); await f.close(); }
});
