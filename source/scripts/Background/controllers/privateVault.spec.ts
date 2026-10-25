import { KeyringManager } from '@sidhujag/sysweb3-keyring';
import { webcrypto } from 'crypto';

import { AsyncMutex } from 'utils/asyncMutex';
import { identifyClassicNote } from 'utils/privacy/note';
import type { IPrivateNoteStatus } from 'utils/privacy/privateVaultTypes';

import {
  createPrivateVaultController,
  IPrivateVaultSession,
  PRIVATE_VAULT_DOMAIN,
  PRIVATE_VAULT_STORAGE_PREFIX,
} from './privateVault';

jest.unmock('syscoinjs-lib');
jest.unmock('tiny-secp256k1');
jest.mock('@trezor/connect-webextension', () => ({}));

// Synthetic roots and notes only. The released SDK's actual AEAD methods run;
// replacing the private root accessor avoids wallet storage, hardware and RPC.
const ROOT = 'synthetic private vault test root';
const NOTE = `tornado-eth-1-1-0x${'01'.repeat(62)}`;
const SECOND_NOTE = `tornado-eth-1-1-0x${'02'.repeat(62)}`;
const UUID = '00000000-0000-4000-8000-000000000001';
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

function fakeUnlockedKeyring(root = ROOT) {
  const keyring: any = Object.create(KeyringManager.prototype);
  keyring.sessionPassword = { isCleared: () => false };
  keyring.sessionMnemonic = { isCleared: () => false };
  keyring.privateRecordSessionRevision = 0;
  keyring.getDecryptedMnemonic = () => root;
  return keyring as KeyringManager;
}

function fixture() {
  const records: Record<string, any> = {};
  const mutex = new AsyncMutex();
  let keyring = fakeUnlockedKeyring();
  let generation = 0;
  let unlocked = true;
  let status: IPrivateNoteStatus = { phase: 'verified', blockNumber: 123 };
  const storage = {
    getItem: jest.fn(async (key: string) =>
      records[key] ? structuredClone(records[key]) : null
    ),
    setItem: jest.fn(async (key: string, value: unknown) => {
      records[key] = structuredClone(value);
    }),
  };
  const captureSession = (): IPrivateVaultSession => {
    if (!unlocked) throw new Error('privacy_vault_locked');
    const capturedKeyring = keyring;
    const capturedGeneration = generation;
    return {
      keyring,
      generation,
      assertCurrent: () => {
        if (
          !unlocked ||
          generation !== capturedGeneration ||
          keyring !== capturedKeyring
        )
          throw new Error('privacy_vault_session_changed');
      },
    };
  };
  const authenticate = jest.fn(
    async (
      password: string,
      session: IPrivateVaultSession,
      reveal: () => Promise<string>
    ) => {
      session.assertCurrent();
      if (password !== 'correct-password') throw new Error('Invalid password');
      const result = await reveal();
      session.assertCurrent();
      return result;
    }
  );
  const readNote = jest.fn(async () => status);
  const create = () =>
    createPrivateVaultController(
      { captureSession, authenticate, readNote },
      { storage, mutex, now: () => 456 }
    );
  const controller = create();
  return {
    controller,
    create,
    records,
    storage,
    mutex,
    authenticate,
    readNote,
    captureSession,
    setStatus: (value: IPrivateNoteStatus) => {
      status = value;
    },
    getKeyring: () => keyring,
    replaceKeyring: (root = ROOT) => {
      keyring = fakeUnlockedKeyring(root);
      generation++;
    },
    lock: () => {
      unlocked = false;
      generation++;
    },
    unlock: () => {
      unlocked = true;
    },
  };
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
});
afterAll(() => {
  if (originalCrypto)
    Object.defineProperty(globalThis, 'crypto', originalCrypto);
});

