import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as sdk from '@sidhujag/sysweb3-keyring/cjs/software.js';
import { createNoteBackupCodec, type INoteBackupEntry } from '../../../source/wallet/noteBackup.ts';
import { NOTE_BACKUP_PREVIEW_TTL_MS } from '../../../source/wallet/noteBackupService.ts';
import { createKeyringRuntimeFactory, type KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { digest, INSTALLATION, nodeConnection } from './storageHelpers.ts';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'PUBLIC fixture wallet password 1!';
const BACKUP_PASSWORD = 'PUBLIC fixture file password 2!';
const NOTE = { note: `tornado-eth-1-1-0x${'01'.repeat(62)}`, createdAt: 10 };
const WRONG_PASSWORD = 'PUBLIC wrong password 3!';
const current = () => undefined;

const codec = () => createNoteBackupCodec({ crypto: globalThis.crypto, assertCurrent: current });
const encrypted = (notes: readonly INoteBackupEntry[] = [NOTE]) => codec().encrypt({ format: 'pali-private-notes', version: 1, createdAt: 20, notes }, BACKUP_PASSWORD);
let networkCalls = 0;
const originalFetch = globalThis.fetch;
test.before(() => {
  globalThis.fetch = (() => { networkCalls++; throw new Error('Network forbidden'); }) as typeof fetch;
});
test.after(() => {
  globalThis.fetch = originalFetch;
  assert.equal(networkCalls, 0);
});

function pause() {
  let release!: () => void, enter!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  return { entered, release, async wait() { enter(); await held; } };
}

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-note-backup-runtime-'));
  const file = path.join(directory, 'wallet.sqlite');
  let storage!: SqliteWalletStorage;
  let runtime!: KeyringRuntime;
  let initialized = false;
  let lostAck = false, noteWrite = false, noteWrites = 0, unlockCalls = 0;
  let loseAuthCommit = false, authWrite = false, lostAuthAcks = 0;
  let beforeUnlock: ReturnType<typeof pause> | undefined, afterUnlock: ReturnType<typeof pause> | undefined;
  let beforeNoteInsert: ReturnType<typeof pause> | undefined;
  let afterNoteRead: ReturnType<typeof pause> | undefined;
  let noteCommits = 0;
  const owners: sdk.SoftwareKeyring[] = [];
  class ObservedKeyring extends sdk.SoftwareKeyring {
    constructor(host: ConstructorParameters<typeof sdk.SoftwareKeyring>[0]) { super(host); owners.push(this); }
    override async unlock(password: string) {
      unlockCalls++;
      const before = beforeUnlock, after = afterUnlock;
      beforeUnlock = afterUnlock = undefined;
      if (before) await before.wait();
      const result = await super.unlock(password);
      if (after) await after.wait();
      return result;
    }
  }
  const factory = createKeyringRuntimeFactory({
    ensureCryptoReady: async () => undefined,
    loadSdk: async () => ({ ...sdk, SoftwareKeyring: ObservedKeyring }),
    async openStorage() {
      const { connection } = nodeConnection(file, { before(kind, sql) {
        if (kind === 'run' && sql.startsWith('INSERT INTO private_note_records') && beforeNoteInsert) {
          const gate = beforeNoteInsert;
          beforeNoteInsert = undefined;
          return gate.wait();
        }
      }, after(kind, sql) {
        if (kind === 'all' && sql.startsWith("SELECT 'note' AS source") && afterNoteRead) {
          const gate = afterNoteRead;
          afterNoteRead = undefined;
          return gate.wait();
        }
        if (kind === 'run' && sql.startsWith('INSERT INTO private_note_records')) {
          noteWrite = true;
          noteWrites++;
        }
        if (kind === 'exec' && noteWrite && sql === 'COMMIT') {
          noteWrite = false;
          noteCommits++;
          if (lostAck) { lostAck = false; throw new Error('Fixture lost note commit acknowledgement'); }
        }
        if (kind === 'exec' && authWrite && sql === 'COMMIT') {
          authWrite = false;
          if (loseAuthCommit) {
            loseAuthCommit = false;
            lostAuthAcks++;
            throw new Error('Fixture lost authentication commit acknowledgement');
          }
        }
        if (kind === 'exec' && sql === 'ROLLBACK') noteWrite = authWrite = false;
      } });
      const run = connection.runAsync.bind(connection);
      connection.runAsync = async (sql, parameters) => {
        const result = await run(sql, parameters);
        if (sql.startsWith('INSERT INTO wallet_metadata') && parameters?.[0] === 'auth') authWrite = true;
        return result;
      };
      storage = await SqliteWalletStorage.open(connection, digest, INSTALLATION, !initialized);
      initialized = true;
      return storage;
    },
  });
  runtime = await factory.open() as KeyringRuntime;
  await runtime.session.importWallet(PHRASE, PASSWORD);
  const failures = async (): Promise<number> => {
    const auth = (await storage.recovery.readSnapshot()).metadata.find(({ key }) => key === 'auth');
    return auth ? JSON.parse(auth.value).failures : 0;
  };
  return {
    get runtime() { return runtime; }, get storage() { return storage; },
    get unlocked() { return owners.some((owner) => owner.isUnlocked()); },
    get unlockCalls() { return unlockCalls; }, get noteWrites() { return noteWrites; },
    get lostAuthAcks() { return lostAuthAcks; },
    failures,
    holdUnlock(when: 'before' | 'after') {
      const gate = pause();
      if (when === 'before') beforeUnlock = gate;
      else afterUnlock = gate;
      return gate;
    },
    get noteCommits() { return noteCommits; },
    holdNoteInsert() { return beforeNoteInsert = pause(); },
    holdNoteRead() { return afterNoteRead = pause(); },
    loseAck() { lostAck = true; },
    loseAuthAck() { loseAuthCommit = true; },
    async reopen(unlock = true) {
      await runtime.storage.close();
      runtime = await factory.open() as KeyringRuntime;
      if (unlock) assert.deepEqual(await runtime.session.unlock(PASSWORD), { authenticated: true });
    },
    async dispose() {
      try { await runtime.storage.close(); }
      finally { await rm(directory, { recursive: true, force: true }); }
    },
  };
}

