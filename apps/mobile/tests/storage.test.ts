import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { URL } from 'node:url';

import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { encodeStorageValue } from '../src/storage/json.ts';
import {
  digest,
  INSTALLATION,
  nodeConnection,
  validPair,
} from './storageHelpers.ts';
import type { SqlHook } from './storageHelpers.ts';

async function fixture(hooks: { before?: SqlHook; after?: SqlHook } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-storage-test-'));
  const file = path.join(directory, 'wallet.sqlite');
  const owned = nodeConnection(file, hooks);
  const storage = await SqliteWalletStorage.open(
    owned.connection,
    digest,
    INSTALLATION,
    true
  );
  return {
    ...owned,
    storage,
    directory,
    file,
    async cleanup() {
      await storage.close().catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('real SQLite preserves SDK value types, atomic collisions, and wallet-bound backup receipt', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await f.storage.readState(), {
      presence: 'empty',
      backup: 'unconfirmed',
    });
    assert.equal(
      await f.storage.keyringStorage.createManyIfAbsent(validPair()),
      true
    );
    assert.equal(
      await f.storage.keyringStorage.createManyIfAbsent(validPair(2)),
      false
    );
    assert.equal(
      await f.storage.keyringStorage.get('vault'),
      validPair().vault
    );
    assert.deepEqual(await f.storage.readState(), {
      presence: 'existing',
      backup: 'unconfirmed',
    });
    const fingerprint = await f.storage.getWalletFingerprint();
    await f.storage.confirmBackup(fingerprint);
    assert.deepEqual(await f.storage.readState(), {
      presence: 'existing',
      backup: 'confirmed',
    });
    await f.storage.keyringStorage.set('vault', validPair(2).vault);
    await assert.rejects(f.storage.readState(), /STORAGE_CORRUPT/);
    await assert.rejects(
      f.storage.confirmBackup(fingerprint),
      /STORAGE_CHANGED/
    );
  } finally {
    await f.cleanup();
  }
});

test('four independent SQLite connections admit one complete matching wallet pair', async () => {
  const f = await fixture();
  await f.storage.close();
  const workers = [1, 2, 3, 4].map(
    (index) =>
      new Worker(new URL('./storageWorker.ts', import.meta.url), {
        workerData: { index, file: f.file },
      })
  );
  try {
    await Promise.all(
      workers.map(
        (worker) =>
          new Promise<void>((resolve, reject) => {
            worker.once('error', reject);
            worker.once('message', (message) => {
              assert.equal(message.ready, true);
              resolve();
            });
          })
      )
    );
    const results = workers.map(
      (worker) =>
        new Promise<{ created: boolean; index: number }>((resolve, reject) => {
          worker.once('error', reject);
          worker.once('message', resolve);
          worker.postMessage('go');
        })
    );
    const outcomes = await Promise.all(results);
    assert.equal(outcomes.filter((outcome) => outcome.created).length, 1);
    const winner = outcomes.find((outcome) => outcome.created)!;
    const reopened = nodeConnection(f.file);
    const storage = await SqliteWalletStorage.open(
      reopened.connection,
      digest,
      INSTALLATION,
      false
    );
    assert.equal(
      await storage.keyringStorage.get('vault'),
      validPair(winner.index).vault
    );
    assert.deepEqual(
      await storage.keyringStorage.get('vault-keys'),
      validPair(winner.index)['vault-keys']
    );
    await storage.close();
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
    await f.cleanup();
  }
});

for (const point of [
  'before-first',
  'after-first',
  'before-second',
  'after-second',
  'before-commit',
] as const) {
  test(`failure ${point} cannot commit half a wallet`, async () => {
    let enabled = false;
    let inserts = 0;
    const shouldFail: SqlHook = (kind, sql) => {
      if (!enabled) return;
      if (kind === 'run' && sql.startsWith('INSERT INTO keyring_records'))
        inserts++;
      if (
        (point === 'before-first' && inserts === 1 && kind === 'run') ||
        (point === 'before-second' && inserts === 2 && kind === 'run') ||
        (point === 'before-commit' && sql === 'COMMIT')
      )
        throw Error('synthetic I/O failure');
    };
    const after: SqlHook = (kind, sql) => {
      if (
        enabled &&
        kind === 'run' &&
        sql.startsWith('INSERT INTO keyring_records') &&
        ((point === 'after-first' && inserts === 1) ||
          (point === 'after-second' && inserts === 2))
      )
        throw Error('synthetic lost statement acknowledgement');
    };
    const f = await fixture({ before: shouldFail, after });
    try {
      enabled = true;
      await assert.rejects(
        f.storage.keyringStorage.createManyIfAbsent(validPair()),
        /STORAGE_UNAVAILABLE/
      );
      enabled = false;
      assert.equal(
        f.database
          .prepare('SELECT COUNT(*) AS count FROM keyring_records')
          .get()!.count,
        0
      );
    } finally {
      await f.cleanup();
    }
  });
}