it('persists only an encrypted manifest and returns strict display metadata', async () => {
  const f = fixture();
  const item = await f.controller.importNote(NOTE);
  expect(item).toEqual({
    id: expect.any(String),
    poolId: 'eth-1',
    amount: '1',
    createdAt: 456,
    phase: 'verified',
    blockNumber: 123,
  });
  expect(item.id).toHaveLength(36);
  expect(Object.keys(f.records)).toEqual([
    PRIVATE_VAULT_STORAGE_PREFIX +
      (await f.getKeyring().getPrivateRecordProfileId()),
  ]);
  const saved = JSON.stringify(f.records);
  const identity = identifyClassicNote(NOTE);
  for (const secret of [
    ROOT,
    NOTE,
    item.id,
    identity.commitment,
    identity.nullifierHash,
    'eth-1',
  ])
    expect(saved).not.toContain(secret);
  const envelope = Object.values(f.records)[0];
  expect(Object.keys(envelope).sort()).toEqual([
    'ciphertext',
    'domain',
    'nonce',
    'profileId',
    'recordId',
    'version',
  ]);
  expect(envelope.domain).toBe(PRIVATE_VAULT_DOMAIN);
  expect(await f.controller.getNotes()).toEqual({ notes: [item] });
  expect(f.authenticate).not.toHaveBeenCalled();
});

it('serializes concurrent duplicate imports and survives a controller restart', async () => {
  const f = fixture();
  const [first, second] = await Promise.all([
    f.controller.importNote(NOTE),
    f.controller.importNote(` \n${NOTE}\n`),
  ]);
  expect(first).toEqual(second);
  expect(f.storage.setItem).toHaveBeenCalledTimes(1);
  expect((await f.create().getNotes()).notes).toEqual([first]);
  expect(await f.create().revealNote(first.id, 'correct-password')).toBe(NOTE);
});

it('refreshes spent state from the local reader without changing encrypted custody', async () => {
  const f = fixture();
  const first = await f.controller.importNote(NOTE);
  f.setStatus({ phase: 'spent', blockNumber: 987 });
  expect(await f.controller.getNotes()).toEqual({
    notes: [{ ...first, phase: 'spent', blockNumber: 987 }],
  });
  expect(await f.controller.importNote(NOTE)).toEqual({
    ...first,
    phase: 'spent',
    blockNumber: 987,
  });
  expect(f.storage.setItem).toHaveBeenCalledTimes(1);
});

it.each([
  ['waiting', 'privacy_verification_pending'],
  ['not-found', 'privacy_note_not_found'],
] as const)('does not persist a %s note', async (phase, error) => {
  const f = fixture();
  f.setStatus({ phase });
  await expect(f.controller.importNote(NOTE)).rejects.toThrow(error);
  expect(f.storage.setItem).not.toHaveBeenCalled();
});

it('admits locally verified spent notes as history', async () => {
  const f = fixture();
  f.setStatus({ phase: 'spent' });
  expect((await f.controller.importNote(NOTE)).phase).toBe('spent');
});

it('isolates root profiles, and permits a replacement keyring with the same root', async () => {
  const f = fixture();
  const first = await f.controller.importNote(NOTE);
  f.replaceKeyring();
  expect((await f.controller.getNotes()).notes).toEqual([first]);
  f.replaceKeyring('different synthetic root');
  expect((await f.controller.getNotes()).notes).toEqual([]);
  await f.controller.importNote(SECOND_NOTE);
  expect(Object.keys(f.records)).toHaveLength(2);
  f.replaceKeyring();
  expect((await f.controller.getNotes()).notes).toEqual([first]);
});

it('rejects an envelope copied to the wrong profile without overwriting it', async () => {
  const f = fixture();
  await f.controller.importNote(NOTE);
  const original = Object.values(f.records)[0];
  f.replaceKeyring('different synthetic root');
  const key =
    PRIVATE_VAULT_STORAGE_PREFIX +
    (await f.getKeyring().getPrivateRecordProfileId());
  f.records[key] = structuredClone(original);
  await expect(f.controller.getNotes()).rejects.toThrow(
    'privacy_vault_corrupt'
  );
  expect(f.records[key]).toEqual(original);
});

it('returns raw notes only after successful reauthentication', async () => {
  const f = fixture();
  const item = await f.controller.importNote(NOTE);
  await expect(
    f.controller.revealNote(item.id, 'wrong-password')
  ).rejects.toThrow('Invalid password');
  expect(await f.controller.revealNote(item.id, 'correct-password')).toBe(NOTE);
  expect(f.authenticate).toHaveBeenCalledTimes(2);
  await expect(
    f.controller.revealNote(UUID, 'correct-password')
  ).rejects.toThrow('privacy_note_missing');
});