test('lock releases an inventory yield even if the native timer never fires', async (context) => {
  const f = await fixture();
  const setTimer = globalThis.setTimeout;
  let held: (() => void) | undefined;
  let slow: ReturnType<typeof setTimeout> | undefined;
  try {
    const file = await encrypted(Array.from({ length: 5 }, (_, index) => ({
      note: `tornado-eth-1-1-0x${String(index + 1).padStart(2, '0').repeat(62)}`, createdAt: index + 1,
    })));
    const view = await f.runtime.openNoteBackup!(current), id = view.begin();
    await view.prepareImport(id, file, BACKUP_PASSWORD);
    await view.commitImport(id, PASSWORD);
    await f.reopen();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    context.mock.method(globalThis, 'setTimeout', ((action: () => void, delay?: number) => {
      if (delay !== 0 || held) return setTimer(action, delay);
      held = action;
      slow = setTimer(action, 60_000);
      entered();
      return slow;
    }) as typeof setTimeout);
    const read = assert.rejects(f.runtime.readNoteInventory!(current), /privacy_vault_unavailable/);
    await started;
    await f.runtime.session.lock();
    const drained = await Promise.race([read.then(() => true), new Promise<boolean>((resolve) => setTimer(() => resolve(false), 250))]);
    assert.equal(drained, true);
    assert.equal(f.unlocked, false);
    assert.equal(f.noteWrites, 1);
  } finally {
    clearTimeout(slow);
    held?.();
    context.mock.restoreAll();
    await f.dispose();
  }
});

