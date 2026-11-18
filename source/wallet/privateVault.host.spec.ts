import { KeyringManager } from '@sidhujag/sysweb3-keyring';
import { webcrypto } from 'crypto';
import { Interface, keccak256, parseEther, toUtf8Bytes } from 'ethers';

import { createPrivateVaultController as createExtensionVault } from '../scripts/Background/controllers/privateVault';
import { KeyringAccountType } from '../types/network';
import { AsyncMutex, walletPersistenceMutex } from '../utils/asyncMutex';
import {
  generateClassicNote,
  identifyClassicNote,
} from '../utils/privacy/note';
import { getPrivacyPool } from '../utils/privacy/registry';
import { chromeStorage } from '../utils/storageAPI';

import * as core from './privateVault';
import type {
  IPrivateVaultDependencies,
  IPrivateVaultHost,
  IPrivateVaultSession,
} from './privateVault';
import {
  envelopeHash,
  privateVaultNoteKey,
  PRIVATE_VAULT_SHARD_DOMAIN,
  MAX_SHARD_NOTES,
} from './privateVaultInspection';
import type { IStoredNote } from './privateVaultInspection';
import type { IPrivacyDepositAttempt } from '../utils/privacy/transactionTypes';
import type { IPrivacyWithdrawalAttempt } from '../utils/privacy/withdrawalTransactionTypes';

jest.unmock('syscoinjs-lib');
jest.mock('@trezor/connect-webextension', () => ({}));

const ROOT = 'synthetic shared private vault test root';
const NOTE = `tornado-eth-1-1-0x${'01'.repeat(62)}`;
const SECOND_NOTE = `tornado-eth-1-1-0x${'02'.repeat(62)}`;
const RECORD_ID = '00000000-0000-4000-8000-000000000001';
const INTENT_ID = '00000000-0000-4000-8000-000000000002';
const HASH = '0x' + 'ab'.repeat(32);
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
});
afterAll(() => {
  if (originalCrypto)
    Object.defineProperty(globalThis, 'crypto', originalCrypto);
  else Reflect.deleteProperty(globalThis, 'crypto');
});
afterEach(() => jest.restoreAllMocks());

function fixture() {
  // Actual released SDK AEAD methods, with synthetic private root and no wallet,
  // hardware, browser storage or network initialization.
  const keyring: any = Object.create(KeyringManager.prototype);
  keyring.sessionPassword = { isCleared: () => false };
  keyring.sessionMnemonic = { isCleared: () => false };
  keyring.privateRecordSessionRevision = 0;
  keyring.getDecryptedMnemonic = () => ROOT;
  const records: Record<string, unknown> = {};
  let generation = 0;
  let sessionError = 'privacy_vault_session_changed';
  let sequence = 10;
  let elapsed = 0;
  let wallNow = 456;
  const storage = {
    getItem: jest.fn(async (key: string) =>
      records[key] === undefined ? null : structuredClone(records[key])
    ),
    setItem: jest.fn(async (key: string, value: unknown) => {
      records[key] = structuredClone(value);
    }),
  };
  const guardOverrides = new WeakMap<IPrivateVaultSession, () => void>();
  const captureSession = (): IPrivateVaultSession => {
    const captured = generation;
    const session = core.createPrivateVaultSession({
      keyring,
      generation: captured,
      assertCurrent: () => {
        const override = guardOverrides.get(session);
        if (override) return override();
        if (generation !== captured) throw new Error(sessionError);
      },
    });
    return session;
  };
  const revalidate = jest.fn(async () => undefined);
  const host: IPrivateVaultHost = {
    captureSession: jest.fn(captureSession),
    readNote: jest.fn(async () => ({ phase: 'verified' as const })),
    authenticate: jest.fn(async (password, session, reveal) => {
      session.assertCurrent();
      if (password !== 'synthetic-password')
        throw new Error('Invalid password');
      const result = await reveal();
      session.assertCurrent();
      return result;
    }),
    prepareCompletionProof: jest.fn(async () => ({ revalidate })),
  };
  const dependencies: IPrivateVaultDependencies = {
    storage,
    mutex: new AsyncMutex(),
    generate: () => NOTE,
    identify: identifyClassicNote,
    now: () => wallNow,
    deadlineNow: () => elapsed,
    randomId: () =>
      `00000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`,
  };
  return {
    host,
    setSessionGuard: (session: IPrivateVaultSession, guard: () => void) => {
      guardOverrides.set(session, guard);
    },
    dependencies,
    storage,
    records,
    keyring: keyring as KeyringManager,
    revalidate,
    setNow: (value: number) => {
      wallNow = value;
    },
    setElapsed: (value: number) => {
      elapsed = value;
    },
    cycleSession: (error = sessionError) => {
      sessionError = error;
      generation += 2;
    },
  };
}

test('inventory reuses each authenticated note identity without another derivation', async () => {
  const f = fixture();
  const identify = jest.fn(identifyClassicNote);
  const vault = core.createPrivateVaultController(f.host, {
    ...f.dependencies,
    identify,
  });
  const first = await vault.importNote(NOTE);
  const second = await vault.importNote(SECOND_NOTE);
  identify.mockClear();
  f.storage.setItem.mockClear();

  await expect(vault.getNotes()).resolves.toEqual({ notes: [first, second] });
  expect(identify.mock.calls).toEqual([[NOTE], [SECOND_NOTE]]);
  expect(f.storage.setItem).not.toHaveBeenCalled();
});

test.each([
  ['privacy_vault_session_changed', 'privacy_vault_session_changed'],
  ['CANCELLED', 'privacy_vault_unavailable'],
])(
  'inventory stops at the first yield if the owner reports %s',
  async (stale, expected) => {
    const f = fixture();
    const identify = jest.fn(identifyClassicNote);
    const yieldInventory = jest.fn(async () => f.cycleSession(stale));
    const vault = core.createPrivateVaultController(f.host, {
      ...f.dependencies,
      identify,
      yieldInventory,
    });
    for (let index = 1; index <= 5; index++) {
      await vault.importNote(
        `tornado-eth-1-1-0x${String(index).padStart(2, '0').repeat(62)}`
      );
    }
    expect(yieldInventory).not.toHaveBeenCalled();
    identify.mockClear();
    jest.mocked(f.host.readNote).mockClear();
    f.storage.setItem.mockClear();

    await expect(vault.getNotes()).rejects.toThrow(expected);
    expect(identify).toHaveBeenCalledTimes(4);
    expect(yieldInventory).toHaveBeenCalledTimes(1);
    expect(f.host.readNote).not.toHaveBeenCalled();
    expect(f.storage.setItem).not.toHaveBeenCalled();
  }
);

