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
jest.unmock('tiny-secp256k1');
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
        if (generation !== captured)
          throw new Error('privacy_vault_session_changed');
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
    cycleSession: () => {
      generation += 2;
    },
  };
}

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