test('actual native owner imports and verifies an exact encrypted backup, with explicit one-use approval', async () => {
  const f = await fixture();
  try {
    const file = await encrypted();
    const view = await f.runtime.openNoteBackup!(current);
    const secondView = await f.runtime.openNoteBackup!(current);
    assert.doesNotThrow(() => secondView.cancel(undefined as unknown as string));
    const unlocks = f.unlockCalls;
    await assert.rejects(view.prepareImport(view.begin(), file, WRONG_PASSWORD), { code: 'BACKUP_OPEN_FAILED' });
    assert.equal(f.unlocked, true);
    assert.equal(f.unlockCalls, unlocks);
    assert.deepEqual(await f.storage.notes.read(), []);

    let id = view.begin();
    await assert.rejects(secondView.prepareImport(id, file, BACKUP_PASSWORD), { code: 'BACKUP_STALE' });
    const supplied = new Uint8Array(file);
    const preview = view.prepareImport(id, supplied, BACKUP_PASSWORD);
    supplied.fill(0);
    assert.deepEqual({ ...(await preview), expiresAt: undefined }, { id, added: 1, duplicates: 0, guarded: 1, expiresAt: undefined });
    await f.runtime.session.readSelectedAddress(); // Metadata refresh leaves this exact owner live.
    assert.deepEqual(await f.storage.notes.read(), []);
    await assert.rejects(view.commitImport(id, WRONG_PASSWORD), { code: 'BACKUP_AUTHENTICATION_FAILED' });
    assert.equal(await f.failures(), 1);
    assert.equal(f.unlocked, true);
    await assert.rejects(view.commitImport(id, PASSWORD), { code: 'BACKUP_STALE' });
    assert.equal(f.unlockCalls, unlocks + 1);
    assert.equal(f.noteWrites, 0);

    id = view.begin();
    await view.prepareImport(id, file, BACKUP_PASSWORD);
    const receipt = await view.commitImport(id, PASSWORD);
    assert.deepEqual(receipt, { id, confirmed: true, added: 1, duplicates: 0, guarded: 1 });
    assert.deepEqual(await view.readCommitReceipt(id), receipt);
    assert.equal(await f.failures(), 0);
    assert.equal(f.noteWrites, 1);
    assert.ok(!(await f.storage.notes.read())[0]!.value.includes(NOTE.note));

    id = view.begin();
    const backup = await view.exportEncrypted(id, PASSWORD, BACKUP_PASSWORD);
    assert.equal(backup.noteCount, 1);
    assert.equal((await codec().decrypt(backup.bytes, BACKUP_PASSWORD)).notes[0]!.note, NOTE.note);
    assert.deepEqual(await view.verifyExport(id, new Uint8Array(backup.bytes), BACKUP_PASSWORD), {
      id, verified: true, noteCount: 1, createdAt: backup.createdAt,
    });
    backup.bytes.fill(0);

    id = view.begin();
    await view.prepareImport(id, file, BACKUP_PASSWORD);
    const catalogue = f.runtime.catalogue.getSnapshot()!;
    const selection = f.runtime.accounts!.reserve({ kind: 'select', id: catalogue.active.accountId }, catalogue.revision);
    selection.cancel();
    await assert.rejects(view.commitImport(id, PASSWORD), { code: 'BACKUP_CANCELLED' });
    assert.equal(f.unlockCalls, unlocks + 3);
    assert.equal(f.noteWrites, 1);
  } finally { await f.dispose(); }
});

test('saved inventory projects only local metadata from a restored encrypted SQLite vault', async () => {
  const f = await fixture();
  try {
    assert.deepEqual((await f.runtime.readNoteInventory!(current)).notes, []);
    const withdrawalNote: INoteBackupEntry = {
      note: `tornado-eth-0.1-1-0x${'02'.repeat(62)}`,
      createdAt: 15,
      history: { withdrawals: [{ mode: 'relayed', outcome: 'submitted', jobId: 'public-inventory-fixture-job' }] },
    };
    const file = await encrypted([NOTE, withdrawalNote]);
    const backup = await f.runtime.openNoteBackup!(current);
    const id = backup.begin();
    await backup.prepareImport(id, file, BACKUP_PASSWORD);
    const receipt = await backup.commitImport(id, PASSWORD);
    assert.equal(receipt.added, 2);
    await f.reopen();

    const stored = await f.storage.notes.read();
    const unlocks = f.unlockCalls;
    const commits = f.noteCommits;
    const { notes } = await f.runtime.readNoteInventory!(current);
    assert.deepEqual(notes, [
      { amount: '0.1', createdAt: 15, reconciliation: 'withdrawal-history' },
      { amount: '1', createdAt: 10, reconciliation: 'restored-note' },
    ]);
    assert.ok(Object.isFrozen(notes) && notes.every(Object.isFrozen));
    assert.equal(f.unlockCalls, unlocks);
    assert.equal(f.noteCommits, commits);
    assert.deepEqual(await f.storage.notes.read(), stored);
  } finally { await f.dispose(); }
});