test('shared core imports and runs without browser storage or global mutex modules', async () => {
  const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
  jest.doMock('../utils/storageAPI', () => {
    throw new Error('Shared core imported browser storage');
  });
  jest.doMock('../utils/asyncMutex', () => {
    throw new Error('Shared core imported global mutexes');
  });
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    get: () => {
      throw new Error('Shared core accessed chrome');
    },
  });
  try {
    let createCore!: typeof core.createPrivateVaultController;
    jest.isolateModules(() => {
      // Isolated runtime import is the behavior under test.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      createCore = require('./privateVault').createPrivateVaultController;
    });
    const f = fixture();
    const vault = createCore(f.host, f.dependencies);
    const imported = await vault.importNote(NOTE);
    expect(imported.poolId).toBe('eth-1');
    expect((await vault.getNotes()).notes).toEqual([imported]);
    expect(f.storage.setItem).toHaveBeenCalledTimes(1);
  } finally {
    jest.dontMock('../utils/storageAPI');
    jest.dontMock('../utils/asyncMutex');
    if (originalChrome)
      Object.defineProperty(globalThis, 'chrome', originalChrome);
    else Reflect.deleteProperty(globalThis, 'chrome');
  }
});

test('shared core requires every environment port and never falls back to a host global', () => {
  const f = fixture();
  for (const key of Object.keys(f.dependencies) as Array<
    keyof IPrivateVaultDependencies
  >) {
    const incomplete = { ...f.dependencies, [key]: undefined };
    expect(() =>
      core.createPrivateVaultController(
        f.host,
        incomplete as IPrivateVaultDependencies
      )
    ).toThrow('privacy_vault_unavailable');
  }
  expect(f.host.captureSession).not.toHaveBeenCalled();
  expect(f.storage.getItem).not.toHaveBeenCalled();
  expect(f.storage.setItem).not.toHaveBeenCalled();
});

test('extension wrapper preserves storage and mutex defaults, with an independent deadline clock', () => {
  const f = fixture();
  const createCore = jest
    .spyOn(core, 'createPrivateVaultController')
    .mockReturnValue(
      {} as ReturnType<typeof core.createPrivateVaultController>
    );
  const recordClockAtConstruction = Date.now;
  createExtensionVault(f.host);
  const defaults = createCore.mock.calls[0][1];
  expect(defaults.storage).not.toBe(chromeStorage);
  expect(defaults.storage).toEqual({
    getItem: expect.any(Function),
    setItem: expect.any(Function),
  });
  expect(defaults.mutex).toBe(walletPersistenceMutex);
  expect(defaults.identify).toBe(identifyClassicNote);
  expect(defaults.generate).toBe(generateClassicNote);
  expect(defaults.now).toBe(recordClockAtConstruction);
  // Deadline reads historically looked up Date.now at the instant of each
  // check, including when a host/test replaces its implementation later.
  jest.spyOn(Date, 'now').mockReturnValue(12_345);
  expect(defaults.now).not.toBe(Date.now);
  expect(defaults.deadlineNow()).toBe(12_345);
  expect(defaults.randomId()).toMatch(/^[0-9a-f-]{36}$/);

  const recordNow = () => 456;
  createExtensionVault(f.host, { now: recordNow, storage: f.storage });
  const overridden = createCore.mock.calls[1][1];
  expect(overridden.now).toBe(recordNow);
  expect(overridden.storage).toBe(f.storage);
  expect(overridden.deadlineNow()).toBe(12_345);
  expect(overridden.mutex).toBe(walletPersistenceMutex);
});

function defaultStorageFixture() {
  const f = fixture();
  const get = jest.spyOn(chrome.storage.local, 'get').mockImplementation(((
    keys: string[],
    callback: (records: Record<string, unknown>) => void
  ) => {
    callback(
      Object.fromEntries(
        keys
          .filter((key) => Object.prototype.hasOwnProperty.call(f.records, key))
          .map((key) => [key, structuredClone(f.records[key])])
      )
    );
  }) as any);
  const set = jest.spyOn(chrome.storage.local, 'set').mockImplementation(((
    records: Record<string, unknown>,
    callback: () => void
  ) => {
    Object.assign(f.records, structuredClone(records));
    callback();
  }) as any);
  get.mockClear();
  set.mockClear();
  const dependencies: Partial<IPrivateVaultDependencies> = {
    ...f.dependencies,
  };
  delete dependencies.storage;
  return {
    ...f,
    get,
    set,
    vault: createExtensionVault(f.host, dependencies),
  };
}

test.each([false, 0, ''])(
  'default extension storage rejects present malformed value %j without writing',
  async (value) => {
    const f = defaultStorageFixture();
    const key =
      core.PRIVATE_VAULT_STORAGE_PREFIX +
      (await f.keyring.getPrivateRecordProfileId());
    f.records[key] = value;

    await expect(f.vault.getNotes()).rejects.toThrow('privacy_vault_corrupt');
    await expect(f.vault.createDepositNote('eth-1')).rejects.toThrow(
      'privacy_vault_corrupt'
    );
    expect(f.get).toHaveBeenCalledTimes(2);
    expect(f.get).toHaveBeenNthCalledWith(1, [key], expect.any(Function));
    expect(f.get).toHaveBeenNthCalledWith(2, [key], expect.any(Function));
    expect(f.set).not.toHaveBeenCalled();
    expect(f.records).toEqual({ [key]: value });
  }
);

test.each([
  ['missing', undefined],
  ['null', null],
])(
  'default extension storage keeps %s empty and reopens valid ciphertext',
  async (_, value) => {
    const f = defaultStorageFixture();
    const key =
      core.PRIVATE_VAULT_STORAGE_PREFIX +
      (await f.keyring.getPrivateRecordProfileId());
    if (value !== undefined) f.records[key] = value;
    await expect(f.vault.getNotes()).resolves.toEqual({ notes: [] });
    expect(f.set).not.toHaveBeenCalled();

    const created = await f.vault.createDepositNote('eth-1');
    expect(created.phase).toBe('prepared');
    expect(f.set).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.records[key])).not.toContain(NOTE);
    expect((await f.vault.getNotes()).notes).toEqual([
      expect.objectContaining({ id: created.id, poolId: 'eth-1' }),
    ]);
    await expect(
      f.vault.revealNote(created.id, 'synthetic-password')
    ).resolves.toBe(NOTE);
    expect(f.set).toHaveBeenCalledTimes(1);
  }
);

test('default extension storage still refuses even a valid bundle stored as a string', async () => {
  const f = defaultStorageFixture();
  const key =
    core.PRIVATE_VAULT_STORAGE_PREFIX +
    (await f.keyring.getPrivateRecordProfileId());
  await f.vault.importNote(NOTE);
  const raw = JSON.stringify(f.records[key]);
  f.records[key] = raw;
  f.set.mockClear();

  await expect(f.vault.getNotes()).rejects.toThrow('privacy_vault_corrupt');
  expect(f.set).not.toHaveBeenCalled();
  expect(f.records[key]).toBe(raw);
});

