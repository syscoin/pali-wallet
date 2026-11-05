import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as sdk from '@sidhujag/sysweb3-keyring/cjs/software.js';
import { createNoteBackupCodec } from '../../../source/wallet/noteBackup.ts';
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
const encrypted = () => codec().encrypt({ format: 'pali-private-notes', version: 1, createdAt: 20, notes: [NOTE] }, BACKUP_PASSWORD);
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
      const { connection } = nodeConnection(file, { after(kind, sql) {
        if (kind === 'run' && sql.startsWith('INSERT INTO private_note_records')) {
          noteWrite = true;
          noteWrites++;
        }
        if (kind === 'exec' && noteWrite && sql === 'COMMIT') {
          noteWrite = false;
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