test('saved inventory discards held reads after a route owner changes or the wallet locks', async () => {
  const f = await fixture();
  let release: (() => void) | undefined;
  try {
    let route = 1;
    const read = f.holdNoteRead();
    release = read.release;
    const beforeLeaving = assert.rejects(f.runtime.readNoteInventory!(() => {
      if (route !== 1) throw new Error('CANCELLED');
    }));
    await read.entered;
    route = 2; // The same screen opens again with a new owner.
    release();
    release = undefined;
    await beforeLeaving;
    assert.deepEqual((await f.runtime.readNoteInventory!(current)).notes, []);

    const locking = f.holdNoteRead();
    release = locking.release;
    const beforeLocking = assert.rejects(f.runtime.readNoteInventory!(current));
    await locking.entered;
    await f.runtime.session.lock();
    release();
    release = undefined;
    await beforeLocking;
    await assert.rejects(f.runtime.readNoteInventory!(current));
    assert.deepEqual(await f.runtime.session.unlock(PASSWORD), { authenticated: true });
    assert.deepEqual((await f.runtime.readNoteInventory!(current)).notes, []);
    assert.equal(f.noteWrites, 0);
  } finally { release?.(); await f.dispose(); }
});

test('individual reveal requires fresh credentials and resolves only the exact saved row', async () => {
  const f = await fixture();
  try {
    const twin = { ...NOTE, note: `tornado-eth-1-1-0x${'02'.repeat(62)}` };
    const file = await encrypted([NOTE, twin]);
    const backup = await f.runtime.openNoteBackup!(current);
    const id = backup.begin();
    await backup.prepareImport(id, file, BACKUP_PASSWORD);
    await backup.commitImport(id, PASSWORD);
    await f.reopen();

    const stored = await f.storage.notes.read();
    const inventory = await f.runtime.readNoteInventory!(current);
    const [first, second] = inventory.notes;
    assert.ok(first && second && first !== second);
    assert.deepEqual(first, { amount: '1', createdAt: 10, reconciliation: 'restored-note' });
    assert.deepEqual(first, second);
    const other = await f.runtime.readNoteInventory!(current);
    const unlocks = f.unlockCalls;
    await assert.rejects(inventory.revealNote({ ...first }, PASSWORD, current), /privacy_note_missing/);
    await assert.rejects(inventory.revealNote(other.notes[0]!, PASSWORD, current), /privacy_note_missing/);
    await assert.rejects(inventory.revealNote(first, PASSWORD, async () => undefined));
    assert.equal(f.unlockCalls, unlocks);
    assert.equal(await inventory.revealNote(first, PASSWORD, current), NOTE.note);
    assert.equal(await inventory.revealNote(second, PASSWORD, current), twin.note);
    assert.equal(f.unlockCalls, unlocks + 2);
    await assert.rejects(inventory.revealNote(second, WRONG_PASSWORD, current));
    assert.equal(f.unlockCalls, unlocks + 3);
    assert.equal(await f.failures(), 1);
    assert.equal(f.noteWrites, 1);
    assert.deepEqual(await f.storage.notes.read(), stored);
  } finally { await f.dispose(); }
});