test('guarded serialized storage preserves exact expectations without falling back to an object write', async () => {
  const f = fixture();
  await createExtensionVault(f.host, f.dependencies).importNote(NOTE);
  const [key] = Object.keys(f.records);
  const stored = f.records[key] as Record<string, unknown>;
  const raw = JSON.stringify({ version: stored.version, ...stored });
  expect(raw).not.toBe(JSON.stringify(stored));
  f.storage.setItem.mockClear();
  const compareAndSet = jest.fn(async () => false);
  const vault = core.createPrivateVaultController(f.host, {
    ...f.dependencies,
    storage: { ...f.storage, getItem: async () => raw, compareAndSet },
  });

  await expect(vault.setCapacity(256)).rejects.toThrow(
    'privacy_vault_session_changed'
  );
  expect(compareAndSet).toHaveBeenCalledTimes(1);
  expect(compareAndSet).toHaveBeenCalledWith(
    key,
    raw,
    expect.any(String),
    expect.any(Function)
  );
  expect(f.storage.setItem).not.toHaveBeenCalled();
  expect(f.records[key]).toEqual(stored);
});

test('guarded storage rejects an asynchronous session guard before storage I/O', async () => {
  const f = fixture();
  const session = f.host.captureSession();
  const compareAndSet = jest.fn(async () => true);
  const vault = core.createPrivateVaultController(
    {
      ...f.host,
      captureSession: () =>
        core.createPrivateVaultSession({
          ...session,
          assertCurrent: async () => {
            throw new Error('Detached guard failure');
          },
        }),
    },
    { ...f.dependencies, storage: { ...f.storage, compareAndSet } }
  );

  await expect(vault.setCapacity(256)).rejects.toThrow(
    'privacy_vault_session_changed'
  );
  expect(f.storage.getItem).not.toHaveBeenCalled();
  expect(f.storage.setItem).not.toHaveBeenCalled();
  expect(compareAndSet).not.toHaveBeenCalled();
});

function rejectingGuard() {
  const sinks: jest.SpyInstance[] = [];
  const guard = jest.fn(() => {
    const pending = Promise.reject(new Error('Detached guard failure'));
    // Keep the negative control from terminating Jest before asserting that
    // production consumed the rejection it received.
    void pending.then(undefined, () => undefined);
    sinks.push(jest.spyOn(pending, 'catch'));
    return pending;
  });
  return { guard, sinks };
}

test.each(['prepare', 'receipt', 'commit plan', 'commit session'] as const)(
  'guarded %s rejects and consumes an asynchronous session guard before effects',
  async (operation) => {
    const f = fixture();
    const compareAndSet = jest.fn(async () => true);
    const vault = core.createPrivateVaultController(f.host, {
      ...f.dependencies,
      storage: { ...f.storage, compareAndSet },
    });
    const { guard, sinks } = rejectingGuard();
    const entries = [{ note: NOTE, createdAt: 10 }];
    const admitted = f.host.captureSession();
    const session = f.host.captureSession();
    let run: Promise<unknown>;
    if (operation === 'prepare' || operation === 'receipt') {
      f.setSessionGuard(session, guard);
      run =
        operation === 'prepare'
          ? vault.prepareRestore(entries, session)
          : vault.getRestoreReceipt(session);
    } else {
      const plan = await vault.prepareRestore(entries, admitted);
      f.storage.getItem.mockClear();
      f.setSessionGuard(
        operation === 'commit plan' ? admitted : session,
        guard
      );
      run = vault.commitRestore(plan, entries, 'synthetic-password', session);
    }

    await expect(run).rejects.toThrow('privacy_vault_session_changed');
    expect(sinks).toHaveLength(1);
    expect(sinks[0]).toHaveBeenCalledTimes(1);
    expect(f.storage.getItem).not.toHaveBeenCalled();
    expect(f.host.authenticate).not.toHaveBeenCalled();
    expect(f.storage.setItem).not.toHaveBeenCalled();
    expect(compareAndSet).not.toHaveBeenCalled();
  }
);

test('guarded pruning consumes a rejected guard and retires its restore plan', async () => {
  const f = fixture();
  const compareAndSet = jest.fn(async () => true);
  const vault = core.createPrivateVaultController(f.host, {
    ...f.dependencies,
    storage: { ...f.storage, compareAndSet },
  });
  const entries = [{ note: NOTE, createdAt: 10 }];
  const stale = f.host.captureSession();
  const oldPlan = await vault.prepareRestore(entries, stale);
  const { guard, sinks } = rejectingGuard();
  f.setSessionGuard(stale, guard);
  const current = f.host.captureSession();
  await expect(vault.prepareRestore(entries, current)).resolves.toBeDefined();
  expect(sinks).toHaveLength(1);
  expect(sinks[0]).toHaveBeenCalledTimes(1);
  await expect(
    vault.commitRestore(oldPlan, entries, 'synthetic-password', current)
  ).rejects.toThrow('privacy_restore_stale');
  expect(f.host.authenticate).not.toHaveBeenCalled();
  expect(compareAndSet).not.toHaveBeenCalled();
});

test('a second preview preserves an earlier plan after only its operation codec retires', async () => {
  const f = fixture();
  const vault = core.createPrivateVaultController(f.host, f.dependencies);
  const owner = f.host.captureSession();
  let operation = {};
  const session: IPrivateVaultSession = Object.freeze({
    ...owner,
    captureOperation(check: () => void) {
      const captured = operation;
      return core.createPrivateVaultSession({
        generation: owner.generation,
        keyring: owner.keyring,
        assertCurrent() {
          owner.assertCurrent();
          check();
          if (operation !== captured)
            throw new Error('expired operation codec');
        },
      });
    },
  });
  const entries = [{ note: NOTE, createdAt: 10 }];
  const first = await vault.prepareRestore(entries, session);
  operation = {};
  await vault.prepareRestore(entries, session);
  operation = {};
  await expect(
    vault.commitRestore(first, entries, 'synthetic-password', session)
  ).resolves.toMatchObject({ added: 1 });
  expect(f.host.authenticate).toHaveBeenCalledTimes(1);
});

test('guarded bundle inspection clears plaintext when its guard stops being synchronous', async () => {
  const f = fixture();
  await createExtensionVault(f.host, f.dependencies).importNote(NOTE);
  const raw = JSON.stringify(Object.values(f.records)[0]);
  const compareAndSet = jest.fn(async () => true);
  const vault = core.createPrivateVaultController(f.host, {
    ...f.dependencies,
    storage: { getItem: async () => raw, compareAndSet },
  });
  const session = f.host.captureSession();
  const { guard, sinks } = rejectingGuard();
  let plaintext!: Uint8Array;
  const decrypt = f.keyring.decryptPrivateRecord.bind(f.keyring);
  const observe = jest
    .spyOn(f.keyring, 'decryptPrivateRecord')
    .mockImplementationOnce(async (input) => {
      plaintext = await decrypt(input);
      f.setSessionGuard(session, guard);
      return plaintext;
    });

  await expect(vault.getRestoreReceipt(session)).rejects.toThrow(
    'privacy_vault_session_changed'
  );
  expect(plaintext.length).toBeGreaterThan(0);
  expect(plaintext.every((byte) => byte === 0)).toBe(true);
  expect(observe).toHaveBeenCalledTimes(1);
  expect(sinks).toHaveLength(1);
  expect(sinks[0]).toHaveBeenCalledTimes(1);
  expect(compareAndSet).not.toHaveBeenCalled();
});

