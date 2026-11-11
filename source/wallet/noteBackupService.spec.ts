import { KeyringManager } from '@sidhujag/sysweb3-keyring';
import { webcrypto } from 'crypto';

import { AsyncMutex } from '../utils/asyncMutex';
import { identifyClassicNote } from '../utils/privacy/note';

import {
  createNoteBackupCodec,
  NOTE_BACKUP_FORMAT,
  NOTE_BACKUP_MAX_FILE_BYTES,
} from './noteBackup';
import type { INoteBackupPayload } from './noteBackup';
import { createNoteBackupService } from './noteBackupService';
import type { INoteBackupServicePorts } from './noteBackupService';
import { createPrivateVaultSession } from './privateVault';
import { createPrivateVaultController } from './privateVault';
import type { IPrivateVaultHost, IPrivateVaultSession } from './privateVault';

jest.unmock('syscoinjs-lib');
jest.mock('@trezor/connect-webextension', () => ({}));

const NOTE = `tornado-eth-1-1-0x${'01'.repeat(62)}`;
const SECOND = `tornado-eth-1-1-0x${'02'.repeat(62)}`;
const PASSWORD = 'synthetic wallet password';
const FILE_PASSWORD = 'synthetic file password 🔐';
const PAYLOAD: INoteBackupPayload = {
  format: NOTE_BACKUP_FORMAT,
  version: 1,
  createdAt: 1700000000000,
  notes: [
    { note: NOTE, createdAt: 1699999999999 },
    {
      note: SECOND,
      createdAt: 1699999999998,
      reconciliationRequired: true,
      history: {
        withdrawals: [
          { mode: 'relayed', outcome: 'submitted', jobId: 'public-job' },
        ],
      },
    },
  ],
};
const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const nativeCrypto = (overrides: Record<string, unknown> = {}) =>
  ({
    getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
    subtle: new Proxy(webcrypto.subtle, {
      get(target, key) {
        if (key in overrides) return overrides[key as string];
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }),
  } as unknown as Crypto);
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
let file: Uint8Array;
beforeAll(async () => {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
  file = await createNoteBackupCodec({
    crypto: nativeCrypto(),
    assertCurrent: () => undefined,
  }).encrypt(PAYLOAD, FILE_PASSWORD);
});
afterAll(() => {
  if (originalCrypto)
    Object.defineProperty(globalThis, 'crypto', originalCrypto);
  else Reflect.deleteProperty(globalThis, 'crypto');
});
afterEach(() => jest.restoreAllMocks());

function fixture(overrides: Partial<INoteBackupServicePorts> = {}) {
  // Real released SDK record encryption and real codec/core; only external host
  // persistence, authentication and lifecycle are synthetic fault-injection ports.
  const keyring: KeyringManager = Object.create(KeyringManager.prototype);
  Object.assign(keyring, {
    sessionPassword: { isCleared: () => false },
    sessionMnemonic: { isCleared: () => false },
    privateRecordSessionRevision: 0,
    getDecryptedMnemonic: () => 'synthetic service root',
  });
  let generation = 0;
  let elapsed = 10;
  let sequence = 10;
  let serviceSequence = 10000;
  let listener = () => undefined;
  const timers = new Map<() => void, number>();
  const records = new Map<string, unknown>();
  const storage = {
    getItem: jest.fn(async (key: string) =>
      records.has(key) ? structuredClone(records.get(key)) : null
    ),
    setItem: jest.fn(async (key: string, value: unknown) => {
      records.set(key, structuredClone(value));
    }),
  };
  const captureSession = (): IPrivateVaultSession => {
    const captured = generation;
    return createPrivateVaultSession({
      keyring,
      generation,
      assertCurrent: () => {
        if (captured !== generation)
          throw new Error('privacy_vault_session_changed');
      },
    });
  };
  const host: IPrivateVaultHost = {
    captureSession,
    readNote: jest.fn(async () => ({ phase: 'verified' as const })),
    authenticate: jest.fn(async (password, session, reveal) => {
      session.assertCurrent();
      if (password !== PASSWORD) throw new Error('Invalid password');
      const result = await reveal();
      session.assertCurrent();
      return result;
    }),
  };
  const core = createPrivateVaultController(host, {
    storage,
    mutex: new AsyncMutex(),
    generate: () => NOTE,
    identify: identifyClassicNote,
    now: () => 1700000000000,
    deadlineNow: () => elapsed,
    randomId: () => id(sequence++),
  });
  const service = createNoteBackupService({
    vault: core,
    captureSession,
    crypto: nativeCrypto(),
    monotonicNow: () => elapsed,
    randomId: () => id(serviceSequence++),
    scheduleExpiry: (callback, delay) => {
      timers.set(callback, elapsed + delay);
      return () => {
        timers.delete(callback);
      };
    },
    subscribeInvalidation: (callback) => {
      listener = callback;
      return () => {
        listener = () => undefined;
      };
    },
    ...overrides,
  });
  return {
    service,
    core,
    storage,
    records,
    host,
    captureSession,
    timers,
    invalidate: () => {
      generation++;
      listener();
    },
    changeSessionWithoutNotification: () => {
      generation++;
    },
    setElapsed: (value: number, fire = true) => {
      elapsed = value;
      if (fire)
        for (const [callback, at] of [...timers]) if (at <= elapsed) callback();
    },
  };
}
const prepare = async (f: ReturnType<typeof fixture>) => {
  const operationId = f.service.begin();
  return f.service.prepareImport(operationId, file, FILE_PASSWORD);
};

test('real codec/core import previews only counts, commits once with fresh auth and preserves all history', async () => {
  const f = fixture();
  await f.core.importNote(NOTE);
  const before = f.storage.setItem.mock.calls.length;
  const preview = await prepare(f);
  expect(Object.isFrozen(preview)).toBe(true);
  expect(Object.keys(preview).sort()).toEqual([
    'added',
    'duplicates',
    'expiresAt',
    'guarded',
    'id',
  ]);
  expect(preview).toMatchObject({
    added: 1,
    duplicates: 1,
    guarded: 1,
    expiresAt: 300010,
  });
  expect(f.host.authenticate).not.toHaveBeenCalled();
  expect(f.storage.setItem).toHaveBeenCalledTimes(before);
  const committed = await f.service.commitImport(preview.id, PASSWORD);
  expect(committed).toEqual({
    id: preview.id,
    added: 1,
    duplicates: 1,
    guarded: 1,
    confirmed: true,
  });
  expect(f.host.authenticate).toHaveBeenCalledTimes(1);
  expect(f.storage.setItem).toHaveBeenCalledTimes(before + 1);
  await expect(f.service.commitImport(preview.id, PASSWORD)).rejects.toThrow(
    'BACKUP_STALE'
  );
  expect(await f.service.readCommitReceipt(preview.id)).toEqual(committed);
  const exported = await f.core.exportBackupSnapshot(
    PASSWORD,
    f.captureSession()
  );
  expect(exported.notes).toHaveLength(2);
  expect(exported.notes[1]).toMatchObject(PAYLOAD.notes[1]);
  for (const output of [preview, committed]) {
    const text = JSON.stringify(output);
    for (const secret of [
      NOTE,
      SECOND,
      PASSWORD,
      FILE_PASSWORD,
      'public-job',
      'sourceHash',
      'profileId',
    ])
      expect(text).not.toContain(secret);
  }
  f.service.dispose();
  expect(f.timers.size).toBe(0);
});

test('export captures the whole current inventory with fresh auth, and saved-file verification consumes the encrypted slot', async () => {
  const f = fixture();
  await f.core.importNote(NOTE);
  await f.core.importNote(SECOND);
  const operationId = f.service.begin();
  const exported = await f.service.exportEncrypted(
    operationId,
    PASSWORD,
    FILE_PASSWORD
  );
  expect(exported).toMatchObject({
    id: operationId,
    noteCount: 2,
    createdAt: 1700000000000,
  });
  expect(Object.isFrozen(exported)).toBe(true);
  expect(f.host.authenticate).toHaveBeenCalledTimes(1);
  expect(() => f.service.begin()).toThrow('BACKUP_BUSY');
  const opened = await createNoteBackupCodec({
    crypto: nativeCrypto(),
    assertCurrent: () => undefined,
  }).decrypt(exported.bytes, FILE_PASSWORD);
  expect(opened.notes.map((entry) => entry.note)).toEqual([NOTE, SECOND]);
  expect(Buffer.from(exported.bytes).includes(Buffer.from(NOTE))).toBe(false);
  const writes = f.storage.setItem.mock.calls.length;
  expect(
    await f.service.verifyExport(exported.id, exported.bytes, FILE_PASSWORD)
  ).toEqual({
    id: exported.id,
    noteCount: 2,
    createdAt: exported.createdAt,
    verified: true,
  });
  expect(f.storage.setItem).toHaveBeenCalledTimes(writes);
  await expect(
    f.service.verifyExport(exported.id, exported.bytes, FILE_PASSWORD)
  ).rejects.toThrow('BACKUP_STALE');
  expect(f.timers.size).toBe(0);
  f.service.dispose();
});

test('wrong file, changed output bytes and wrong file password never verify; retry retains the original sealed snapshot', async () => {
  const f = fixture();
  await f.core.importNote(NOTE);
  const operationId = f.service.begin();
  const exported = await f.service.exportEncrypted(
    operationId,
    PASSWORD,
    FILE_PASSWORD
  );
  const original = new Uint8Array(exported.bytes);
  exported.bytes[20] ^= 1;
  await expect(
    f.service.verifyExport(operationId, exported.bytes, FILE_PASSWORD)
  ).rejects.toThrow('BACKUP_INVALID_FORMAT');
  await expect(
    f.service.verifyExport(operationId, file, FILE_PASSWORD)
  ).rejects.toThrow('BACKUP_INVALID_FORMAT');
  await expect(
    f.service.verifyExport(operationId, original, 'wrong password')
  ).rejects.toThrow('BACKUP_OPEN_FAILED');
  expect(
    await f.service.verifyExport(operationId, original, FILE_PASSWORD)
  ).toMatchObject({ verified: true, noteCount: 1 });
});

test('both export and commit require the wallet password independently of the file password', async () => {
  const f = fixture();
  await f.core.importNote(NOTE);
  const exportId = f.service.begin();
  await expect(
    f.service.exportEncrypted(exportId, 'wrong', FILE_PASSWORD)
  ).rejects.toThrow('BACKUP_AUTHENTICATION_FAILED');
  const preview = await prepare(f);
  const before = f.storage.setItem.mock.calls.length;
  await expect(
    f.service.commitImport(preview.id, FILE_PASSWORD)
  ).rejects.toThrow('BACKUP_AUTHENTICATION_FAILED');
  expect(f.storage.setItem).toHaveBeenCalledTimes(before);
  expect(await f.service.readCommitReceipt(preview.id)).toBeNull();
  await expect(f.service.commitImport(preview.id, PASSWORD)).rejects.toThrow(
    'BACKUP_STALE'
  );
  f.service.dispose();
});

test('lost storage acknowledgment is recovered only by explicit receipt readback, with no replay or second write', async () => {
  const f = fixture();
  const preview = await prepare(f);
  f.storage.setItem.mockImplementationOnce(async (key, value) => {
    f.records.set(key, structuredClone(value));
    throw new Error(`host secret ${NOTE}`);
  });
  await expect(f.service.commitImport(preview.id, PASSWORD)).rejects.toThrow(
    'BACKUP_COMMIT_UNCONFIRMED'
  );
  expect(await f.service.readCommitReceipt(preview.id)).toEqual({
    id: preview.id,
    added: 2,
    duplicates: 0,
    guarded: 2,
    confirmed: true,
  });
  await expect(f.service.commitImport(preview.id, PASSWORD)).rejects.toThrow(
    'BACKUP_STALE'
  );
  expect(f.storage.setItem).toHaveBeenCalledTimes(1);
  f.service.dispose();
});

test('pre-write failure leaves no receipt and does not change custody', async () => {
  const f = fixture();
  const preview = await prepare(f);
  f.storage.setItem.mockRejectedValueOnce(new Error(NOTE));
  await expect(f.service.commitImport(preview.id, PASSWORD)).rejects.toThrow(
    'BACKUP_COMMIT_UNCONFIRMED'
  );
  expect(await f.service.readCommitReceipt(preview.id)).toBeNull();
  expect(f.records.size).toBe(0);
  f.service.dispose();
});

test('cancel after the atomic write revokes the late result but retains only receipt correlation', async () => {
  const f = fixture();
  const preview = await prepare(f);
  const written = deferred();
  const release = deferred();
  f.storage.setItem.mockImplementationOnce(async (key, value) => {
    f.records.set(key, structuredClone(value));
    written.resolve();
    await release.promise;
  });
  const pending = f.service.commitImport(preview.id, PASSWORD);
  await written.promise;
  f.service.cancel(preview.id);
  await expect(f.service.readCommitReceipt(preview.id)).rejects.toThrow(
    'BACKUP_BUSY'
  );
  release.resolve();
  await expect(pending).rejects.toThrow('BACKUP_CANCELLED');
  expect(await f.service.readCommitReceipt(preview.id)).toEqual({
    id: preview.id,
    added: 2,
    duplicates: 0,
    guarded: 2,
    confirmed: true,
  });
  expect(f.storage.setItem).toHaveBeenCalledTimes(1);
  f.invalidate();
  await expect(f.service.readCommitReceipt(preview.id)).rejects.toThrow(
    'BACKUP_STALE'
  );
  expect(f.timers.size).toBe(0);
});

test('a current inventory change invalidates the preview instead of silently changing reviewed counts', async () => {
  const f = fixture();
  const preview = await prepare(f);
  await f.core.importNote(NOTE);
  const before = f.storage.setItem.mock.calls.length;
  await expect(f.service.commitImport(preview.id, PASSWORD)).rejects.toThrow(
    'BACKUP_STALE'
  );
  expect(f.storage.setItem).toHaveBeenCalledTimes(before);
  f.service.dispose();
});

test.each(['cancel', 'lock', 'expire'] as const)(
  '%s during real KDF rejects the late result and blocks overlapping crypto work',
  async (action) => {
    const entered = deferred();
    const release = deferred();
    const crypto = nativeCrypto({
      deriveKey: async (
        ...args: Parameters<typeof webcrypto.subtle.deriveKey>
      ) => {
        entered.resolve();
        await release.promise;
        return webcrypto.subtle.deriveKey(...args);
      },
    });
    const f = fixture({ crypto });
    const operationId = f.service.begin();
    const pending = f.service.prepareImport(operationId, file, FILE_PASSWORD);
    await entered.promise;
    if (action === 'cancel') f.service.cancel(operationId);
    if (action === 'lock') f.invalidate();
    if (action === 'expire') f.setElapsed(300010);
    expect(() => f.service.begin()).toThrow('BACKUP_BUSY');
    release.resolve();
    await expect(pending).rejects.toThrow('BACKUP_CANCELLED');
    expect(f.storage.getItem).not.toHaveBeenCalled();
    expect(f.records.size).toBe(0);
    const freshId = f.service.begin();
    f.service.cancel(operationId); // A stale window cannot revoke the new flow.
    expect(() => f.service.begin()).toThrow('BACKUP_BUSY');
    f.service.cancel(freshId);
    expect(f.timers.size).toBe(0);
  }
);

test('input file is copied before the first cryptographic await', async () => {
  const entered = deferred();
  const release = deferred();
  const f = fixture({
    crypto: nativeCrypto({
      importKey: async (
        ...args: Parameters<typeof webcrypto.subtle.importKey>
      ) => {
        entered.resolve();
        await release.promise;
        return webcrypto.subtle.importKey(...args);
      },
    }),
  });
  const input = new Uint8Array(file);
  const operationId = f.service.begin();
  const pending = f.service.prepareImport(operationId, input, FILE_PASSWORD);
  await entered.promise;
  input.fill(0);
  release.resolve();
  expect(await pending).toMatchObject({ added: 2 });
  f.service.cancel(operationId);
});

test('cancel during fresh wallet authentication prevents the core write and consumes the preview', async () => {
  const f = fixture();
  const preview = await prepare(f);
  const entered = deferred();
  const release = deferred();
  const original = f.host.authenticate;
  f.host.authenticate = async (...args) => {
    entered.resolve();
    await release.promise;
    return original(...args);
  };
  const pending = f.service.commitImport(preview.id, PASSWORD);
  await entered.promise;
  f.service.cancel(preview.id);
  release.resolve();
  await expect(pending).rejects.toThrow('BACKUP_CANCELLED');
  expect(f.records.size).toBe(0);
  await expect(f.service.commitImport(preview.id, PASSWORD)).rejects.toThrow(
    'BACKUP_STALE'
  );
});

test.each(['notification', 'session', 'expiry'] as const)(
  'prepared secrets are revoked by %s before commit',
  async (reason) => {
    const f = fixture();
    const preview = await prepare(f);
    if (reason === 'notification') f.invalidate();
    if (reason === 'session') f.changeSessionWithoutNotification();
    if (reason === 'expiry') f.setElapsed(300010, false);
    await expect(f.service.commitImport(preview.id, PASSWORD)).rejects.toThrow(
      /BACKUP_(CANCELLED|STALE)/
    );
    expect(f.records.size).toBe(0);
    f.service.dispose();
    expect(f.timers.size).toBe(0);
  }
);

test('expired correlation cannot be revived by clock rollback', async () => {
  const f = fixture();
  const preview = await prepare(f);
  await f.service.commitImport(preview.id, PASSWORD);
  f.setElapsed(300010);
  await expect(f.service.readCommitReceipt(preview.id)).rejects.toThrow(
    'BACKUP_STALE'
  );
  f.setElapsed(0);
  expect(() => f.service.begin()).toThrow('BACKUP_UNAVAILABLE');
  f.service.dispose();
});

test('oversized/hostile readback bytes reject before KDF and without invoking getters', async () => {
  const deriveKey = jest.fn(
    (...args: Parameters<typeof webcrypto.subtle.deriveKey>) =>
      webcrypto.subtle.deriveKey(...args)
  );
  const f = fixture({ crypto: nativeCrypto({ deriveKey }) });
  const operationId = f.service.begin();
  const exported = await f.service.exportEncrypted(
    operationId,
    PASSWORD,
    FILE_PASSWORD
  );
  deriveKey.mockClear();
  const getter = jest.fn(() => {
    throw new Error(NOTE);
  });
  const hostile = new Uint8Array(exported.bytes);
  Object.defineProperty(hostile, 'buffer', { get: getter });
  Object.defineProperty(hostile, 'byteLength', { get: getter });
  await expect(
    f.service.verifyExport(
      operationId,
      new Uint8Array(NOTE_BACKUP_MAX_FILE_BYTES + 1),
      FILE_PASSWORD
    )
  ).rejects.toThrow('BACKUP_INVALID_FORMAT');
  expect(deriveKey).not.toHaveBeenCalled();
  expect(
    await f.service.verifyExport(operationId, hostile, FILE_PASSWORD)
  ).toMatchObject({ verified: true });
  expect(getter).not.toHaveBeenCalled();
});

test('reentrant and asynchronous host guards cannot bypass synchronous one-slot admission', () => {
  let beginAgain = () => undefined;
  const f = fixture({
    randomId: () => {
      beginAgain();
      return id(999);
    },
  });
  beginAgain = () => {
    expect(() => f.service.begin()).toThrow('BACKUP_BUSY');
  };
  const operationId = f.service.begin();
  f.service.cancel(operationId);
  expect(() => f.service.begin()).toThrow('BACKUP_UNAVAILABLE'); // repeated RNG ID
  f.service.dispose();
  const g = fixture({
    captureSession: () =>
      createPrivateVaultSession({
        keyring: {} as KeyringManager,
        generation: 1,
        assertCurrent: async () => undefined,
      }),
  });
  expect(() => g.service.begin()).toThrow('BACKUP_UNAVAILABLE');
  g.service.dispose();
});

test('disposal is terminal, unsubscribes lifecycle and exposes closures only', () => {
  const f = fixture();
  const operationId = f.service.begin();
  expect(
    Object.values(f.service).every((value) => typeof value === 'function')
  ).toBe(true);
  f.service.dispose();
  f.service.dispose();
  expect(f.timers.size).toBe(0);
  expect(() => f.service.begin()).toThrow('BACKUP_UNAVAILABLE');
  f.service.cancel(operationId);
});

test('a forged ID neither commits nor cancels the current preview; competing commit consumes nothing twice', async () => {
  const f = fixture();
  const preview = await prepare(f);
  await expect(f.service.commitImport(id(999), PASSWORD)).rejects.toThrow(
    'BACKUP_STALE'
  );
  f.service.cancel(id(999));
  const entered = deferred();
  const release = deferred();
  const original = f.host.authenticate;
  f.host.authenticate = async (...args) => {
    entered.resolve();
    await release.promise;
    return original(...args);
  };
  const first = f.service.commitImport(preview.id, PASSWORD);
  await entered.promise;
  await expect(f.service.commitImport(preview.id, PASSWORD)).rejects.toThrow(
    'BACKUP_STALE'
  );
  release.resolve();
  expect(await first).toMatchObject({ confirmed: true });
  expect(f.storage.setItem).toHaveBeenCalledTimes(1);
  f.service.dispose();
});

test.each(['export', 'verification'] as const)(
  'cancelling pending %s releases no late output',
  async (step) => {
    const entered = deferred();
    const release = deferred();
    let pause = step === 'export';
    const f = fixture({
      crypto: nativeCrypto({
        deriveKey: async (
          ...args: Parameters<typeof webcrypto.subtle.deriveKey>
        ) => {
          if (pause) {
            entered.resolve();
            await release.promise;
          }
          return webcrypto.subtle.deriveKey(...args);
        },
      }),
    });
    const operationId = f.service.begin();
    const pending =
      step === 'export'
        ? f.service.exportEncrypted(operationId, PASSWORD, FILE_PASSWORD)
        : await (async () => {
            const exported = await f.service.exportEncrypted(
              operationId,
              PASSWORD,
              FILE_PASSWORD
            );
            pause = true;
            return {
              pending: f.service.verifyExport(
                operationId,
                exported.bytes,
                FILE_PASSWORD
              ),
            };
          })();
    const result = 'pending' in pending ? pending.pending : pending;
    await entered.promise;
    f.service.cancel(operationId);
    release.resolve();
    await expect(result).rejects.toThrow('BACKUP_CANCELLED');
    expect(f.timers.size).toBe(0);
  }
);

test('expiry clears staged ciphertext even without another call, and a stale cancel cannot clear a new slot', async () => {
  const f = fixture();
  const first = f.service.begin();
  const exported = await f.service.exportEncrypted(
    first,
    PASSWORD,
    FILE_PASSWORD
  );
  f.setElapsed(300010);
  await expect(
    f.service.verifyExport(first, exported.bytes, FILE_PASSWORD)
  ).rejects.toThrow('BACKUP_STALE');
  expect(f.timers.size).toBe(0);
  const second = f.service.begin();
  f.service.cancel(first);
  expect(() => f.service.begin()).toThrow('BACKUP_BUSY');
  f.service.cancel(second);
});

test('receipt readback rejects a newer different restore and rejects a changed wallet session', async () => {
  const f = fixture();
  const preview = await prepare(f);
  await f.service.commitImport(preview.id, PASSWORD);
  const session = f.captureSession();
  const newer = await f.core.prepareRestore(PAYLOAD.notes, session);
  await f.core.commitRestore(newer, PAYLOAD.notes, PASSWORD, session);
  expect(await f.service.readCommitReceipt(preview.id)).toBeNull();
  f.changeSessionWithoutNotification();
  await expect(f.service.readCommitReceipt(preview.id)).rejects.toThrow(
    'BACKUP_CANCELLED'
  );
  f.service.dispose();
});

test('host error objects cannot leak arbitrary messages or code values', async () => {
  for (const thrown of [
    new Error(NOTE),
    Object.assign(new Error(), { message: 12 }),
    {
      get message() {
        throw new Error(NOTE);
      },
    },
  ]) {
    const f = fixture({
      captureSession: () => {
        throw thrown;
      },
    });
    expect(() => f.service.begin()).toThrow('BACKUP_UNAVAILABLE');
    f.service.dispose();
  }
});

test.each(['capture', 'guard'] as const)(
  'nested begin during %s cannot replace a partially admitted operation',
  (point) => {
    let nested = () => undefined;
    let captured = 0;
    let attempted = false;
    const reenter = () => {
      if (!attempted) {
        attempted = true;
        nested();
      }
    };
    const f = fixture({
      captureSession: () => {
        captured++;
        if (point === 'capture') reenter();
        return createPrivateVaultSession({
          keyring: {} as KeyringManager,
          generation: 0,
          assertCurrent: () => {
            if (point === 'guard') reenter();
          },
        });
      },
    });
    nested = () => {
      expect(() => f.service.begin()).toThrow('BACKUP_BUSY');
    };
    const operationId = f.service.begin();
    expect(captured).toBe(1);
    f.service.cancel(operationId);
  }
);

test('a synchronously expired receipt schedule cleans up its late cancellation handle without committing', async () => {
  let scheduled = 0;
  const released = jest.fn();
  const f = fixture({
    scheduleExpiry: (expire) => {
      scheduled++;
      if (scheduled === 2) expire();
      return released;
    },
  });
  const preview = await prepare(f);
  await expect(f.service.commitImport(preview.id, PASSWORD)).rejects.toThrow(
    'BACKUP_CANCELLED'
  );
  expect(f.host.authenticate).not.toHaveBeenCalled();
  expect(f.records.size).toBe(0);
  expect(released).toHaveBeenCalledTimes(2);
  f.service.dispose();
});