test('lost commit acknowledgement poisons the old connection; reopen reads a complete wallet', async () => {
  let enabled = false;
  const f = await fixture({
    after: (_kind, sql) => {
      if (enabled && sql === 'COMMIT')
        throw Error('lost commit acknowledgement');
    },
  });
  try {
    enabled = true;
    await assert.rejects(
      f.storage.keyringStorage.createManyIfAbsent(validPair()),
      /STORAGE_UNAVAILABLE/
    );
    await assert.rejects(
      f.storage.keyringStorage.get('vault'),
      /STORAGE_REOPEN_REQUIRED/
    );
    await f.storage.close();
    const reopened = nodeConnection(f.file);
    const storage = await SqliteWalletStorage.open(
      reopened.connection,
      digest,
      INSTALLATION,
      false
    );
    assert.deepEqual(await storage.readState(), {
      presence: 'existing',
      backup: 'unconfirmed',
    });
    assert.equal(
      await storage.keyringStorage.createManyIfAbsent(validPair(2)),
      false
    );
    await storage.close();
  } finally {
    await f.cleanup();
  }
});

test('failed rollback poisons admission until close/reopen', async () => {
  let enabled = false;
  const f = await fixture({
    before: (kind, sql) => {
      if (enabled && (sql === 'ROLLBACK' || kind === 'run'))
        throw Error('synthetic failure');
    },
  });
  try {
    enabled = true;
    await assert.rejects(
      f.storage.keyringStorage.set('value', 1),
      /STORAGE_UNAVAILABLE/
    );
    await assert.rejects(
      f.storage.keyringStorage.get('value'),
      /STORAGE_REOPEN_REQUIRED/
    );
  } finally {
    await f.cleanup();
  }
});

test('bounded SQL prevents oversized or wrong-type values crossing the bridge', async () => {
  const f = await fixture();
  try {
    f.database.exec('PRAGMA ignore_check_constraints = ON');
    f.database
      .prepare('INSERT INTO keyring_records (key,value) VALUES (?,?)')
      .run('large', 'x'.repeat(70 * 1024));
    let bridgeValue: unknown = 'not observed';
    const original = f.connection.getFirstAsync.bind(f.connection);
    f.connection.getFirstAsync = async <T>(
      sql: string,
      params?: readonly (string | number | null)[]
    ) => {
      const result = await original<{ value: unknown }>(sql, params);
      bridgeValue = result?.value;
      return result as T | null;
    };
    await assert.rejects(
      f.storage.keyringStorage.get('large'),
      /STORAGE_CORRUPT/
    );
    assert.equal(bridgeValue, null);
    f.database
      .prepare('INSERT INTO keyring_records (key,value) VALUES (?,?)')
      .run('blob', new Uint8Array([1, 2]));
    await assert.rejects(
      f.storage.keyringStorage.get('blob'),
      /STORAGE_CORRUPT/
    );
    f.database
      .prepare('INSERT INTO keyring_records (key,value) VALUES (?,?)')
      .run('bad-json', '{broken');
    await assert.rejects(
      f.storage.keyringStorage.get('bad-json'),
      /STORAGE_CORRUPT/
    );
  } finally {
    await f.cleanup();
  }
});

test('input snapshots reject getters, deep data, huge fanout and preserve present falsy JSON', async () => {
  let called = false;
  assert.throws(
    () =>
      encodeStorageValue({
        get secret() {
          called = true;
          return 'never';
        },
      }),
    /STORAGE_CORRUPT/
  );
  assert.equal(called, false);
  assert.throws(
    () => encodeStorageValue(Array(10001).fill(0)),
    /STORAGE_CORRUPT/
  );
  assert.throws(() => encodeStorageValue('x'.repeat(65537)), /STORAGE_CORRUPT/);
  const f = await fixture();
  try {
    for (const [i, value] of [null, false, 0, ''].entries()) {
      await f.storage.keyringStorage.set(String(i), value);
      assert.equal(await f.storage.keyringStorage.get(String(i)), value);
    }
    const input = { nested: { value: 1 } };
    const pending = f.storage.keyringStorage.set('snapshot', input);
    input.nested.value = 2;
    await pending;
    assert.deepEqual(await f.storage.keyringStorage.get('snapshot'), {
      nested: { value: 1 },
    });
    assert.equal(await f.storage.keyringStorage.get('missing'), undefined);
    assert.throws(
      () => f.storage.keyringStorage.get('\ud800'),
      /STORAGE_CORRUPT/
    );
  } finally {
    await f.cleanup();
  }
});