test('individual reveal drops held authentication and vault reads after attempt, route or wallet revocation', async () => {
  const f = await fixture();
  let release: (() => void) | undefined;
  try {
    const file = await encrypted();
    const backup = await f.runtime.openNoteBackup!(current);
    const id = backup.begin();
    await backup.prepareImport(id, file, BACKUP_PASSWORD);
    await backup.commitImport(id, PASSWORD);

    let route = 1, attempt = 1;
    const inventory = await f.runtime.readNoteInventory!(() => {
      if (route !== 1) throw new Error('CANCELLED');
    });
    const note = inventory.notes[0]!;
    const first = f.holdUnlock('after');
    release = first.release;
    const staleAttempt = assert.rejects(inventory.revealNote(note, PASSWORD, () => {
      if (attempt !== 1) throw new Error('CANCELLED');
    }));
    await first.entered;
    const unlocks = f.unlockCalls;
    await assert.rejects(inventory.revealNote(note, PASSWORD, current), { code: 'BUSY' });
    assert.equal(f.unlockCalls, unlocks);
    attempt++;
    release();
    release = undefined;
    await staleAttempt;

    const second = f.holdNoteRead();
    release = second.release;
    const staleRoute = assert.rejects(inventory.revealNote(note, PASSWORD, current));
    await second.entered;
    route++;
    release();
    release = undefined;
    await staleRoute;
    await assert.rejects(inventory.revealNote(note, PASSWORD, current));

    const replacement = await f.runtime.readNoteInventory!(current);
    const locking = f.holdUnlock('before');
    release = locking.release;
    const staleWallet = assert.rejects(replacement.revealNote(replacement.notes[0]!, PASSWORD, current));
    await locking.entered;
    await f.runtime.session.lock();
    release();
    release = undefined;
    await staleWallet;
    assert.equal(f.unlocked, false);
    assert.deepEqual(await f.runtime.session.unlock(PASSWORD), { authenticated: true });
    await assert.rejects(replacement.revealNote(replacement.notes[0]!, PASSWORD, current));
    const reopened = await f.runtime.readNoteInventory!(current);
    assert.equal(await reopened.revealNote(reopened.notes[0]!, PASSWORD, current), NOTE.note);
    assert.equal(f.noteWrites, 1);
  } finally { release?.(); await f.dispose(); }
});

test('revocation accounts a definitive wallet credential failure and retires a late SDK re-unlock', async () => {
  const f = await fixture();
  try {
    const file = await encrypted();
    let view = await f.runtime.openNoteBackup!(current);
    let id = view.begin();
    await view.prepareImport(id, file, BACKUP_PASSWORD);
    const wrong = f.holdUnlock('after');
    const wrongCommit = view.commitImport(id, WRONG_PASSWORD);
    try {
      await wrong.entered;
      assert.throws(() => view.begin(), { code: 'BUSY' });
      view.cancel(id);
      await f.runtime.session.lock();
    } finally { wrong.release(); }
    await assert.rejects(wrongCommit, { code: 'BACKUP_CANCELLED' });
    assert.equal(await f.failures(), 1);
    assert.equal(f.unlocked, false);
    assert.equal(f.noteWrites, 0);
    await assert.rejects(view.commitImport(id, PASSWORD), { code: 'BACKUP_CANCELLED' });

    assert.deepEqual(await f.runtime.session.unlock(PASSWORD), { authenticated: true });
    view = await f.runtime.openNoteBackup!(current);
    id = view.begin();
    await view.prepareImport(id, file, BACKUP_PASSWORD);
    const late = f.holdUnlock('before');
    const lateCommit = view.commitImport(id, PASSWORD);
    try {
      await late.entered;
      await f.runtime.session.lock();
      assert.equal(f.unlocked, false);
    } finally { late.release(); }
    await assert.rejects(lateCommit, { code: 'BACKUP_CANCELLED' });
    assert.equal(f.unlocked, false);
    assert.equal(await f.failures(), 0);
    assert.equal(f.noteWrites, 0);
  } finally { await f.dispose(); }
});

