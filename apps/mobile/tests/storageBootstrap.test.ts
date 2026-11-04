import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { openWalletStorage } from '../src/storage/coordinator.ts';
import type { NativeStoragePorts } from '../src/storage/coordinator.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { createStorageQualificationDiagnostic } from '../qualification/storage-diagnostics.ts';
import { createNativePolicyObserver, observeNativeStoragePolicy } from '../src/storage/nativePolicyDiagnostic.ts';
import {
  digest,
  INSTALLATION,
  nodeConnection,
  validPair,
} from './storageHelpers.ts';

async function setup() {
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
      return nodeConnection(file).connection;
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
    await reopened.authGuard.checkAllowed();
    await reopened.authGuard.recordFailure();
    now += 59999;
    await assert.rejects(reopened.authGuard.checkAllowed(), /AUTH_THROTTLED/);
    now += 1;
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
        await assert.rejects(
          storage.authGuard.checkAllowed(),
          /AUTH_THROTTLED/
        );
        now += 1;
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