test('real SQLite trigger abort rolls back both records and query-only errors never return collision', async () => {
  const f = await fixture();
  try {
    f.database.exec(
      "CREATE TRIGGER reject_second BEFORE INSERT ON keyring_records WHEN NEW.key = 'vault-keys' BEGIN SELECT RAISE(ABORT, 'synthetic abort'); END"
    );
    await assert.rejects(
      f.storage.keyringStorage.createManyIfAbsent(validPair()),
      /STORAGE_UNAVAILABLE/
    );
    assert.equal(
      f.database.prepare('SELECT COUNT(*) AS count FROM keyring_records').get()!
        .count,
      0
    );
    f.database.exec('DROP TRIGGER reject_second; PRAGMA query_only = ON');
    await assert.rejects(
      f.storage.keyringStorage.createManyIfAbsent(validPair()),
      /STORAGE_UNAVAILABLE/
    );
    // BEGIN failed and ROLLBACK could not establish a clean transaction state.
    await assert.rejects(
      f.storage.keyringStorage.deleteItem('vault'),
      /STORAGE_REOPEN_REQUIRED/
    );
  } finally {
    await f.cleanup();
  }
});

test('a bounded real SQLite busy failure is an operational error, never a collision', async () => {
  const f = await fixture();
  await f.storage.close();
  const reopened = nodeConnection(f.file, {}, 40);
  const storage = await SqliteWalletStorage.open(
    reopened.connection,
    digest,
    INSTALLATION,
    false
  );
  const worker = new Worker(new URL('./storageWorker.ts', import.meta.url), {
    workerData: { file: f.file, mode: 'hold' },
  });
  try {
    await new Promise<void>((resolve, reject) => {
      worker.once('error', reject);
      worker.once('message', (message) => {
        assert.equal(message.held, true);
        resolve();
      });
    });
    const start = performance.now();
    await assert.rejects(
      storage.keyringStorage.createManyIfAbsent(validPair()),
      /STORAGE_UNAVAILABLE/
    );
    assert.ok(performance.now() - start < 1500);
    await storage.close();
  } finally {
    await worker.terminate();
    await storage.close().catch(() => undefined);
    await f.cleanup();
  }
});

test('close rejects new admissions immediately and waits for previously queued writes', async () => {
  let entered!: () => void;
  let resume!: () => void;
  let enabled = false;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const release = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const f = await fixture({
    before: async (_kind, sql) => {
      if (enabled && sql === 'BEGIN IMMEDIATE') {
        entered();
        await release;
      }
    },
  });
  try {
    enabled = true;
    const writing = f.storage.keyringStorage.set('key', 'value');
    await started;
    const closing = f.storage.close();
    await assert.rejects(f.storage.keyringStorage.get('key'), /STORAGE_CLOSED/);
    resume();
    await writing;
    await closing;
    const reopened = nodeConnection(f.file);
    const storage = await SqliteWalletStorage.open(
      reopened.connection,
      digest,
      INSTALLATION,
      false
    );
    assert.equal(await storage.keyringStorage.get('key'), 'value');
    await storage.close();
  } finally {
    resume();
    await f.cleanup();
  }
});

test('partial wallet and unsupported schema cannot become onboarding', async () => {
  const f = await fixture();
  try {
    await f.storage.keyringStorage.set('vault', validPair().vault);
    await assert.rejects(f.storage.readState(), /STORAGE_CORRUPT/);
    await f.storage.close();
    const reopened = nodeConnection(f.file);
    await assert.rejects(
      SqliteWalletStorage.open(
        reopened.connection,
        digest,
        INSTALLATION,
        false
      ),
      /STORAGE_CORRUPT/
    );
    await reopened.connection.closeAsync();
  } finally {
    await f.cleanup();
  }
});