test('lost note commit acknowledgement quarantines and cold reopen sees the durable note without a second write', async () => {
  const f = await fixture();
  try {
    const file = await encrypted();
    const view = await f.runtime.openNoteBackup!(current);
    const id = view.begin();
    await view.prepareImport(id, file, BACKUP_PASSWORD);
    f.loseAck();
    await assert.rejects(view.commitImport(id, PASSWORD), { code: 'BACKUP_COMMIT_UNCONFIRMED' });
    assert.equal(f.unlocked, false);
    assert.equal(f.noteWrites, 1);
    await assert.rejects(f.storage.notes.read(), { code: 'STORAGE_REOPEN_REQUIRED' });
    await assert.rejects(f.runtime.openNoteBackup!(current), { code: 'CLEANUP_FAILED' });
    await f.reopen();
    await assert.rejects(view.readCommitReceipt(id), { code: 'BACKUP_CANCELLED' });
    const reopened = await f.runtime.openNoteBackup!(current);
    await assert.rejects(reopened.commitImport(id, PASSWORD), { code: 'BACKUP_STALE' });
    const preview = await reopened.prepareImport(reopened.begin(), file, BACKUP_PASSWORD);
    assert.equal(preview.added, 0);
    assert.equal(preview.duplicates, 1);
    reopened.cancel(preview.id);
    assert.equal(f.noteWrites, 1);
  } finally { await f.dispose(); }
});

test('the wallet throttle rejects before SDK work and route loss revokes pending file decryption', async () => {
  const f = await fixture();
  try {
    const file = await encrypted();
    let alive = true;
    const view = await f.runtime.openNoteBackup!(() => {
      if (!alive) throw new Error('Fixture route departed');
    });
    const held = view.prepareImport(view.begin(), file, BACKUP_PASSWORD);
    alive = false;
    await assert.rejects(held, { code: 'BACKUP_CANCELLED' });
    assert.equal(f.unlocked, true);
    assert.equal(f.noteWrites, 0);
    const next = await f.runtime.openNoteBackup!(current);
    const id = next.begin();
    await next.prepareImport(id, file, BACKUP_PASSWORD);
    for (let attempt = 0; attempt < 5; attempt++) await f.storage.authGuard.recordFailure();
    const unlocks = f.unlockCalls;
    await assert.rejects(next.commitImport(id, PASSWORD), { code: 'BACKUP_AUTHENTICATION_FAILED' });
    await assert.rejects(next.commitImport(id, PASSWORD), { code: 'BACKUP_STALE' });
    assert.equal(await f.failures(), 5);
    assert.equal(f.unlockCalls, unlocks);
    assert.equal(f.unlocked, true);
    assert.equal(f.noteWrites, 0);
  } finally { await f.dispose(); }
});

test('closing the runtime revokes and drains active file work before releasing storage', async () => {
  const f = await fixture();
  try {
    const view = await f.runtime.openNoteBackup!(current);
    const pending = view.prepareImport(view.begin(), await encrypted(), BACKUP_PASSWORD);
    const closing = f.runtime.storage.close();
    assert.equal(f.unlocked, false);
    await assert.rejects(pending, { code: 'BACKUP_CANCELLED' });
    await closing;
    await assert.rejects(f.storage.notes.read(), { code: 'STORAGE_CLOSED' });
    assert.equal(f.noteWrites, 0);
  } finally { await f.dispose(); }
});


test('monotonic preview expiry refuses a queued credential attempt', async () => {
  const f = await fixture();
  const clock = globalThis.performance;
  const own = Object.getOwnPropertyDescriptor(clock, 'now');
  let tick = clock.now();
  Object.defineProperty(clock, 'now', { configurable: true, value: () => tick });
  try {
    const view = await f.runtime.openNoteBackup!(current);
    const id = view.begin();
    const preview = await view.prepareImport(id, await encrypted(), BACKUP_PASSWORD);
    assert.equal(preview.expiresAt, tick + NOTE_BACKUP_PREVIEW_TTL_MS);
    const unlocks = f.unlockCalls;
    tick = preview.expiresAt;
    await assert.rejects(view.commitImport(id, PASSWORD), { code: 'BACKUP_CANCELLED' });
    await assert.rejects(view.commitImport(id, PASSWORD), { code: 'BACKUP_STALE' });
    assert.equal(f.unlockCalls, unlocks);
    assert.equal(f.noteWrites, 0);
    assert.equal(f.unlocked, true);
  } finally {
    if (own) Object.defineProperty(clock, 'now', own);
    else Reflect.deleteProperty(clock, 'now');
    await f.dispose();
  }
});