test('default extension storage read errors cannot become an empty writable vault', async () => {
  const f = defaultStorageFixture();
  const descriptor = Object.getOwnPropertyDescriptor(
    chrome.runtime,
    'lastError'
  );
  Object.defineProperty(chrome.runtime, 'lastError', {
    configurable: true,
    value: { message: 'Synthetic Chrome storage failure' },
  });
  try {
    await expect(f.vault.getNotes()).rejects.toThrow(
      'privacy_vault_unavailable'
    );
    await expect(f.vault.createDepositNote('eth-1')).rejects.toThrow(
      'privacy_vault_unavailable'
    );
    expect(f.set).not.toHaveBeenCalled();
    expect(f.records).toEqual({});
  } finally {
    if (descriptor)
      Object.defineProperty(chrome.runtime, 'lastError', descriptor);
    else Reflect.deleteProperty(chrome.runtime, 'lastError');
  }
});

test('shared core and extension wrapper reopen the same canonical ciphertext across capacity changes', async () => {
  const f = fixture();
  const shared = core.createPrivateVaultController(f.host, f.dependencies);
  const imported = await shared.importNote(NOTE);
  const initial = structuredClone(f.records);
  const extension = createExtensionVault(f.host, f.dependencies);
  expect((await extension.getNotes()).notes).toEqual([imported]);
  expect(await extension.revealNote(imported.id, 'synthetic-password')).toBe(
    NOTE
  );
  expect(f.records).toEqual(initial);
  expect(f.storage.setItem).toHaveBeenCalledTimes(1);

  await extension.setCapacity(256);
  const resized = structuredClone(f.records);
  expect(Object.values(resized)[0]).toMatchObject({
    format: core.PRIVATE_VAULT_FORMAT,
    version: 1,
  });
  const reopened = core.createPrivateVaultController(f.host, f.dependencies);
  expect(await reopened.getCapacity()).toMatchObject({
    capacity: 256,
    noteCount: 1,
  });
  expect(f.records).toEqual(resized);
  await extension.importNote(SECOND_NOTE);
  expect((await reopened.getNotes()).notes).toHaveLength(2);
  const persisted = JSON.stringify(f.records);
  expect(persisted).not.toContain(NOTE);
  expect(persisted).not.toContain(SECOND_NOTE);
  expect(persisted).not.toContain(ROOT);
});

test('direct shared-core reads reject a session cycle even with unchanged keyring and profile', async () => {
  const f = fixture();
  const vault = core.createPrivateVaultController(f.host, f.dependencies);
  await vault.importNote(NOTE);
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.storage.getItem.mockImplementationOnce(async (key) => {
    enter();
    await wait;
    return structuredClone(f.records[key]);
  });
  const pending = vault.getNotes();
  const rejected = expect(pending).rejects.toThrow(
    'privacy_vault_session_changed'
  );
  await entered;
  f.cycleSession();
  release();
  await rejected;
  expect(f.storage.setItem).toHaveBeenCalledTimes(1);
});

test('cleanup deadline advances independently of fixed record timestamps', async () => {
  const f = fixture();
  const manifest = {
    version: 1,
    notes: [
      {
        id: RECORD_ID,
        note: NOTE,
        createdAt: 456,
        withdrawal: {
          intentId: INTENT_ID,
          attemptHash: HASH,
          inputHash: HASH,
          proofHash: HASH,
          createdAt: 456,
          mode: 'relayed',
          phase: 'submitted',
          endpoint: 'https://relay.example',
          ensHash: HASH,
          transactionHash: HASH,
        },
      },
    ],
  };
  const shardPlain = new TextEncoder().encode(JSON.stringify(manifest));
  try {
    const shard = await f.keyring.encryptPrivateRecord({
      domain: 'org.syscoin.pali.privacy.notes.shard.v2',
      recordId: INTENT_ID,
      plaintext: shardPlain,
    });
    const rootPlain = new TextEncoder().encode(
      JSON.stringify({
        format: core.PRIVATE_VAULT_FORMAT,
        version: 1,
        capacity: 128,
        noteCount: 1,
        shards: [
          {
            recordId: shard.recordId,
            count: 1,
            hash: keccak256(
              toUtf8Bytes(
                JSON.stringify([
                  shard.version,
                  shard.domain,
                  shard.recordId,
                  shard.profileId,
                  shard.nonce,
                  shard.ciphertext,
                ])
              )
            ),
          },
        ],
      })
    );
    try {
      const envelope = await f.keyring.encryptPrivateRecord({
        domain: core.PRIVATE_VAULT_DOMAIN,
        recordId: RECORD_ID,
        plaintext: rootPlain,
      });
      f.records[core.PRIVATE_VAULT_STORAGE_PREFIX + envelope.profileId] = {
        format: core.PRIVATE_VAULT_FORMAT,
        version: 1,
        root: envelope,
        shards: [shard],
      };
    } finally {
      rootPlain.fill(0);
    }
  } finally {
    shardPlain.fill(0);
  }
  const before = structuredClone(f.records);
  f.host.prepareCompletionProof = jest.fn(async () => {
    f.setElapsed(60_001);
    return { revalidate: f.revalidate };
  });
  const vault = core.createPrivateVaultController(f.host, f.dependencies);
  expect(await vault.clearCompletedNotes([RECORD_ID])).toEqual({
    removed: [],
    unresolved: [RECORD_ID],
  });
  expect(f.host.prepareCompletionProof).toHaveBeenCalledTimes(1);
  expect(f.revalidate).not.toHaveBeenCalled();
  expect(f.dependencies.now()).toBe(456);
  expect(f.storage.setItem).not.toHaveBeenCalled();
  expect(f.records).toEqual(before);
});

function depositAttempt(
  noteId: string,
  generation: number
): IPrivacyDepositAttempt {
  const pool = getPrivacyPool('eth-1');
  const address = '0x' + '11'.repeat(20);
  return {
    intentId: INTENT_ID,
    noteId,
    poolId: pool.id,
    createdAt: 456,
    expiresAt: 60456,
    context: {
      chainId: 1,
      rpcUrl: 'https://operator.example',
      slip44: 60,
      sessionGeneration: generation,
      account: { id: 0, type: KeyringAccountType.HDAccount, address },
    },
    transaction: {
      chainId: 1,
      from: address,
      to: pool.address,
      value: parseEther(pool.amount).toString(),
      data: new Interface([
        'function deposit(bytes32 commitment) payable',
      ]).encodeFunctionData('deposit', [identifyClassicNote(NOTE).commitment]),
      gasLimit: '100000',
      nonce: '7',
      maxFeePerGas: '100',
      maxPriorityFeePerGas: '1',
    },
  };
}