it('does not release a reveal after the authentication callback loses its session', async () => {
  const f = fixture();
  const item = await f.controller.importNote(NOTE);
  f.authenticate.mockImplementationOnce(async (_password, _session, reveal) => {
    const note = await reveal();
    f.lock();
    return note;
  });
  await expect(
    f.controller.revealNote(item.id, 'correct-password')
  ).rejects.toThrow('privacy_vault_session_changed');
});

it('keeps ciphertext and returns only a static error on decryption failure', async () => {
  const f = fixture();
  await f.controller.importNote(NOTE);
  const key = Object.keys(f.records)[0];
  f.records[key].ciphertext = f.records[key].ciphertext.slice(0, -4) + 'AAAA';
  const damaged = structuredClone(f.records[key]);
  await expect(f.controller.getNotes()).rejects.toThrow(
    /^privacy_vault_unavailable$/
  );
  expect(f.records[key]).toEqual(damaged);
});

it('suppresses malformed plaintext from JSON parser errors', async () => {
  const f = fixture();
  const keyring = f.getKeyring();
  const envelope = await keyring.encryptPrivateRecord({
    domain: PRIVATE_VAULT_DOMAIN,
    recordId: UUID,
    plaintext: new TextEncoder().encode(`{"${NOTE}`),
  });
  f.records[PRIVATE_VAULT_STORAGE_PREFIX + envelope.profileId] = envelope;
  await expect(f.controller.getNotes()).rejects.toThrow(
    /^privacy_vault_corrupt$/
  );
});

it('does not acknowledge a failed save and permits a safe retry', async () => {
  const f = fixture();
  f.storage.setItem.mockRejectedValueOnce(new Error(NOTE));
  await expect(f.controller.importNote(NOTE)).rejects.toThrow(
    /^privacy_vault_unavailable$/
  );
  expect(Object.keys(f.records)).toHaveLength(0);
  expect((await f.controller.importNote(NOTE)).phase).toBe('verified');
});

it('deduplicates a retry when storage applied a write before reporting failure', async () => {
  const f = fixture();
  f.storage.setItem.mockImplementationOnce(async (key, value) => {
    f.records[key] = structuredClone(value);
    throw new Error('unknown write outcome');
  });
  await expect(f.controller.importNote(NOTE)).rejects.toThrow(
    'privacy_vault_unavailable'
  );
  const recovered = await f.controller.importNote(NOTE);
  expect((await f.controller.getNotes()).notes).toEqual([recovered]);
  expect(f.storage.setItem).toHaveBeenCalledTimes(1);
});

it.each(['lock', 'replace'] as const)(
  'rejects a %s during a durable save',
  async (change) => {
    const f = fixture();
    const entered = deferred();
    const release = deferred();
    f.storage.setItem.mockImplementationOnce(async (key, value) => {
      entered.resolve();
      await release.promise;
      f.records[key] = structuredClone(value);
    });
    const result = f.controller.importNote(NOTE);
    const failure = expect(result).rejects.toThrow(
      'privacy_vault_session_changed'
    );
    await entered.promise;
    if (change === 'lock') f.lock();
    else f.replaceKeyring();
    release.resolve();
    await failure;
    expect(JSON.stringify(f.records)).not.toContain(NOTE);
  }
);

it('lets a serialized reset remove an in-flight save without resurrection', async () => {
  const f = fixture();
  const entered = deferred();
  const release = deferred();
  f.storage.setItem.mockImplementationOnce(async (key, value) => {
    entered.resolve();
    await release.promise;
    f.records[key] = structuredClone(value);
  });
  const result = f.controller.importNote(NOTE);
  const failure = expect(result).rejects.toThrow(
    'privacy_vault_session_changed'
  );
  await entered.promise;
  f.lock();
  const reset = f.mutex.runExclusive(async () => {
    for (const key of Object.keys(f.records))
      if (key.startsWith('state-')) delete f.records[key];
  });
  release.resolve();
  await failure;
  await reset;
  expect(f.records).toEqual({});
});