for (const valid of [true, false]) {
  test(`a lost authentication acknowledgement retires custody before any note write (${valid ? 'correct' : 'wrong'} password)`, async () => {
    const f = await fixture();
    try {
      await f.storage.authGuard.recordFailure();
      const file = await encrypted();
      const view = await f.runtime.openNoteBackup!(current);
      const id = view.begin();
      await view.prepareImport(id, file, BACKUP_PASSWORD);
      const unlocks = f.unlockCalls;
      f.loseAuthAck();
      await assert.rejects(view.commitImport(id, valid ? PASSWORD : WRONG_PASSWORD), { code: 'BACKUP_COMMIT_UNCONFIRMED' });
      assert.equal(f.lostAuthAcks, 1);
      assert.equal(f.unlockCalls, unlocks + 1);
      assert.equal(f.unlocked, false, 'the SDK owner must already be retired');
      assert.equal(f.noteWrites, 0);
      await assert.rejects(f.storage.notes.read(), { code: 'STORAGE_REOPEN_REQUIRED' });
      await assert.rejects(f.runtime.openNoteBackup!(current), { code: 'CLEANUP_FAILED' });
      await f.reopen(false);
      assert.equal(await f.failures(), valid ? 0 : 2);
      assert.deepEqual(await f.storage.notes.read(), []);
      assert.deepEqual(await f.runtime.session.unlock(PASSWORD), { authenticated: true });
      const reopened = await f.runtime.openNoteBackup!(current);
      await assert.rejects(reopened.commitImport(id, PASSWORD), { code: 'BACKUP_STALE' });
      const fresh = await reopened.prepareImport(reopened.begin(), file, BACKUP_PASSWORD);
      assert.equal(fresh.added, 1);
      assert.equal(fresh.duplicates, 0);
      reopened.cancel(fresh.id);
      assert.equal(f.noteWrites, 0);
    } finally { await f.dispose(); }
  });
}

test('native note capacity is numeric, preserves the shared default, and survives cold reopen', async () => {
  const f = await fixture();
  try {
    const capacity = await f.runtime.openNoteCapacity!(current);
    const unlocks = f.unlockCalls;
    const initial = await capacity.getCapacity();
    assert.deepEqual(initial, {
      capacity: 128,
      noteCount: 0,
      storedBytes: 0,
      bundleLimitBytes: 4 * 1024 * 1024,
    });
    assert(Object.isFrozen(capacity) && Object.isFrozen(initial));
    assert.deepEqual(Object.keys(capacity).sort(), ['getCapacity', 'setCapacity']);
    assert.deepEqual(await capacity.setCapacity(128), initial);
    assert.equal(f.noteWrites, 0);
    assert.deepEqual(await f.storage.notes.read(), []);
    await assert.rejects(capacity.setCapacity(1024 as 128), /privacy_vault_unavailable/);
    assert.equal(f.noteWrites, 0);

    const changed = await capacity.setCapacity(512);
    const [row] = await f.storage.notes.read();
    assert.deepEqual(changed, {
      capacity: 512,
      noteCount: 0,
      storedBytes: new TextEncoder().encode(row!.value).byteLength,
      bundleLimitBytes: 16 * 1024 * 1024,
    });
    assert.equal(f.unlockCalls, unlocks);
    assert.equal(f.noteCommits, 1);

    await f.reopen();
    await assert.rejects(capacity.getCapacity(), /CANCELLED/);
    const reopened = await f.runtime.openNoteCapacity!(current);
    assert.deepEqual(await reopened.getCapacity(), changed);
    assert.equal((await reopened.setCapacity(256)).bundleLimitBytes, 8 * 1024 * 1024);
    assert.equal(f.noteCommits, 2);
  } finally { await f.dispose(); }
});