async function depositFixture() {
  const f = fixture();
  jest.mocked(f.host.readNote).mockResolvedValue({ phase: 'not-found' });
  const vault = core.createPrivateVaultController(f.host, f.dependencies);
  const note = await vault.createDepositNote('eth-1');
  const session = f.host.captureSession();
  const attempt = depositAttempt(note.id, session.generation);
  await vault.reserveDepositAttempt(attempt, session);
  return { ...f, vault, note, session, attempt };
}

test('deposit acknowledgement keeps the original attempt across session restart and review expiry', async () => {
  const f = await depositFixture();
  const before = await f.vault.getDepositAttempt(f.note.id, f.session);
  f.cycleSession();
  f.setNow(100000);
  const session = f.host.captureSession();
  expect(session.generation).not.toBe(f.attempt.context.sessionGeneration);
  await f.vault.recordDepositBroadcast(f.attempt, HASH, session);
  expect(await f.vault.getDepositAttempt(f.note.id, session)).toEqual({
    ...before,
    phase: 'submitted',
    transactionHash: HASH,
  });
});

test('a late deposit acknowledgement preserves the original attempt after note restore', async () => {
  const f = await depositFixture();
  const entries = [
    { note: NOTE, createdAt: 1, reconciliationRequired: true as const },
  ];
  const plan = await f.vault.prepareRestore(entries, f.session);
  await f.vault.commitRestore(plan, entries, 'synthetic-password', f.session);
  await f.vault.recordDepositBroadcast(f.attempt, HASH, f.session);
  expect(await f.vault.getDepositAttempt(f.note.id, f.session)).toMatchObject({
    phase: 'submitted',
    transactionHash: HASH,
  });
});

function withdrawalAttempt(
  noteId: string,
  generation: number
): Extract<IPrivacyWithdrawalAttempt, { mode: 'direct' }> {
  const deposit = depositAttempt(noteId, generation);
  const proof = `0x${'ab'.repeat(256)}`;
  const root = `0x${'01'.repeat(32)}`;
  const nullifierHash = identifyClassicNote(NOTE).nullifierHash;
  const recipient = `0x${'22'.repeat(20)}`;
  const relayer = `0x${'00'.repeat(20)}`;
  return {
    intentId: deposit.intentId,
    noteId,
    poolId: deposit.poolId,
    createdAt: deposit.createdAt,
    expiresAt: deposit.expiresAt,
    context: deposit.context,
    mode: 'direct',
    proof,
    root,
    rootAnchor: { root, blockNumber: '8', blockHash: HASH },
    nullifierHash,
    recipient,
    relayer,
    fee: '0',
    refund: '0',
    transaction: {
      ...deposit.transaction,
      value: '0',
      data: new Interface([
        'function withdraw(bytes,bytes32,bytes32,address,address,uint256,uint256)',
      ]).encodeFunctionData('withdraw', [
        proof,
        root,
        nullifierHash,
        recipient,
        relayer,
        0,
        0,
      ]),
      gasLimit: '650000',
    },
  };
}

async function withdrawalFixture() {
  const f = fixture();
  const vault = core.createPrivateVaultController(f.host, f.dependencies);
  const note = await vault.importNote(NOTE);
  const session = f.host.captureSession();
  const attempt = withdrawalAttempt(note.id, session.generation);
  await vault.reserveWithdrawalAttempt(
    attempt,
    session,
    '00000000-0000-4000-8000-000000000099:0'
  );
  return { ...f, vault, note, session, attempt };
}

test('a new withdrawal from a previously reviewed restored note can be recorded', async () => {
  const f = fixture();
  const vault = core.createPrivateVaultController(f.host, f.dependencies);
  const session = f.host.captureSession();
  const entries = [
    { note: NOTE, createdAt: 1, reconciliationRequired: true as const },
  ];
  const plan = await vault.prepareRestore(entries, session);
  await vault.commitRestore(plan, entries, 'synthetic-password', session);
  const note = (await vault.getNotes()).notes[0];
  const stored = {
    id: note.id,
    note: NOTE,
    createdAt: 1,
    restoreGuard: {
      importedAt: 1,
      reviewedAt: 1,
      sourceHash: HASH,
      version: 1 as const,
    },
  };
  await seedArchiveVault(f, [stored]);
  const attempt = withdrawalAttempt(note.id, session.generation);
  await vault.reserveWithdrawalAttempt(
    attempt,
    session,
    '00000000-0000-4000-8000-000000000099:0'
  );
  await vault.recordWithdrawalSubmission(
    attempt,
    { transactionHash: HASH },
    session
  );
  expect(await vault.getWithdrawalAttempt(note.id, session)).toMatchObject({
    phase: 'submitted',
    transactionHash: HASH,
  });
});

test('withdrawal acknowledgement retains the original journal across a cold session and expired review', async () => {
  const f = await withdrawalFixture();
  const before = await f.vault.getWithdrawalAttempt(f.note.id, f.session);
  f.cycleSession();
  f.setNow(100000);
  const session = f.host.captureSession();
  const reopened = core.createPrivateVaultController(f.host, f.dependencies);
  await reopened.recordWithdrawalSubmission(
    f.attempt,
    { transactionHash: HASH },
    session
  );
  expect(await reopened.getWithdrawalAttempt(f.note.id, session)).toEqual({
    ...before,
    phase: 'submitted',
    transactionHash: HASH,
  });
});

test('a duplicate withdrawal acknowledgement preserves the retired attempt and its replacement', async () => {
  const f = await withdrawalFixture();
  await f.vault.recordWithdrawalSubmission(
    f.attempt,
    { transactionHash: HASH },
    f.session
  );
  const { noteId, poolId, ...previous } = (await f.vault.getWithdrawalAttempt(
    f.note.id,
    f.session
  ))!;
  expect(poolId).toBe(f.note.poolId);
  await seedArchiveVault(f, [
    {
      id: noteId,
      note: NOTE,
      createdAt: f.note.createdAt,
      withdrawal: {
        ...previous,
        recovery: {
          root: f.attempt.root,
          blockHash: HASH,
          blockNumber: '123',
          recoveredAt: 1,
        },
      },
    },
  ]);
  const next = {
    ...f.attempt,
    intentId: RECORD_ID,
    transaction: { ...f.attempt.transaction, nonce: '8' },
  };
  await f.vault.reserveWithdrawalAttempt(
    next,
    f.session,
    '00000000-0000-4000-8000-000000000099:0'
  );
  const beforeLateAck = await f.vault.getWithdrawalAttempt(
    f.note.id,
    f.session
  );
  const recordsBeforeLateAck = structuredClone(f.records);
  await expect(
    f.vault.recordWithdrawalSubmission(
      f.attempt,
      { transactionHash: HASH },
      f.session
    )
  ).resolves.toBeUndefined();
  expect(f.records).toEqual(recordsBeforeLateAck);
  expect(await f.vault.getWithdrawalAttempt(f.note.id, f.session)).toEqual(
    beforeLateAck
  );
  expect(beforeLateAck).toMatchObject({
    intentId: next.intentId,
    phase: 'unknown',
  });
  expect(beforeLateAck?.retired?.[0]).toMatchObject({
    intentId: f.attempt.intentId,
    phase: 'submitted',
    transactionHash: HASH,
    recovery: { root: f.attempt.root, blockHash: HASH, blockNumber: '123' },
  });
  expect(
    (await f.vault.getWithdrawalAttempt(f.note.id, f.session))?.retired
  ).toHaveLength(1);
});

