import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createNoteBackupCodec } from '../../../source/wallet/noteBackup.ts';
import { createKeyringRuntimeFactory, type KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import { openWalletStorage } from '../src/storage/coordinator.ts';
import type { NativeStoragePorts } from '../src/storage/coordinator.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { WalletStorageError } from '../src/storage/types.ts';
import { createStorageQualificationDiagnostic } from '../qualification/storage-diagnostics.ts';
import { createNativePolicyObserver, observeNativeStoragePolicy } from '../src/storage/nativePolicyDiagnostic.ts';
import {
  digest,
  INSTALLATION,
  nodeConnection,
  validPair,
} from './storageHelpers.ts';

async function setup(hooks?: Parameters<typeof nodeConnection>[1]) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-bootstrap-test-'));
  const file = path.join(directory, 'wallet.sqlite');
  let record: string | null = null;
  let held = false;
  let opened = 0;
  const exists = async () => {
    try {
      await stat(file);
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw e;
    }
  };
  const ports: NativeStoragePorts = {
    digest,
    randomBytes,
    policy: {
      async acquire() {
        assert.equal(held, false);
        held = true;
        return {
          token: 'test-lease',
          directory,
          databaseExists: await exists(),
        };
      },
      async inspect() {
        assert.equal(held, true);
        return { databaseExists: await exists() };
      },
      async createDatabase() {
        await writeFile(file, '', { flag: 'wx' });
      },
      async protect() {
        assert.equal(held, true);
      },
      async release() {
        assert.equal(held, true);
        held = false;
      },
    },
    keyStore: {
      async get() {
        return record;
      },
      async set(value) {
        record = value;
      },
    },
    async openDatabase() {
      opened++;
      return nodeConnection(file, hooks).connection;
    },
  };
  return {
    ports,
    file,
    get record() {
      return record;
    },
    set record(value) {
      record = value;
    },
    get opened() {
      return opened;
    },
    get held() {
      return held;
    },
    async cleanup() {
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('new storage provisions once, verifies device key metadata, and reopens without replacing it', async () => {
  const f = await setup();
  try {
    const first = await openWalletStorage(f.ports);
    assert.deepEqual(await first.readState(), {
      presence: 'empty',
      backup: 'unconfirmed',
    });
    const record = f.record;
    assert.equal(JSON.parse(record!).status, 'ready');
    await first.keyringStorage.createManyIfAbsent(validPair());
    await first.close();
    const second = await openWalletStorage(f.ports);
    assert.deepEqual(await second.readState(), {
      presence: 'existing',
      backup: 'unconfirmed',
    });
    assert.equal(f.record, record);
    await second.close();
    assert.equal(f.held, false);
  } finally {
    await f.cleanup();
  }
});

test('second storage entropy failure clears the unused key without publishing custody state', async () => {
  const f = await setup();
  const key = new Uint8Array(32).fill(0x5a);
  const draws: number[] = [];
  let keyWrites = 0, databaseCreates = 0;
  f.ports.randomBytes = (length) => {
    draws.push(length);
    if (draws.length === 1) return key;
    throw new Error('SECRET entropy failure');
  };
  f.ports.keyStore.set = async () => { keyWrites++; };
  f.ports.policy.createDatabase = async () => { databaseCreates++; };
  try {
    await assert.rejects(openWalletStorage(f.ports), { code: 'STORAGE_UNAVAILABLE' });
    assert.deepEqual(draws, [32, 16]);
    assert.deepEqual(key, new Uint8Array(32));
    assert.equal(keyWrites, 0);
    assert.equal(databaseCreates, 0);
    assert.equal(f.opened, 0);
    assert.equal(f.record, null);
    assert.equal(f.held, false);
    await assert.rejects(stat(f.file), { code: 'ENOENT' });
  } finally { await f.cleanup(); }
});

test('the leased device-unlock pair port reads only the exact stored pair and survives cold reopen', async () => {
  const operations: string[] = [];
  const f = await setup({ before(_kind, sql) { operations.push(sql); } });
  let storage: Awaited<ReturnType<typeof openWalletStorage>> | undefined;
  try {
    storage = await openWalletStorage(f.ports);
    const firstRead = storage.keyringStorage.readDeviceUnlockVaultPair;
    assert.ok(firstRead);
    assert.equal(await firstRead(), null);
    const pair = validPair(37);
    await storage.keyringStorage.createManyIfAbsent(pair);
    const fingerprint = await storage.getWalletFingerprint();
    assert.equal(fingerprint, createHash('sha256').update(JSON.stringify([
      'pali.native.wallet-backup.v1', JSON.stringify(pair.vault), JSON.stringify(pair['vault-keys']),
    ])).digest('hex'));
    await storage.close();
    assert.equal(f.held, false);
    await assert.rejects(firstRead(), { code: 'STORAGE_CLOSED' });

    storage = await openWalletStorage(f.ports);
    const coldRead = storage.keyringStorage.readDeviceUnlockVaultPair;
    assert.ok(coldRead);
    operations.length = 0;
    const result = await coldRead();
    assert.deepEqual(result, { vault: pair.vault, keys: pair['vault-keys'], pairFingerprint: fingerprint });
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result?.keys));
    assert.equal(f.held, true);
    assert.equal(operations.length, 1);
    assert.match(operations[0]!, /^SELECT .*key IN \('vault', 'vault-keys'\)/);
  } finally {
    try { await storage?.close(); } finally { await f.cleanup(); }
  }
});

test('the pair port rejects partial, malformed and over-limit SQL records without repairing them', async () => {
  const f = await setup();
  let storage: Awaited<ReturnType<typeof openWalletStorage>> | undefined;
  try {
    storage = await openWalletStorage(f.ports);
    const read = storage.keyringStorage.readDeviceUnlockVaultPair;
    assert.ok(read);
    const pair = validPair();
    await storage.keyringStorage.createManyIfAbsent(pair);
    const { database } = nodeConnection(f.file);
    try {
      const update = database.prepare('UPDATE keyring_records SET value = ? WHERE key = ?');
      const select = database.prepare('SELECT value FROM keyring_records WHERE key = ?');
      const invalidKeys = JSON.stringify({ ...pair['vault-keys'], legacy: true });
      update.run(invalidKeys, 'vault-keys');
      await assert.rejects(read(), { code: 'STORAGE_CORRUPT' });
      assert.equal(select.get('vault-keys')?.value, invalidKeys);
      database.exec("DELETE FROM keyring_records WHERE key = 'vault-keys'");
      await assert.rejects(read(), { code: 'STORAGE_CORRUPT' });
      assert.equal(select.get('vault-keys'), undefined);
      database.prepare('INSERT INTO keyring_records (key, value) VALUES (?, ?)').run('vault-keys', JSON.stringify(pair['vault-keys']));

      const legacyVault = JSON.stringify(JSON.stringify({ ...JSON.parse(pair.vault), v: 3 }));
      update.run(legacyVault, 'vault');
      await assert.rejects(read(), { code: 'STORAGE_CORRUPT' });
      assert.equal(select.get('vault')?.value, legacyVault);
      database.exec('PRAGMA ignore_check_constraints = ON');
      const oversize = 'x'.repeat(65_537);
      update.run(oversize, 'vault');
      await assert.rejects(read(), { code: 'STORAGE_CORRUPT' });
      assert.equal(select.get('vault')?.value, oversize);
    } finally { database.close(); }
  } finally {
    try { await storage?.close(); } finally { await f.cleanup(); }
  }
});

const ENROLLMENT = 'device-unlock-enrollment';
const ENROLLMENT_ID = 'a1'.repeat(16);
const NEXT_ENROLLMENT_ID = 'b2'.repeat(16);
const currentEnrollment = () => undefined;

test('the leased enrollment reference requires exact one-use ownership and cannot replay after ABA', async () => {
  const f = await setup();
  let storage: Awaited<ReturnType<typeof openWalletStorage>> | undefined;
  try {
    storage = await openWalletStorage(f.ports);
    const enrollment = storage.deviceUnlockEnrollment!;
    assert.equal(await enrollment.read(), null);
    await storage.keyringStorage.createManyIfAbsent(validPair());
    const originalPair = await storage.keyringStorage.readDeviceUnlockVaultPair!();
    const first = (await enrollment.read())!, stale = (await enrollment.read())!;
    assert.ok(Object.isFrozen(first));
    assert.equal(first.pairFingerprint, originalPair?.pairFingerprint);
    assert.equal(first.enrollmentId, null);
    await assert.rejects(enrollment.compareAndSet({ ...first }, ENROLLMENT_ID, currentEnrollment), { code: 'STORAGE_CHANGED' });
    await assert.rejects(enrollment.compareAndSet((await enrollment.read())!, ENROLLMENT_ID + '\n', currentEnrollment), { code: 'STORAGE_CHANGED' });
    const asyncGuard = (await enrollment.read())!;
    await assert.rejects(enrollment.compareAndSet(asyncGuard, ENROLLMENT_ID, async () => undefined), { code: 'STORAGE_CHANGED' });
    assert.equal((await enrollment.read())?.enrollmentId, null);
    assert.equal(await enrollment.compareAndSet(first, ENROLLMENT_ID, currentEnrollment), true);
    await assert.rejects(enrollment.compareAndSet(first, ENROLLMENT_ID, currentEnrollment), { code: 'STORAGE_CHANGED' });
    const active = (await enrollment.read())!;
    assert.deepEqual(active, { ...first, enrollmentId: ENROLLMENT_ID });
    assert.equal(await enrollment.compareAndSet(active, null, currentEnrollment), true);
    assert.equal(await enrollment.compareAndSet(stale, NEXT_ENROLLMENT_ID, currentEnrollment), false);
    assert.deepEqual(await enrollment.read(), first);
    assert.deepEqual(await storage.keyringStorage.readDeviceUnlockVaultPair!(), originalPair);
  } finally {
    try { await storage?.close(); } finally { await f.cleanup(); }
  }
});

test('a changed row or pair rejects a captured enrollment without rewriting the competing bytes', async () => {
  const f = await setup();
  let storage: Awaited<ReturnType<typeof openWalletStorage>> | undefined;
  try {
    storage = await openWalletStorage(f.ports);
    const enrollment = storage.deviceUnlockEnrollment!;
    await storage.keyringStorage.createManyIfAbsent(validPair());
    const first = (await enrollment.read())!;
    const { database } = nodeConnection(f.file);
    try {
      const changed = '["malformed"]';
      database.prepare('INSERT INTO wallet_metadata (key, value) VALUES (?, ?)').run(ENROLLMENT, changed);
      assert.equal(await enrollment.compareAndSet(first, ENROLLMENT_ID, currentEnrollment), false);
      assert.equal(database.prepare('SELECT value FROM wallet_metadata WHERE key = ?').get(ENROLLMENT)?.value, changed);
      const malformed = (await enrollment.read())!;
      assert.equal(malformed.enrollmentId, null);
      assert.equal(await enrollment.compareAndSet(malformed, ENROLLMENT_ID, currentEnrollment), true);
      const active = (await enrollment.read())!;
      assert.equal(active.enrollmentId, ENROLLMENT_ID);
      await storage.keyringStorage.set('vault', validPair(2).vault);
      assert.equal((await enrollment.read())?.enrollmentId, null);
      assert.equal(await enrollment.compareAndSet(active, null, currentEnrollment), false);
    } finally { database.close(); }
  } finally {
    try { await storage?.close(); } finally { await f.cleanup(); }
  }
});

test('enrollment cancellation before COMMIT rolls back, and lost ACK requires a cold read for activation or revocation', async () => {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const paused = new Promise<void>((resolve) => { release = resolve; });
  let hold = false, loseAck = false;
  const f = await setup({
    before(kind, sql) {
      if (hold && kind === 'run' && sql.startsWith('INSERT INTO wallet_metadata')) {
        hold = false;
        enter();
        return paused;
      }
    },
    after(kind, sql) {
      if (loseAck && kind === 'exec' && sql === 'COMMIT') {
        loseAck = false;
        throw new Error('Synthetic lost enrollment acknowledgement');
      }
    },
  });
  let storage: Awaited<ReturnType<typeof openWalletStorage>> | undefined;
  try {
    storage = await openWalletStorage(f.ports);
    await storage.keyringStorage.createManyIfAbsent(validPair());
    const enrollment = storage.deviceUnlockEnrollment!;
    const before = (await enrollment.read())!;
    let active = true;
    hold = true;
    const held = enrollment.compareAndSet(before, ENROLLMENT_ID, () => { if (!active) throw new Error('CANCELLED'); });
    await entered;
    active = false;
    release();
    await assert.rejects(held);
    assert.equal((await enrollment.read())?.enrollmentId, null);
    await assert.rejects(enrollment.compareAndSet(before, ENROLLMENT_ID, currentEnrollment), { code: 'STORAGE_CHANGED' });

    const fresh = (await enrollment.read())!;
    loseAck = true;
    await assert.rejects(enrollment.compareAndSet(fresh, ENROLLMENT_ID, currentEnrollment), { code: 'STORAGE_REOPEN_REQUIRED' });
    await assert.rejects(enrollment.read(), { code: 'STORAGE_REOPEN_REQUIRED' });
    await storage.close();
    await assert.rejects(enrollment.read(), { code: 'STORAGE_CLOSED' });
    storage = await openWalletStorage(f.ports);
    const reopened = storage.deviceUnlockEnrollment!;
    await assert.rejects(reopened.compareAndSet(fresh, NEXT_ENROLLMENT_ID, currentEnrollment), { code: 'STORAGE_CHANGED' });
    const recovered = (await reopened.read())!;
    assert.equal(recovered.enrollmentId, ENROLLMENT_ID);

    loseAck = true;
    await assert.rejects(reopened.compareAndSet(recovered, null, currentEnrollment), { code: 'STORAGE_REOPEN_REQUIRED' });
    await assert.rejects(reopened.read(), { code: 'STORAGE_REOPEN_REQUIRED' });
    await storage.close();
    storage = await openWalletStorage(f.ports);
    assert.equal((await storage.deviceUnlockEnrollment!.read())?.enrollmentId, null);
  } finally {
    release();
    try { await storage?.close(); } finally { await f.cleanup(); }
  }
});

for (const mode of ['activation', 'revocation'] as const) {
  test(`owner retirement after acknowledged enrollment ${mode} requires a cold read`, async () => {
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const paused = new Promise<void>((resolve) => { release = resolve; });
    let hold = false, active = true;
    const f = await setup({
      after(kind, sql) {
        if (hold && kind === 'exec' && sql === 'COMMIT') {
          hold = false;
          enter();
          return paused;
        }
      },
    });
    let storage: Awaited<ReturnType<typeof openWalletStorage>> | undefined;
    try {
      storage = await openWalletStorage(f.ports);
      await storage.keyringStorage.createManyIfAbsent(validPair());
      const enrollment = storage.deviceUnlockEnrollment!;
      if (mode === 'revocation')
        assert.equal(await enrollment.compareAndSet((await enrollment.read())!, ENROLLMENT_ID, currentEnrollment), true);
      const before = (await enrollment.read())!;
      const next = mode === 'activation' ? ENROLLMENT_ID : null;
      hold = true;
      const result = enrollment.compareAndSet(before, next, () => {
        if (!active) throw new WalletStorageError('STORAGE_CHANGED');
      });
      await entered;
      active = false;
      release();
      await assert.rejects(result, { code: 'STORAGE_REOPEN_REQUIRED' });
      await assert.rejects(storage.readState(), { code: 'STORAGE_REOPEN_REQUIRED' });
      await storage.close();
      storage = await openWalletStorage(f.ports, before.installationId);
      assert.equal((await storage.deviceUnlockEnrollment!.read())?.enrollmentId, next);
    } finally {
      release();
      try { await storage?.close(); } finally { await f.cleanup(); }
    }
  });
}

const malformedEnrollmentBytes = {
  'embedded NUL': ['610062', '610063'],
  'invalid UTF-8': ['8061', '8161'],
} as const;

for (const shape of ['canonical', 'malformed', 'embedded NUL', 'invalid UTF-8'] as const) {
  test(`wallet removal checks, preserves on rollback, and deletes the exact ${shape} enrollment row`, async () => {
    let cancelOnDelete = false, cancelled = false;
    const f = await setup({
      after(kind, sql) {
        if (cancelOnDelete && kind === 'run' && sql === "DELETE FROM wallet_metadata WHERE key <> 'installation'") cancelled = true;
      },
    });
    let storage: Awaited<ReturnType<typeof openWalletStorage>> | undefined;
    try {
      storage = await openWalletStorage(f.ports);
      await storage.keyringStorage.createManyIfAbsent(validPair());
      const enrollment = storage.deviceUnlockEnrollment!;
      assert.equal(await enrollment.compareAndSet((await enrollment.read())!, ENROLLMENT_ID, currentEnrollment), true);
      const bytes = shape === 'embedded NUL' || shape === 'invalid UTF-8' ? malformedEnrollmentBytes[shape] : undefined;
      // Bypass the in-process generation to test the durable raw-row comparison.
      const changed = nodeConnection(f.file).database;
      let competingHex: string;
      try {
        const writeBytes = (hex: string) => {
          changed.prepare('UPDATE wallet_metadata SET value = CAST(? AS TEXT) WHERE key = ?')
            .run(Buffer.from(hex, 'hex'), ENROLLMENT);
        };
        if (bytes) {
          writeBytes(bytes[0]);
          assert.equal((await enrollment.read())?.enrollmentId, null);
        }
        const before = await storage.recovery!.readSnapshot();
        if (bytes) writeBytes(bytes[1]);
        else {
          const raw = changed.prepare('SELECT value FROM wallet_metadata WHERE key = ?').get(ENROLLMENT)?.value as string;
          const reference = JSON.parse(raw) as string[];
          reference[4] = NEXT_ENROLLMENT_ID;
          const competing = shape === 'canonical' ? JSON.stringify(reference) : 'x'.repeat(300);
          changed.prepare('UPDATE wallet_metadata SET value = ? WHERE key = ?').run(competing, ENROLLMENT);
        }
        competingHex = changed.prepare('SELECT hex(CAST(value AS BLOB)) AS value FROM wallet_metadata WHERE key = ?')
          .get(ENROLLMENT)?.value as string;
        await assert.rejects(storage.removal!.commit(before, currentEnrollment), { code: 'STORAGE_CHANGED' });
      } finally { changed.close(); }

      const unchanged = await storage.recovery!.readSnapshot();
      const exactRow = { key: ENROLLMENT, value: competingHex };
      assert.deepEqual(unchanged.metadata.find((row) => row.key === ENROLLMENT), exactRow);
      assert.equal((await enrollment.read())?.enrollmentId, shape === 'canonical' ? NEXT_ENROLLMENT_ID : null);
      cancelOnDelete = true;
      await assert.rejects(storage.removal!.commit(unchanged, () => {
        if (cancelled) throw new WalletStorageError('STORAGE_CHANGED');
      }), { code: 'STORAGE_CHANGED' });
      assert.equal(cancelled, true);
      const installation = unchanged.metadata.find((row) => row.key === 'installation')!.value;
      await storage.close();
      storage = await openWalletStorage(f.ports, installation);
      const reopened = await storage.recovery!.readSnapshot();
      assert.deepEqual(reopened, unchanged);

      cancelOnDelete = false;
      assert.deepEqual(await storage.removal!.commit(reopened, currentEnrollment), { status: 'wallet-records-removed' });
      await assert.rejects(storage.deviceUnlockEnrollment!.read(), { code: 'STORAGE_CLOSED' });
      await storage.close();
      storage = await openWalletStorage(f.ports, installation);
      const removed = await storage.recovery!.readSnapshot();
      assert.deepEqual(removed.metadata, [{ key: 'installation', value: installation }]);
      assert.equal(removed.state.presence, 'empty');
      assert.equal(await storage.deviceUnlockEnrollment!.read(), null);
    } finally {
      try { await storage?.close(); } finally { await f.cleanup(); }
    }
  });
}

test('the native storage coordinator exposes note backup to the real keyring across a cold reopen', async () => {
  const f = await setup();
  const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const walletPassword = 'Public fixture wallet password 1!';
  const backupPassword = 'Public fixture backup password 2!';
  const note = { note: `tornado-eth-1-1-0x${'01'.repeat(62)}`, createdAt: 10 };
  const current = () => undefined;
  const codec = createNoteBackupCodec({ crypto: globalThis.crypto, assertCurrent: current });
  const factory = createKeyringRuntimeFactory({ privacyServiceSettings: null, slhExecution: null, readEvmRetirement: null,
    ensureCryptoReady: async () => undefined,
    openStorage: () => openWalletStorage(f.ports),
  });
  let runtime: KeyringRuntime | undefined;
  let file: Uint8Array | undefined;
  let exported: Uint8Array | undefined;
  try {
    runtime = await factory.open() as KeyringRuntime;
    await runtime.session.importWallet(phrase, walletPassword);
    assert.ok(runtime.openNoteBackup, 'The coordinator must pass the note store to its keyring owner');
    const restore = await runtime.openNoteBackup(current);
    file = await codec.encrypt({ format: 'pali-private-notes', version: 1, createdAt: 20, notes: [note] }, backupPassword);
    const id = restore.begin();
    assert.equal((await restore.prepareImport(id, file, backupPassword)).added, 1);
    assert.equal((await restore.commitImport(id, walletPassword)).confirmed, true);
    assert.ok(runtime.openNoteCapacity);
    const capacity = await runtime.openNoteCapacity(current);
    const initial = await capacity.getCapacity();
    assert.equal(initial.capacity, 128);
    assert.equal(initial.noteCount, 1);
    const updated = await capacity.setCapacity(256);
    assert.equal(updated.capacity, 256);
    assert.equal(updated.noteCount, 1);
    assert.equal(updated.bundleLimitBytes, 8 * 1024 * 1024);
    await runtime.storage.close();
    assert.equal(f.held, false);
    runtime = await factory.open() as KeyringRuntime;
    assert.deepEqual(await runtime.session.unlock(walletPassword), { authenticated: true });
    assert.ok(runtime.openNoteCapacity);
    const reopened = await (await runtime.openNoteCapacity(current)).getCapacity();
    assert.deepEqual(reopened, updated);
    assert.ok(runtime.openNoteBackup);
    const backup = await runtime.openNoteBackup(current);
    const result = await backup.exportEncrypted(backup.begin(), walletPassword, backupPassword);
    exported = result.bytes;
    assert.deepEqual((await codec.decrypt(exported, backupPassword)).notes, [{ ...note, reconciliationRequired: true }]);
  } finally {
    file?.fill(0);
    exported?.fill(0);
    try { await runtime?.storage.close(); } finally { await f.cleanup(); }
  }
});

test('storage failure retains its opening checkpoint and closes its lease before reporting', async () => {
  const f = await setup();
  const diagnostic = createStorageQualificationDiagnostic();
  f.ports.observeOpen = diagnostic.observe;
  let reads = 0;
  f.ports.keyStore.get = async () => {
    reads++;
    throw Error('SECRET keychain payload');
  };
  try {
    await assert.rejects(openWalletStorage(f.ports), (error) => {
      diagnostic.capture(error);
      return error instanceof Error && error.message === 'STORAGE_UNAVAILABLE';
    });
    assert.equal(reads, 1);
    assert.equal(f.opened, 0);
    assert.equal(f.held, false);
    assert.deepEqual(diagnostic.report(), {
      stage: 'key-read',
      code: 'STORAGE_UNAVAILABLE',
    });
  } finally {
    await f.cleanup();
  }
});

test('a native policy subcode preserves the external storage error contract', async () => {
  const f = await setup();
  const diagnostic = createStorageQualificationDiagnostic();
  const observe = createNativePolicyObserver(diagnostic.observe);
  f.ports.observeOpen = diagnostic.observe;
  f.ports.policy.acquire = () => observe(async () => {
    throw { code: 'PALI_STORAGE_POLICY_PROTECTION_CHECK', message: 'SECRET native property' };
  });
  try {
    await assert.rejects(openWalletStorage(f.ports), (error) => {
      diagnostic.capture(error);
      return error instanceof Error && error.message === 'STORAGE_UNAVAILABLE';
    });
    assert.deepEqual(diagnostic.report(), {
      stage: 'ios-policy-protection-check',
      code: 'STORAGE_UNAVAILABLE',
    });
    assert.equal(f.record, null);
    assert.equal(f.opened, 0);
    assert.equal(f.held, false);
  } finally {
    await f.cleanup();
  }
});

test('native lease cleanup failure cannot replace a key-read opening failure', async () => {
  const f = await setup();
  const diagnostic = createStorageQualificationDiagnostic();
  const nativePolicy = f.ports.policy;
  let releases = 0;
  nativePolicy.release = async () => {
    releases++;
    throw { code: 'PALI_STORAGE_POLICY_LEASE_RELEASE' };
  };
  f.ports.policy = observeNativeStoragePolicy(nativePolicy, diagnostic.observe);
  f.ports.observeOpen = diagnostic.observe;
  f.ports.keyStore.get = async () => { throw Error('SECRET key-read failure'); };
  try {
    await assert.rejects(openWalletStorage(f.ports), (error) => {
      diagnostic.capture(error);
      return error instanceof Error && error.message === 'STORAGE_UNAVAILABLE';
    });
    assert.equal(releases, 1);
    assert.deepEqual(diagnostic.report(), { stage: 'key-read', code: 'STORAGE_UNAVAILABLE' });
    assert.equal(f.record, null);
    assert.equal(f.opened, 0);
    assert.equal(observeNativeStoragePolicy(nativePolicy), nativePolicy);
  } finally {
    await f.cleanup();
  }
});

test('throwing opening observers preserve successful provisioning and reopening', async () => {
  const f = await setup();
  f.ports.observeOpen = () => { throw Error('observer failed'); };
  try {
    const first = await openWalletStorage(f.ports);
    assert.deepEqual(await first.readState(), {
      presence: 'empty',
      backup: 'unconfirmed',
    });
    const record = f.record;
    await first.close();
    const second = await openWalletStorage(f.ports);
    assert.equal(f.record, record);
    await second.close();
    assert.equal(f.held, false);
  } finally {
    await f.cleanup();
  }
});

test('ready orphan key and missing device key refuse to open or mutate a database', async () => {
  const f = await setup();
  try {
    f.record = JSON.stringify({
      version: 1,
      status: 'ready',
      key: 'ab'.repeat(32),
      installationId: INSTALLATION,
    });
    const before = f.record;
    await assert.rejects(openWalletStorage(f.ports), /STORAGE_ORPHAN_KEY/);
    assert.equal(f.opened, 0);
    assert.equal(f.record, before);
    f.record = null;
    await writeFile(f.file, 'foreign data');
    await assert.rejects(openWalletStorage(f.ports), /STORAGE_KEY_MISSING/);
    assert.equal(f.opened, 0);
    assert.equal(f.record, null);
  } finally {
    await f.cleanup();
  }
});

test('known interrupted provisioning resumes the same key; lost key-write ack does not regenerate', async () => {
  const f = await setup();
  try {
    const set = f.ports.keyStore.set;
    f.ports.keyStore.set = async (value) => {
      await set(value);
      throw Error('lost acknowledgement');
    };
    await assert.rejects(openWalletStorage(f.ports), /STORAGE_UNAVAILABLE/);
    const interrupted = JSON.parse(f.record!);
    assert.equal(interrupted.status, 'provisioning');
    f.ports.keyStore.set = set;
    const recovered = await openWalletStorage(f.ports);
    assert.equal(JSON.parse(f.record!).key, interrupted.key);
    assert.equal(
      JSON.parse(f.record!).installationId,
      interrupted.installationId
    );
    assert.deepEqual(await recovered.readState(), {
      presence: 'empty',
      backup: 'unconfirmed',
    });
    await recovered.close();
  } finally {
    await f.cleanup();
  }
});

test('provisioning metadata cannot silently accept a preexisting complete wallet or a different installation', async () => {
  const f = await setup();
  try {
    const key = JSON.stringify({
      version: 1,
      status: 'provisioning',
      key: 'ab'.repeat(32),
      installationId: INSTALLATION,
    });
    f.record = key;
    const db = nodeConnection(f.file);
    const storage = await SqliteWalletStorage.open(
      db.connection,
      digest,
      INSTALLATION,
      true
    );
    await storage.keyringStorage.createManyIfAbsent(validPair());
    await storage.close();
    await assert.rejects(openWalletStorage(f.ports), /STORAGE_CORRUPT/);
    assert.equal(f.record, key);
    f.record = JSON.stringify({
      ...JSON.parse(key),
      status: 'ready',
      installationId: 'ff'.repeat(16),
    });
    await assert.rejects(openWalletStorage(f.ports), /STORAGE_CORRUPT/);
  } finally {
    await f.cleanup();
  }
});

test('keychain access failure is unavailable and does not replace key or open SQLite', async () => {
  const f = await setup();
  try {
    f.ports.keyStore.get = async () => {
      throw Error('locked keychain');
    };
    await assert.rejects(openWalletStorage(f.ports), /STORAGE_UNAVAILABLE/);
    assert.equal(f.record, null);
    assert.equal(f.opened, 0);
    assert.equal(f.held, false);
  } finally {
    await f.cleanup();
  }
});

test('durable password failure delays persist across restart and clock rollback cannot shorten them', async () => {
  const f = await setup();
  let now = 1000000;
  f.ports.now = () => now;
  let monotonic = 0;
  f.ports.monotonicMilliseconds = () => monotonic;
  try {
    const first = await openWalletStorage(f.ports);
    await first.keyringStorage.createManyIfAbsent(validPair());
    for (let i = 0; i < 5; i++) {
      await first.authGuard.checkAllowed();
      await first.authGuard.recordFailure();
    }
    await assert.rejects(first.authGuard.checkAllowed(), /AUTH_THROTTLED/);
    await assert.rejects(first.authGuard.recordSuccess(), /AUTH_THROTTLED/);
    await first.close();
    const reopened = await openWalletStorage(f.ports);
    now -= 1;
    await assert.rejects(reopened.authGuard.checkAllowed(), /AUTH_THROTTLED/);
    now += 30001;
    monotonic += 30000;
    await reopened.authGuard.checkAllowed();
    await reopened.authGuard.recordFailure();
    now += 59999;
    monotonic += 59999;
    await assert.rejects(reopened.authGuard.checkAllowed(), /AUTH_THROTTLED/);
    now += 1;
    monotonic += 1;
    await reopened.authGuard.recordSuccess();
    await reopened.authGuard.checkAllowed();
    await reopened.close();
  } finally {
    await f.cleanup();
  }
});

test('malformed authentication metadata and orphan backup receipts fail closed', async () => {
  const f = await setup();
  try {
    const storage = await openWalletStorage(f.ports);
    await storage.keyringStorage.createManyIfAbsent(validPair());
    await storage.close();
    const owned = nodeConnection(f.file);
    owned.database
      .prepare('INSERT INTO wallet_metadata (key,value) VALUES (?,?)')
      .run('auth', '{"version":1,"failures":999}');
    await owned.connection.closeAsync();
    await assert.rejects(openWalletStorage(f.ports), /STORAGE_CORRUPT/);
  } finally {
    await f.cleanup();
  }
});

test('password backoff saturates at five minutes and successful authentication resets the counter', async () => {
  const f = await setup();
  let now = 2000000;
  f.ports.now = () => now;
  let monotonic = 0;
  f.ports.monotonicMilliseconds = () => monotonic;
  try {
    const storage = await openWalletStorage(f.ports);
    await storage.keyringStorage.createManyIfAbsent(validPair());
    for (let failures = 1; failures <= 12; failures++) {
      await storage.authGuard.checkAllowed();
      await storage.authGuard.recordFailure();
      const delay =
        failures < 5
          ? 0
          : Math.min(300000, 30000 * 2 ** Math.min(4, failures - 5));
      if (delay) {
        now += delay - 1;
        monotonic += delay - 1;
        await assert.rejects(
          storage.authGuard.checkAllowed(),
          /AUTH_THROTTLED/
        );
        now += 1;
        monotonic += 1;
      }
    }
    await storage.authGuard.recordSuccess();
    for (let i = 0; i < 4; i++) {
      await storage.authGuard.checkAllowed();
      await storage.authGuard.recordFailure();
    }
    await storage.authGuard.checkAllowed();
    await storage.close();
  } finally {
    await f.cleanup();
  }
});

test('stored failure counters require the exact corresponding backoff, not an arbitrary shorter delay', async () => {
  for (const notBefore of [1000, 30999, 31001, 301000]) {
    const f = await setup();
    try {
      const storage = await openWalletStorage(f.ports);
      await storage.keyringStorage.createManyIfAbsent(validPair());
      await storage.close();
      const owned = nodeConnection(f.file);
      owned.database
        .prepare('INSERT INTO wallet_metadata (key,value) VALUES (?,?)')
        .run(
          'auth',
          JSON.stringify({
            version: 1,
            failures: 5,
            lastAttempt: 1000,
            notBefore,
          })
        );
      await owned.connection.closeAsync();
      await assert.rejects(openWalletStorage(f.ports), /STORAGE_CORRUPT/);
    } finally {
      await f.cleanup();
    }
  }
});

test('forward wall-clock changes cannot shorten the active password cooldown', async () => {
  const f = await setup();
  let wall = 1000000;
  let monotonic = 0.25;
  f.ports.now = () => wall;
  f.ports.monotonicMilliseconds = () => monotonic;
  try {
    const storage = await openWalletStorage(f.ports);
    await storage.keyringStorage.createManyIfAbsent(validPair());
    for (let failures = 0; failures < 5; failures++) {
      await storage.authGuard.checkAllowed();
      await storage.authGuard.recordFailure();
    }
    await assert.rejects(storage.authGuard.checkAllowed(), /AUTH_THROTTLED/);
    wall += 86400000;
    await assert.rejects(storage.authGuard.checkAllowed(), /AUTH_THROTTLED/);
    await assert.rejects(storage.authGuard.recordFailure(), /AUTH_THROTTLED/);
    await assert.rejects(storage.authGuard.recordSuccess(), /AUTH_THROTTLED/);
    monotonic += 29999;
    await storage.readState();
    await assert.rejects(storage.authGuard.checkAllowed(), /AUTH_THROTTLED/);
    monotonic += 1;
    await storage.authGuard.checkAllowed();
    await storage.authGuard.recordSuccess();
    await storage.close();
  } finally { await f.cleanup(); }
});


test('reopen re-arms the stored delay even after a forward clock change or a long closure', async () => {
  const f = await setup();
  let wall = 1000000, monotonic = 10.5;
  f.ports.now = () => wall;
  f.ports.monotonicMilliseconds = () => monotonic;
  try {
    let storage = await openWalletStorage(f.ports);
    await storage.keyringStorage.createManyIfAbsent(validPair());
    for (let i = 0; i < 5; i++) await storage.authGuard.recordFailure();
    await storage.close();
    wall += 86400000; monotonic = 0.75;
    storage = await openWalletStorage(f.ports);
    await assert.rejects(storage.authGuard.checkAllowed(), /AUTH_THROTTLED/);
    monotonic += 29999;
    await assert.rejects(storage.authGuard.checkAllowed(), /AUTH_THROTTLED/);
    monotonic += 1;
    await storage.authGuard.recordFailure();
    await storage.close();
    wall += 86400000; monotonic = 0;
    storage = await openWalletStorage(f.ports);
    monotonic = 59999;
    await assert.rejects(storage.authGuard.checkAllowed(), /AUTH_THROTTLED/);
    monotonic = 60000;
    await storage.authGuard.checkAllowed();
    await storage.authGuard.recordSuccess();
    await storage.close();
    monotonic = 0;
    storage = await openWalletStorage(f.ports);
    await storage.authGuard.checkAllowed();
    await storage.close();
  } finally { await f.cleanup(); }
});

test('wall rollback does not discard a definitive rejection and monotonic clock faults latch closed', async () => {
  for (const invalid of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER, 9.5]) {
    const f = await setup();
    let wall = 1000000, monotonic = 10.5;
    f.ports.now = () => wall;
    f.ports.monotonicMilliseconds = () => monotonic;
    try {
      const storage = await openWalletStorage(f.ports);
      await storage.keyringStorage.createManyIfAbsent(validPair());
      for (let i = 0; i < 4; i++) await storage.authGuard.recordFailure();
      wall -= 100000;
      await storage.authGuard.recordFailure();
      await assert.rejects(storage.authGuard.checkAllowed(), /AUTH_THROTTLED/);
      monotonic = invalid;
      await assert.rejects(storage.authGuard.checkAllowed(), /STORAGE_REOPEN_REQUIRED/);
      monotonic = 900000;
      await assert.rejects(storage.authGuard.checkAllowed(), /STORAGE_REOPEN_REQUIRED/);
      await storage.close();
    } finally { await f.cleanup(); }
  }
});