it('clears decrypted byte buffers even when the post-decryption session check rejects', async () => {
  const f = fixture();
  await f.controller.importNote(NOTE);
  const keyring = f.getKeyring();
  const decrypt = keyring.decryptPrivateRecord.bind(keyring);
  let bytes!: Uint8Array;
  jest
    .spyOn(keyring, 'decryptPrivateRecord')
    .mockImplementationOnce(async (params) => {
      bytes = await decrypt(params);
      f.lock();
      return bytes;
    });
  await expect(f.controller.getNotes()).rejects.toThrow(
    'privacy_vault_session_changed'
  );
  expect(bytes.every((byte) => byte === 0)).toBe(true);
});

it('does not query custody for invalid notes or use network globals', async () => {
  const f = fixture();
  const fetchSpy = jest
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('network prohibited'));
  try {
    await expect(f.controller.importNote('invalid')).rejects.toThrow(
      'privacy_note_invalid'
    );
    expect(f.storage.getItem).not.toHaveBeenCalled();
    await f.controller.importNote(NOTE);
    await f.controller.getNotes();
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    fetchSpy.mockRestore();
  }
});

it.each([
  ['clear', 'waiting', 'privacy_verification_pending'],
  ['expired verification', 'waiting', 'privacy_verification_pending'],
  ['changed verified snapshot', 'not-found', 'privacy_note_not_found'],
] as const)(
  'rechecks admission after encryption during %s',
  async (_change, phase, error) => {
    const f = fixture();
    const entered = deferred();
    const release = deferred();
    const keyring = f.getKeyring();
    const encrypt = keyring.encryptPrivateRecord.bind(keyring);
    jest
      .spyOn(keyring, 'encryptPrivateRecord')
      .mockImplementationOnce(async (params) => {
        const envelope = await encrypt(params);
        entered.resolve();
        await release.promise;
        return envelope;
      });
    const result = f.controller.importNote(NOTE);
    const failure = expect(result).rejects.toThrow(error);
    await entered.promise;
    f.setStatus({ phase });
    release.resolve();
    await failure;
    expect(f.storage.setItem).not.toHaveBeenCalled();
  }
);

it('uses a spent result published while encryption was running', async () => {
  const f = fixture();
  const keyring = f.getKeyring();
  const encrypt = keyring.encryptPrivateRecord.bind(keyring);
  jest
    .spyOn(keyring, 'encryptPrivateRecord')
    .mockImplementationOnce(async (params) => {
      const envelope = await encrypt(params);
      f.setStatus({ phase: 'spent', blockNumber: 234 });
      return envelope;
    });
  expect(await f.controller.importNote(NOTE)).toMatchObject({
    phase: 'spent',
    blockNumber: 234,
  });
});

it.each(['waiting', 'spent'] as const)(
  'preserves a saved note and reports %s when the public view changes during storage',
  async (phase) => {
    const f = fixture();
    f.storage.setItem.mockImplementationOnce(async (key, value) => {
      f.records[key] = structuredClone(value);
      f.setStatus({ phase });
    });
    const item = await f.controller.importNote(NOTE);
    expect(item.phase).toBe(phase);
    expect(await f.controller.revealNote(item.id, 'correct-password')).toBe(
      NOTE
    );
  }
);

it('rejects a failed storage read without exposing its error text', async () => {
  const f = fixture();
  f.storage.getItem.mockRejectedValueOnce(new Error(NOTE));
  await expect(f.controller.getNotes()).rejects.toThrow(
    /^privacy_vault_unavailable$/
  );
});

it.each([
  { notes: [], version: 2 },
  {
    notes: Array(129).fill({ id: UUID, note: NOTE, createdAt: 123 }),
    version: 1,
  },
  { notes: [{ id: UUID, note: NOTE, createdAt: -1 }], version: 1 },
  {
    notes: [
      { id: UUID, note: NOTE, createdAt: 123 },
      { id: UUID, note: SECOND_NOTE, createdAt: 123 },
    ],
    version: 1,
  },
])('rejects invalid encrypted manifest schema %#', async (manifest) => {
  const f = fixture();
  const keyring = f.getKeyring();
  const envelope = await keyring.encryptPrivateRecord({
    domain: PRIVATE_VAULT_DOMAIN,
    recordId: UUID,
    plaintext: new TextEncoder().encode(JSON.stringify(manifest)),
  });
  f.records[PRIVATE_VAULT_STORAGE_PREFIX + envelope.profileId] = envelope;
  await expect(f.controller.getNotes()).rejects.toThrow(
    /^privacy_vault_corrupt$/
  );
});