test('a late withdrawal acknowledgement preserves the original attempt after note restore', async () => {
  const f = await withdrawalFixture();
  const entries = [
    { note: NOTE, createdAt: 1, reconciliationRequired: true as const },
  ];
  const plan = await f.vault.prepareRestore(entries, f.session);
  await f.vault.commitRestore(plan, entries, 'synthetic-password', f.session);
  await f.vault.recordWithdrawalSubmission(
    f.attempt,
    { transactionHash: HASH },
    f.session
  );
  expect(
    await f.vault.getWithdrawalAttempt(f.note.id, f.session)
  ).toMatchObject({
    phase: 'submitted',
    transactionHash: HASH,
  });
  expect((await f.vault.getNotes()).notes[0].restoration).toBe(
    'review-required'
  );
});

test('targeted note status reads only the selected protected note and refuses stale sessions', async () => {
  const f = fixture();
  const vault = core.createPrivateVaultController(f.host, f.dependencies);
  await vault.importNote(NOTE);
  const second = await vault.importNote(SECOND_NOTE);
  const session = f.host.captureSession();
  jest.mocked(f.host.readNote).mockClear();
  await expect(vault.readNoteStatus(second.id, session)).resolves.toEqual({
    phase: 'verified',
  });
  expect(f.host.readNote).toHaveBeenCalledTimes(1);
  expect(f.host.readNote).toHaveBeenCalledWith(
    identifyClassicNote(SECOND_NOTE)
  );
  await expect(
    vault.readNoteStatus('00000000-0000-4000-8000-000000009999', session)
  ).rejects.toThrow('privacy_note_missing');
  f.cycleSession();
  await expect(vault.readNoteStatus(second.id, session)).rejects.toThrow(
    'privacy_vault_session_changed'
  );
  expect(f.host.readNote).toHaveBeenCalledTimes(1);
});

test('unsigned deposit cleanup preserves a different exact retained attempt', async () => {
  const f = await depositFixture();
  const before = await f.vault.getDepositAttempt(f.note.id, f.session);
  await expect(
    f.vault.clearUnbroadcastDepositAttempt(
      {
        ...f.attempt,
        intentId: '00000000-0000-4000-8000-000000000099',
      },
      f.session
    )
  ).rejects.toThrow('privacy_deposit_attempt_invalid');
  expect(await f.vault.getDepositAttempt(f.note.id, f.session)).toEqual(before);
});

test('unsigned withdrawal cleanup preserves a different exact retained attempt', async () => {
  const f = await withdrawalFixture();
  const before = await f.vault.getWithdrawalAttempt(f.note.id, f.session);
  await expect(
    f.vault.clearUnbroadcastWithdrawalAttempt(
      {
        ...f.attempt,
        intentId: '00000000-0000-4000-8000-000000000099',
      },
      f.session
    )
  ).rejects.toThrow('privacy_withdrawal_attempt_invalid');
  expect(await f.vault.getWithdrawalAttempt(f.note.id, f.session)).toEqual(
    before
  );
});

const archivedTestNote = (index: number) =>
  `tornado-eth-1-1-0x${index.toString(16).padStart(124, '0')}`;
