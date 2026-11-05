import { KeyringManager } from '@sidhujag/sysweb3-keyring';
import { webcrypto } from 'crypto';
import { keccak256, toUtf8Bytes } from 'ethers';

import { createPrivateVaultController as createExtensionVault } from '../scripts/Background/controllers/privateVault';
import { AsyncMutex, walletPersistenceMutex } from '../utils/asyncMutex';
import {
  generateClassicNote,
  identifyClassicNote,
} from '../utils/privacy/note';
import { chromeStorage } from '../utils/storageAPI';

import * as core from './privateVault';
import type {
  IPrivateVaultDependencies,
  IPrivateVaultHost,
  IPrivateVaultSession,
} from './privateVault';

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
  const storage = {
    getItem: jest.fn(async (key: string) =>
      records[key] === undefined ? null : structuredClone(records[key])
    ),
    setItem: jest.fn(async (key: string, value: unknown) => {
      records[key] = structuredClone(value);
    }),
  };
  const captureSession = (): IPrivateVaultSession => {
    const captured = generation;
    return {
      keyring,
      generation: captured,
      assertCurrent: () => {
        if (generation !== captured) throw new Error(sessionError);
      },
    };
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
    now: () => 456,
    deadlineNow: () => elapsed,
    randomId: () =>
      `00000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`,
  };
  return {
    host,
    dependencies,
    storage,
    records,
    keyring: keyring as KeyringManager,
    revalidate,
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
      captureSession: () => ({
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
      session.assertCurrent = guard;
      run =
        operation === 'prepare'
          ? vault.prepareRestore(entries, session)
          : vault.getRestoreReceipt(session);
    } else {
      const plan = await vault.prepareRestore(entries, admitted);
      f.storage.getItem.mockClear();
      (operation === 'commit plan' ? admitted : session).assertCurrent = guard;
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
  stale.assertCurrent = guard;
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
      session.assertCurrent = guard;
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