for (const boundary of ['lost acknowledgement', 'invalid post-commit clock'] as const) {
  test(`password failure remains durable and closed after ${boundary}`, async () => {
    const f = await setup();
    let monotonic = 5.5, inject = false;
    f.ports.now = () => 1000000;
    f.ports.monotonicMilliseconds = () => monotonic;
    const open = f.ports.openDatabase;
    f.ports.openDatabase = async (...args) => {
      const connection = await open(...args);
      const exec = connection.execAsync.bind(connection);
      connection.execAsync = async (sql) => {
        await exec(sql);
        if (inject && sql === 'COMMIT') {
          inject = false;
          if (boundary === 'lost acknowledgement') throw Error('commit acknowledgement lost');
          monotonic = NaN;
        }
      };
      return connection;
    };
    try {
      let storage = await openWalletStorage(f.ports);
      await storage.keyringStorage.createManyIfAbsent(validPair());
      for (let i = 0; i < 4; i++) await storage.authGuard.recordFailure();
      inject = true;
      await assert.rejects(storage.authGuard.recordFailure());
      monotonic = 900000;
      await assert.rejects(storage.authGuard.checkAllowed(), /STORAGE_REOPEN_REQUIRED/);
      await storage.close();
      monotonic = 0.5;
      storage = await openWalletStorage(f.ports);
      await assert.rejects(storage.authGuard.checkAllowed(), /AUTH_THROTTLED/);
      monotonic += 29999;
      await assert.rejects(storage.authGuard.checkAllowed(), /AUTH_THROTTLED/);
      monotonic += 1;
      await storage.authGuard.recordSuccess();
      await storage.close();
    } finally { await f.cleanup(); }
  });
}

test('every rejected password re-arms the cooldown after the persistent counter saturates', async () => {
  const f = await setup();
  let monotonic = 0.25;
  // A repeated wall reading must not make a committed rejection disappear.
  f.ports.now = () => 1000000;
  f.ports.monotonicMilliseconds = () => monotonic;
  try {
    const storage = await openWalletStorage(f.ports);
    await storage.keyringStorage.createManyIfAbsent(validPair());
    for (let failures = 1; failures <= 64; failures++) {
      await storage.authGuard.checkAllowed();
      await storage.authGuard.recordFailure();
      monotonic += failures < 5 ? 0 : Math.min(300000, 30000 * 2 ** Math.min(4, failures - 5));
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      await storage.authGuard.checkAllowed();
      await storage.authGuard.recordFailure();
      await assert.rejects(storage.authGuard.checkAllowed(), /AUTH_THROTTLED/);
      monotonic += 300000;
    }
    await storage.authGuard.recordSuccess();
    await storage.close();
  } finally { await f.cleanup(); }
});