const archiveTestId = (index: number) =>
  `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
const completedArchiveNote = (note = NOTE, id = RECORD_ID): IStoredNote => ({
  id,
  note,
  createdAt: 100,
  withdrawal: {
    intentId: INTENT_ID,
    attemptHash: HASH,
    inputHash: HASH,
    proofHash: HASH,
    createdAt: 100,
    mode: 'relayed',
    phase: 'submitted',
    endpoint: 'https://relay.example',
    ensHash: HASH,
    transactionHash: HASH,
  },
});
async function seedArchiveVault(
  f: ReturnType<typeof fixture>,
  notes: IStoredNote[],
  capacity = 128
) {
  const active = notes.filter((note) => note.archivedAt === undefined);
  const archived = notes.filter((note) => note.archivedAt !== undefined);
  const groups: IStoredNote[][] = [];
  for (const partition of [active, archived])
    for (let offset = 0; offset < partition.length; offset += MAX_SHARD_NOTES)
      groups.push(partition.slice(offset, offset + MAX_SHARD_NOTES));
  if (!groups.length) groups.push([]);
  const shards = [],
    references = [];
  for (const [index, group] of groups.entries()) {
    const envelope = await f.keyring.encryptPrivateRecord({
      domain: PRIVATE_VAULT_SHARD_DOMAIN,
      recordId: archiveTestId(10000 + index),
      plaintext: new TextEncoder().encode(
        JSON.stringify({ version: 1, notes: group })
      ),
    });
    shards.push(envelope);
    references.push({
      recordId: envelope.recordId,
      hash: envelopeHash(envelope),
      count: group.length,
      ...(group[0]?.archivedAt === undefined
        ? {}
        : {
            archived: true as const,
            noteKeys: group.map((note) =>
              privateVaultNoteKey(f.dependencies.identify(note.note))
            ),
          }),
    });
  }
  const root = await f.keyring.encryptPrivateRecord({
    domain: core.PRIVATE_VAULT_DOMAIN,
    recordId: archiveTestId(9999),
    plaintext: new TextEncoder().encode(
      JSON.stringify({
        format: core.PRIVATE_VAULT_FORMAT,
        version: 1,
        capacity,
        noteCount: active.length,
        ...(archived.length ? { archiveCount: archived.length } : {}),
        shards: references,
        restore: { version: 1 },
      })
    ),
  });
  const bundle = {
    format: core.PRIVATE_VAULT_FORMAT,
    version: 1,
    root,
    shards,
  };
  f.records[core.PRIVATE_VAULT_STORAGE_PREFIX + root.profileId] = bundle;
  return {
    bundle,
    archiveIds: new Set(
      references.filter((ref) => ref.archived).map((ref) => ref.recordId)
    ),
  };
}

test('a false completed/spent proof archives the last secret durably without changing its recovery evidence', async () => {
  const f = fixture();
  const note = completedArchiveNote();
  await seedArchiveVault(f, [note]);
  const vault = core.createPrivateVaultController(f.host, f.dependencies);
  expect(await vault.clearCompletedNotes([note.id])).toEqual({
    removed: [note.id],
    unresolved: [],
  });
  expect(await vault.getNotes()).toEqual({ notes: [] });
  jest.mocked(f.host.readNote).mockClear();
  const archive = await vault.getArchivedNotes();
  expect(archive).toMatchObject({
    limit: 512,
    bundleLimitBytes: 4194304,
    notes: [{ id: note.id, archivedAt: 456 }],
  });
  expect(JSON.stringify(archive)).not.toContain(NOTE);
  expect(f.host.readNote).not.toHaveBeenCalled();
  const reopened = core.createPrivateVaultController(f.host, f.dependencies);
  expect(await reopened.revealNote(note.id, 'synthetic-password')).toBe(NOTE);
  const backup = await reopened.exportBackupSnapshot(
    'synthetic-password',
    f.host.captureSession()
  );
  expect(backup.notes[0]).toMatchObject({
    note: NOTE,
    archivedAt: 456,
    history: { withdrawals: [{ transactionHash: HASH }] },
  });
  expect(await reopened.getCapacity()).toMatchObject({
    capacity: 128,
    noteCount: 0,
  });
});

test('archive storage failure or ambiguous acknowledgement preserves a recoverable secret after restart', async () => {
  for (const acknowledged of [false, true]) {
    const f = fixture();
    const note = completedArchiveNote();
    await seedArchiveVault(f, [note]);
    const write = f.storage.setItem.getMockImplementation()!;
    f.storage.setItem.mockImplementationOnce(async (key, value) => {
      if (acknowledged) await write(key, value);
      throw new Error('Storage full or acknowledgement lost');
    });
    const vault = core.createPrivateVaultController(f.host, f.dependencies);
    await expect(vault.clearCompletedNotes([note.id])).rejects.toThrow(
      'privacy_vault_unavailable'
    );
    const reopened = core.createPrivateVaultController(f.host, f.dependencies);
    expect(await reopened.revealNote(note.id, 'synthetic-password')).toBe(NOTE);
    const archived = (await reopened.getArchivedNotes()).notes;
    expect(archived).toHaveLength(acknowledged ? 1 : 0);
  }
});

test('archive restore and permanent clear require authentication, preserve active notes and do no chain work', async () => {
  const f = fixture();
  const archived = { ...completedArchiveNote(), archivedAt: 200 };
  const active = { id: INTENT_ID, note: SECOND_NOTE, createdAt: 100 };
  await seedArchiveVault(f, [active, archived]);
  const vault = core.createPrivateVaultController(f.host, f.dependencies);
  const before = structuredClone(f.records);
  await expect(vault.restoreArchivedNote(archived.id, 'wrong')).rejects.toThrow(
    'Invalid password'
  );
  await expect(vault.clearArchive('wrong')).rejects.toThrow('Invalid password');
  expect(f.records).toEqual(before);
  expect(f.host.readNote).not.toHaveBeenCalled();
  await vault.restoreArchivedNote(archived.id, 'synthetic-password');
  expect((await vault.getArchivedNotes()).notes).toEqual([]);
  expect(await vault.revealNote(archived.id, 'synthetic-password')).toBe(NOTE);
  expect(
    (await vault.getNotes()).notes.find((note) => note.id === archived.id)
  ).toMatchObject({ phase: 'verified', withdrawal: { phase: 'submitted' } });
  await vault.clearCompletedNotes([archived.id]);
  jest.mocked(f.host.readNote).mockClear();
  expect(await vault.clearArchive('synthetic-password')).toEqual({
    removed: 1,
  });
  expect(f.host.readNote).not.toHaveBeenCalled();
  expect(await vault.revealNote(active.id, 'synthetic-password')).toBe(
    SECOND_NOTE
  );
  await expect(
    vault.revealNote(archived.id, 'synthetic-password')
  ).rejects.toThrow('privacy_note_missing');
});

test('full archive stays outside active quotas and ordinary inventory/append never decrypt, identify or query its notes', async () => {
  const f = fixture();
  const archived = Array.from({ length: 512 }, (_, index) => ({
    id: archiveTestId(index + 100000),
    note: archivedTestNote(index + 100000),
    createdAt: 100,
    archivedAt: 200,
  }));
  const identify = jest.fn((raw: string) => ({
    poolId: 'eth-1' as const,
    commitment: keccak256(toUtf8Bytes(raw)),
    nullifierHash: HASH,
  }));
  f.dependencies.identify = identify;
  const { bundle, archiveIds } = await seedArchiveVault(f, [
    { id: RECORD_ID, note: NOTE, createdAt: 100 },
    ...archived,
  ]);
  const originalArchives = bundle.shards.filter((shard) =>
    archiveIds.has(shard.recordId)
  );
  const decrypt = jest.spyOn(f.keyring, 'decryptPrivateRecord');
  identify.mockClear();
  const vault = core.createPrivateVaultController(f.host, f.dependencies);
  expect(await vault.getNotes(true)).toMatchObject({
    notes: [{ id: RECORD_ID }],
    archiveSummary: { noteCount: 512, limit: 512 },
  });
  expect(identify.mock.calls.map(([raw]) => raw)).toEqual([NOTE]);
  expect(
    decrypt.mock.calls.filter(([request]) => archiveIds.has(request.recordId))
  ).toHaveLength(0);
  expect(f.host.readNote).toHaveBeenCalledTimes(1);
  identify.mockClear();
  decrypt.mockClear();
  jest.mocked(f.host.readNote).mockClear();
  await vault.importNote(SECOND_NOTE);
  expect(
    identify.mock.calls.every(([raw]) => raw === NOTE || raw === SECOND_NOTE)
  ).toBe(true);
  expect(
    decrypt.mock.calls.filter(([request]) => archiveIds.has(request.recordId))
  ).toHaveLength(0);
  expect(
    jest
      .mocked(f.host.readNote)
      .mock.calls.every(
        ([identity]) =>
          identity.commitment === keccak256(toUtf8Bytes(SECOND_NOTE))
      )
  ).toBe(true);
  const stored = Object.values(f.records)[0] as typeof bundle;
  expect(
    stored.shards.filter((shard) => archiveIds.has(shard.recordId))
  ).toEqual(originalArchives);
  expect(await vault.getCapacity()).toMatchObject({
    capacity: 128,
    noteCount: 2,
  });
  const before = structuredClone(f.records);
  decrypt.mockClear();
  jest.mocked(f.host.readNote).mockClear();
  await expect(vault.importNote(archived[0]!.note)).rejects.toThrow(
    'privacy_note_archived'
  );
  expect(f.records).toEqual(before);
  expect(
    decrypt.mock.calls.filter(([request]) => archiveIds.has(request.recordId))
  ).toHaveLength(0);
  expect(f.host.readNote).not.toHaveBeenCalled();
});

test('an archive at its count limit preserves both the completed active note and every archived secret', async () => {
  const f = fixture();
  f.dependencies.identify = (raw) => ({
    poolId: 'eth-1',
    commitment: keccak256(toUtf8Bytes(raw)),
    nullifierHash: HASH,
  });
  const archived = Array.from({ length: 512 }, (_, index) => ({
    id: archiveTestId(index + 100000),
    note: archivedTestNote(index + 100000),
    createdAt: 100,
    archivedAt: 200,
  }));
  await seedArchiveVault(f, [completedArchiveNote(), ...archived]);
  const before = structuredClone(f.records);
  const vault = core.createPrivateVaultController(f.host, f.dependencies);
  await expect(vault.clearCompletedNotes([RECORD_ID])).rejects.toThrow(
    'privacy_archive_limit'
  );
  expect(f.storage.setItem).not.toHaveBeenCalled();
  expect(f.records).toEqual(before);
  expect(await vault.getCapacity()).toMatchObject({ noteCount: 1 });
});

test('encrypted note backup restoration retains archive location, bearer secret and inert withdrawal evidence', async () => {
  const source = fixture();
  await seedArchiveVault(source, [
    { ...completedArchiveNote(), archivedAt: 200 },
  ]);
  const from = core.createPrivateVaultController(
    source.host,
    source.dependencies
  );
  const exported = await from.exportBackupSnapshot(
    'synthetic-password',
    source.host.captureSession()
  );
  const target = fixture();
  const to = core.createPrivateVaultController(
    target.host,
    target.dependencies
  );
  const owner = target.host.captureSession();
  const plan = await to.prepareRestore(exported.notes, owner);
  await to.commitRestore(plan, exported.notes, 'synthetic-password', owner);
  expect(await to.getNotes()).toEqual({ notes: [] });
  expect(await to.getCapacity()).toMatchObject({ noteCount: 0 });
  const inventory = await to.getArchivedNotes();
  expect(inventory.notes).toHaveLength(1);
  expect(
    await to.revealNote(inventory.notes[0]!.id, 'synthetic-password')
  ).toBe(NOTE);
  const again = await to.exportBackupSnapshot(
    'synthetic-password',
    target.host.captureSession()
  );
  expect(again.notes[0]).toMatchObject({
    note: NOTE,
    archivedAt: 200,
    reconciliationRequired: true,
    history: { withdrawals: [{ transactionHash: HASH }] },
  });
});

test('maximum restore metadata, full active capacity and a full archive fit the unchanged SDK root bound', async () => {
  const f = fixture();
  f.dependencies.identify = (raw) => ({
    poolId: 'eth-1',
    commitment: keccak256(toUtf8Bytes(raw)),
    nullifierHash: HASH,
  });
  const archived = Array.from({ length: 512 }, (_, index) => ({
    id: archiveTestId(index + 100000),
    note: archivedTestNote(index + 100000),
    createdAt: 100,
    archivedAt: 200,
  }));
  const active = Array.from({ length: 511 }, (_, index) => ({
    id: archiveTestId(index + 200000),
    note: archivedTestNote(index + 200000),
    createdAt: 100,
  }));
  const { bundle, archiveIds } = await seedArchiveVault(
    f,
    [...active, ...archived],
    512
  );
  const rootPlain = await f.keyring.decryptPrivateRecord({
    domain: core.PRIVATE_VAULT_DOMAIN,
    recordId: bundle.root.recordId,
    envelope: bundle.root,
  });
  const root = JSON.parse(new TextDecoder().decode(rootPlain));
  rootPlain.fill(0);
  root.restore = {
    version: 1,
    receipt: {
      id: INTENT_ID,
      sourceHash: HASH,
      createdAt: 8640000000000000,
      added: 1024,
      duplicates: 0,
      guarded: 1024,
    },
  };
  bundle.root = await f.keyring.encryptPrivateRecord({
    domain: core.PRIVATE_VAULT_DOMAIN,
    recordId: bundle.root.recordId,
    plaintext: new TextEncoder().encode(JSON.stringify(root)),
  });
  f.records[core.PRIVATE_VAULT_STORAGE_PREFIX + bundle.root.profileId] = bundle;
  const vault = core.createPrivateVaultController(f.host, f.dependencies);
  const beforeArchives = bundle.shards.filter((shard) =>
    archiveIds.has(shard.recordId)
  );
  const decrypt = jest.spyOn(f.keyring, 'decryptPrivateRecord');
  await vault.importNote(SECOND_NOTE);
  expect(
    decrypt.mock.calls.filter(([request]) => archiveIds.has(request.recordId))
  ).toHaveLength(0);
  expect(await vault.getCapacity()).toMatchObject({
    capacity: 512,
    noteCount: 512,
  });
  const written = Object.values(f.records)[0] as typeof bundle;
  expect(
    written.shards.filter((shard) => archiveIds.has(shard.recordId))
  ).toEqual(beforeArchives);
  const plaintext = await f.keyring.decryptPrivateRecord({
    domain: core.PRIVATE_VAULT_DOMAIN,
    recordId: written.root.recordId,
    envelope: written.root,
  });
  expect(plaintext.length).toBeLessThanOrEqual(65536);
  plaintext.fill(0);
});

test('the unchanged combined 16MiB ceiling rejects a 20MiB bundle before decrypting or mutating existing secrets', async () => {
  const f = fixture();
  const { bundle } = await seedArchiveVault(f, [
    { id: RECORD_ID, note: NOTE, createdAt: 100 },
  ]);
  const before = structuredClone(f.records);
  const ciphertext = 'A'.repeat(Math.ceil((32 * 1024 + 16) / 3) * 4);
  const oversized = {
    ...bundle,
    shards: Array.from({ length: 480 }, (_, index) => ({
      ...bundle.shards[0]!,
      recordId: archiveTestId(300000 + index),
      ciphertext,
    })),
  };
  expect(
    new TextEncoder().encode(JSON.stringify(oversized)).length
  ).toBeGreaterThan(20 * 1024 * 1024);
  f.storage.getItem.mockResolvedValueOnce(oversized);
  const decrypt = jest.spyOn(f.keyring, 'decryptPrivateRecord');
  const vault = core.createPrivateVaultController(f.host, f.dependencies);
  await expect(vault.importNote(SECOND_NOTE)).rejects.toThrow(
    'privacy_vault_corrupt'
  );
  expect(decrypt).not.toHaveBeenCalled();
  expect(f.storage.setItem).not.toHaveBeenCalled();
  expect(f.records).toEqual(before);
  expect(await vault.revealNote(RECORD_ID, 'synthetic-password')).toBe(NOTE);
});