test('native note capacity cannot lower the limit below 129 encrypted notes', async () => {
  const f = await fixture();
  try {
    const capacity = await f.runtime.openNoteCapacity!(current);
    await capacity.setCapacity(512);
    const view = await f.runtime.openNoteBackup!(current);
    const id = view.begin();
    const notes = Array.from({ length: 129 }, (_, index) => ({
      note: `tornado-eth-1-1-0x${(index + 1).toString(16).padStart(124, '0')}`,
      createdAt: index + 1,
    }));
    const file = await encrypted(notes);
    try {
      assert.equal((await view.prepareImport(id, file, BACKUP_PASSWORD)).added, 129);
      assert.equal((await view.commitImport(id, PASSWORD)).confirmed, true);
    } finally { file.fill(0); }

    const unlocks = f.unlockCalls;
    const fits = await capacity.setCapacity(256);
    assert.equal(fits.capacity, 256);
    assert.equal(fits.noteCount, 129);
    const before = await f.storage.notes.read();
    const commits = f.noteCommits;
    await assert.rejects(capacity.setCapacity(128), /privacy_note_limit/);
    assert.deepEqual(await capacity.getCapacity(), fits);
    assert.deepEqual(await f.storage.notes.read(), before);
    assert.equal(f.noteCommits, commits);
    assert.equal(f.unlockCalls, unlocks);
  } finally { await f.dispose(); }
});

test('native note capacity discards a held read on lock and rolls back a held save after leaving', async () => {
  const f = await fixture();
  let release: (() => void) | undefined;
  try {
    const first = await f.runtime.openNoteCapacity!(current);
    const read = f.holdNoteRead();
    release = read.release;
    const staleRead = assert.rejects(first.getCapacity());
    await read.entered;
    await f.runtime.session.lock();
    read.release();
    release = undefined;
    await staleRead;

    await assert.rejects(f.runtime.openNoteCapacity!(current));
    assert.deepEqual(await f.runtime.session.unlock(PASSWORD), { authenticated: true });
    await assert.rejects(first.getCapacity(), /CANCELLED/);
    let routeCurrent = true;
    const route = await f.runtime.openNoteCapacity!(() => {
      if (!routeCurrent) throw new Error('CANCELLED');
    });
    const insert = f.holdNoteInsert();
    release = insert.release;
    const staleSave = assert.rejects(route.setCapacity(256));
    await insert.entered;
    routeCurrent = false;
    insert.release();
    release = undefined;
    await staleSave;

    assert.equal(f.noteWrites, 1); // INSERT ran inside the rolled-back transaction.
    assert.equal(f.noteCommits, 0);
    assert.deepEqual(await f.storage.notes.read(), []);
    const reopened = await f.runtime.openNoteCapacity!(current);
    assert.equal((await reopened.getCapacity()).capacity, 128);
    assert.equal(f.unlocked, true);
  } finally { release?.(); await f.dispose(); }
});

test('native note capacity quarantines a lost save acknowledgement and only reopen reads its result', async () => {
  const f = await fixture();
  try {
    const capacity = await f.runtime.openNoteCapacity!(current);
    f.loseAck();
    await assert.rejects(capacity.setCapacity(256));
    assert.equal(f.unlocked, false);
    assert.equal(f.noteCommits, 1);
    await assert.rejects(f.storage.notes.read(), { code: 'STORAGE_REOPEN_REQUIRED' });
    await assert.rejects(f.runtime.openNoteCapacity!(current), { code: 'CLEANUP_FAILED' });
    await f.reopen();
    await assert.rejects(capacity.setCapacity(512), /CANCELLED/);
    const reopened = await f.runtime.openNoteCapacity!(current);
    const data = await reopened.getCapacity();
    assert.equal(data.capacity, 256);
    assert.equal(data.noteCount, 0);
    assert.equal(f.noteWrites, 1);
  } finally { await f.dispose(); }
});
