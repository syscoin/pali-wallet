import { webcrypto } from 'crypto';

import { walletPersistenceGate } from 'state/paliStorage';
import { walletPersistenceMutex } from 'utils/asyncMutex';
import {
  SLH_DSA_PARAMETER_SET,
  SLH_DSA_SIGNATURE_LIMIT,
  getSLHDSAKeyId,
  getSLHDSAStateStorageKey,
} from 'utils/slhDsa/constants';
import { signSLHDSAInOffscreen } from 'utils/slhDsa/offscreenClient';
import {
  clearRuntimeSLHDSAStates,
  configureSLHDSASessionStateCrypto,
  registerRuntimeSLHDSAState,
  signSLHDSAActionHashLocal,
} from 'utils/slhDsa/signer';
import {
  createSLHDSAProvisionedState,
  loadEncryptedSLHDSAState,
  saveEncryptedSLHDSAState,
} from 'utils/slhDsa/state';
import { chromeStorage } from 'utils/storageAPI';

import {
  createSlhDsaProfileStateCrypto,
  SLH_DSA_PROFILE_STATE_DOMAIN,
  SLH_DSA_PROFILE_STATE_MAX_BYTES,
} from './slhDsaStateCrypto';

jest.mock('utils/slhDsa/offscreenClient', () => ({
  prepareSLHDSAKeypairInOffscreen: jest.fn(),
  signSLHDSAInOffscreen: jest.fn(),
}));
const mockStorage = new Map<string, unknown>();
jest.mock('utils/storageAPI', () => ({
  chromeStorage: {
    getItems: jest.fn(async (keys: string[]) =>
      Object.fromEntries(
        keys
          .filter((key) => mockStorage.has(key))
          .map((key) => [key, mockStorage.get(key)])
      )
    ),
    setItem: jest.fn(async (key: string, value: unknown) => {
      mockStorage.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStorage.delete(key);
    }),
  },
}));

const { SoftwareKeyring, createKeyringHost } = jest.requireActual(
  '@sidhujag/sysweb3-keyring/cjs/software.js'
);
const PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const OTHER =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';
const password = 'Public SLH profile fixture 1!';
const pair = {
  pkRoot: `0x${'11'.repeat(16)}${'00'.repeat(16)}`,
  pkSeed: `0x${'22'.repeat(16)}${'00'.repeat(16)}`,
  secretKeyHex: `0x${'33'.repeat(64)}`,
};
const keyId = getSLHDSAKeyId(pair),
  storageKey = getSLHDSAStateStorageKey(keyId);
const signParams = {
  keyId,
  pkRoot: pair.pkRoot,
  pkSeed: pair.pkSeed,
  parameterSet: SLH_DSA_PARAMETER_SET,
  actionHash: `0x${'44'.repeat(32)}`,
};
const signResult = `0x${'55'.repeat(3856)}`;
const keyrings: any[] = [];
const state = (signatureCount = 7) => ({
  ...createSLHDSAProvisionedState({
    ...pair,
    keyId,
    accountIndex: 9,
    derivationLabel: 'PALI/SLH/account/9',
  }),
  signatureCount,
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
async function fixture(phrase = PHRASE, pwd = password) {
  const values = new Map<string, unknown>();
  const storage = {
    async get(key: string) {
      return values.get(key);
    },
    async set(key: string, value: unknown) {
      values.set(key, value);
    },
    async deleteItem(key: string) {
      values.delete(key);
    },
    async createManyIfAbsent(entries: Record<string, unknown>) {
      if (Object.keys(entries).some((key) => values.has(key))) return false;
      Object.entries(entries).forEach(([key, value]) => values.set(key, value));
      return true;
    },
  };
  const keyring = new SoftwareKeyring(createKeyringHost(storage), {
    captureEvmSubmission: null,
  });
  keyrings.push(keyring);
  keyring.setVaultStateGetter(() => ({
    activeAccount: { id: 0, type: 'HDAccount' },
    activeNetwork: {
      kind: 'ethereum',
      chainId: 1,
      slip44: 60,
      currency: 'ETH',
      url: 'https://offline.invalid',
    },
    accounts: {
      HDAccount: {},
      Imported: {},
      Ledger: {},
      Trezor: {},
      SmartAccount: {},
    },
  }));
  await keyring.initializeSession(phrase, pwd);
  let active = true;
  const guard = () => {
    if (!active) throw Error('fixture session changed');
  };
  return {
    keyring,
    guard,
    crypto: createSlhDsaProfileStateCrypto(keyring, guard),
    revoke() {
      active = false;
    },
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
  walletPersistenceGate.blocked = false;
  clearRuntimeSLHDSAStates();
  mockStorage.clear();
  jest.clearAllMocks();
  jest
    .mocked(chromeStorage.getItems)
    .mockImplementation(async (keys) =>
      Object.fromEntries(
        keys
          .filter((key) => mockStorage.has(key))
          .map((key) => [key, mockStorage.get(key)])
      )
    );
  jest.mocked(chromeStorage.setItem).mockImplementation(async (key, value) => {
    mockStorage.set(key, value);
  });
  jest.mocked(signSLHDSAInOffscreen).mockResolvedValue(signResult);
});
afterEach(async () => {
  clearRuntimeSLHDSAStates();
  walletPersistenceGate.blocked = false;
  for (const keyring of keyrings.splice(0)) await keyring.destroy();
});

it('same-phrase password replacement reads the complete SDK-AEAD state without changing ciphertext or usage', async () => {
  const old = await fixture(),
    replacement = await fixture(PHRASE, `${password} replacement`);
  const original = state(SLH_DSA_SIGNATURE_LIMIT - 1),
    plain = JSON.stringify(original);
  const sealed = await old.crypto.encrypt(plain, keyId);
  expect(sealed).not.toContain(pair.secretKeyHex);
  expect(JSON.parse(sealed)).toMatchObject({
    version: 1,
    domain: SLH_DSA_PROFILE_STATE_DOMAIN,
  });
  expect(JSON.parse(sealed).recordId).toMatch(/^0x[0-9a-f]{64}$/);
  expect(keyId.length).toBeGreaterThan(128);
  expect(JSON.parse(await replacement.crypto.decrypt(sealed, keyId))).toEqual(
    original
  );
  expect(await old.keyring.getPrivateRecordProfileId()).toBe(
    await replacement.keyring.getPrivateRecordProfileId()
  );
});

it('rejects a different seed, key id, domain, altered ciphertext, and old password ciphertext', async () => {
  const f = await fixture(),
    other = await fixture(OTHER),
    sealed = await f.crypto.encrypt(JSON.stringify(state()), keyId);
  await expect(other.crypto.decrypt(sealed, keyId)).rejects.toThrow();
  await expect(f.crypto.decrypt(sealed, `${keyId}-other`)).rejects.toThrow();
  const parsed = JSON.parse(sealed);
  for (const changed of [
    { ...parsed, domain: 'wrong' },
    {
      ...parsed,
      ciphertext:
        (parsed.ciphertext[0] === 'A' ? 'B' : 'A') + parsed.ciphertext.slice(1),
    },
  ])
    await expect(
      f.crypto.decrypt(JSON.stringify(changed), keyId)
    ).rejects.toThrow();
  await expect(
    f.crypto.decrypt('U2FsdGVkX1-password-bound-state', keyId)
  ).rejects.toThrow();
});

it('captures crypto capabilities and rejects stale or asynchronous guards', async () => {
  const f = await fixture(),
    sealed = await f.crypto.encrypt(JSON.stringify(state()), keyId);
  f.keyring.decryptPrivateRecord = () => {
    throw Error('replacement method must not run');
  };
  expect(JSON.parse(await f.crypto.decrypt(sealed, keyId)).signatureCount).toBe(
    7
  );
  f.revoke();
  await expect(f.crypto.decrypt(sealed, keyId)).rejects.toThrow(
    'session changed'
  );
  expect(() =>
    createSlhDsaProfileStateCrypto(f.keyring, (() => Promise.resolve()) as any)
  ).toThrow('SESSION_CHANGED');
});

it('bounds plaintext and serialized ciphertext before invoking SDK operations', async () => {
  const encrypt = jest.fn(),
    decrypt = jest.fn();
  const crypto = createSlhDsaProfileStateCrypto(
    { encryptPrivateRecord: encrypt, decryptPrivateRecord: decrypt } as any,
    () => undefined
  );
  await expect(
    crypto.encrypt('x'.repeat(SLH_DSA_PROFILE_STATE_MAX_BYTES + 1), keyId)
  ).rejects.toThrow();
  await expect(
    crypto.encrypt('😀'.repeat(SLH_DSA_PROFILE_STATE_MAX_BYTES / 2), keyId)
  ).rejects.toThrow();
  await expect(
    crypto.decrypt('x'.repeat(SLH_DSA_PROFILE_STATE_MAX_BYTES * 2), keyId)
  ).rejects.toThrow();
  expect(encrypt).not.toHaveBeenCalled();
  expect(decrypt).not.toHaveBeenCalled();
});

it('clears owned plaintext buffers when a session ends during encryption or decryption', async () => {
  const f = await fixture(),
    sealed = await f.crypto.encrypt(JSON.stringify(state()), keyId);
  const held = deferred<void>();
  let bytes!: Uint8Array,
    active = true;
  const guard = () => {
    if (!active) throw Error('revoked');
  };
  const port = {
    encryptPrivateRecord: async (input: any) => {
      bytes = input.plaintext;
      await held.promise;
      return JSON.parse(sealed);
    },
    decryptPrivateRecord: async () => {
      bytes = new TextEncoder().encode(JSON.stringify(state()));
      active = false;
      return bytes;
    },
  };
  const crypto = createSlhDsaProfileStateCrypto(port as any, guard);
  const pending = crypto.encrypt(JSON.stringify(state()), keyId);
  active = false;
  held.resolve();
  await expect(pending).rejects.toThrow('revoked');
  expect(bytes.every((value) => value === 0)).toBe(true);
  active = true;
  await expect(crypto.decrypt(sealed, keyId)).rejects.toThrow('revoked');
  expect(bytes.every((value) => value === 0)).toBe(true);
});

it('the registered signer preserves and advances its count through same-phrase password replacement', async () => {
  const old = await fixture();
  configureSLHDSASessionStateCrypto(old.crypto);
  await registerRuntimeSLHDSAState(state(7));
  await expect(signSLHDSAActionHashLocal(signParams)).resolves.toBe(signResult);
  const retained = structuredClone(mockStorage.get(storageKey));
  clearRuntimeSLHDSAStates();
  const replacement = await fixture(PHRASE, `${password} new`);
  configureSLHDSASessionStateCrypto(replacement.crypto);
  expect(
    (await loadEncryptedSLHDSAState({ crypto: replacement.crypto, keyId }))
      ?.signatureCount
  ).toBe(8);
  expect(mockStorage.get(storageKey)).toEqual(retained);
  expect((await registerRuntimeSLHDSAState(state(0))).signatureCount).toBe(8);
  await signSLHDSAActionHashLocal(signParams);
  expect(
    (await loadEncryptedSLHDSAState({ crypto: replacement.crypto, keyId }))
      ?.signatureCount
  ).toBe(9);
});

it.each([false, 0, '', null, undefined, []])(
  'a present malformed signer row %j cannot be reset by registration',
  async (value) => {
    const f = await fixture();
    configureSLHDSASessionStateCrypto(f.crypto);
    mockStorage.set(storageKey, value);
    await expect(registerRuntimeSLHDSAState(state(0))).rejects.toThrow(
      'usage history is unsafe'
    );
    expect(mockStorage.get(storageKey)).toBe(value);
    expect(chromeStorage.setItem).not.toHaveBeenCalled();
    await expect(signSLHDSAActionHashLocal(signParams)).rejects.toThrow(
      'not available'
    );
  }
);

it.each(['malformed', 'password-bound'])(
  'an already registered signer refuses a replaced %s row before signing or writing',
  async (kind) => {
    const f = await fixture();
    configureSLHDSASessionStateCrypto(f.crypto);
    await registerRuntimeSLHDSAState(state(7));
    const row =
      kind === 'malformed'
        ? false
        : {
            version: 1,
            keyId,
            updatedAt: 1,
            cipherText: f.keyring.encryptSLHDSASessionState(
              JSON.stringify(state(11))
            ),
          };
    mockStorage.set(storageKey, row);
    jest.mocked(chromeStorage.setItem).mockClear();
    jest.mocked(signSLHDSAInOffscreen).mockClear();
    await expect(signSLHDSAActionHashLocal(signParams)).rejects.toThrow();
    expect(mockStorage.get(storageKey)).toBe(row);
    expect(chromeStorage.setItem).not.toHaveBeenCalled();
    expect(signSLHDSAInOffscreen).not.toHaveBeenCalled();
  }
);

it('an already registered signer refuses a missing persisted row before signing', async () => {
  const f = await fixture();
  configureSLHDSASessionStateCrypto(f.crypto);
  await registerRuntimeSLHDSAState(state(7));
  mockStorage.delete(storageKey);
  jest.mocked(chromeStorage.setItem).mockClear();
  jest.mocked(signSLHDSAInOffscreen).mockClear();
  await expect(signSLHDSAActionHashLocal(signParams)).rejects.toThrow(
    'usage history is unsafe'
  );
  expect(mockStorage.has(storageKey)).toBe(false);
  expect(chromeStorage.setItem).not.toHaveBeenCalled();
  expect(signSLHDSAInOffscreen).not.toHaveBeenCalled();
});

it('merges a higher authenticated persisted count before signing and applying the existing limit', async () => {
  const f = await fixture();
  configureSLHDSASessionStateCrypto(f.crypto);
  await registerRuntimeSLHDSAState(state(7));
  await saveEncryptedSLHDSAState(state(11), f.crypto, f.guard);
  await signSLHDSAActionHashLocal(signParams);
  expect(
    (await loadEncryptedSLHDSAState({ crypto: f.crypto, keyId }))
      ?.signatureCount
  ).toBe(12);
  await saveEncryptedSLHDSAState(
    state(SLH_DSA_SIGNATURE_LIMIT),
    f.crypto,
    f.guard
  );
  jest.mocked(chromeStorage.setItem).mockClear();
  jest.mocked(signSLHDSAInOffscreen).mockClear();
  await expect(signSLHDSAActionHashLocal(signParams)).rejects.toThrow(
    'signature limit reached'
  );
  expect(chromeStorage.setItem).not.toHaveBeenCalled();
  expect(signSLHDSAInOffscreen).not.toHaveBeenCalled();
});

it('registered signer refuses a password-bound row without overwriting it or resetting its count', async () => {
  const f = await fixture();
  configureSLHDSASessionStateCrypto(f.crypto);
  const row = {
    version: 1,
    keyId,
    updatedAt: 1,
    cipherText: f.keyring.encryptSLHDSASessionState(JSON.stringify(state(11))),
  };
  mockStorage.set(storageKey, row);
  await expect(registerRuntimeSLHDSAState(state(0))).rejects.toThrow();
  expect(mockStorage.get(storageKey)).toBe(row);
  expect(chromeStorage.setItem).not.toHaveBeenCalled();
});

it('keeps the admitted signing request while persisted state is read', async () => {
  const f = await fixture();
  configureSLHDSASessionStateCrypto(f.crypto);
  await registerRuntimeSLHDSAState(state(7));
  const entered = deferred<void>(),
    release = deferred<void>();
  configureSLHDSASessionStateCrypto(
    createSlhDsaProfileStateCrypto(
      {
        encryptPrivateRecord: f.keyring.encryptPrivateRecord.bind(f.keyring),
        decryptPrivateRecord: async (input: any) => {
          entered.resolve();
          await release.promise;
          return f.keyring.decryptPrivateRecord(input);
        },
      },
      f.guard
    )
  );
  const request = { ...signParams, allowReservedSignature: false };
  const pending = signSLHDSAActionHashLocal(request);
  await entered.promise;
  request.actionHash = `0x${'aa'.repeat(32)}`;
  request.allowReservedSignature = true;
  release.resolve();
  await pending;
  expect(signSLHDSAInOffscreen).toHaveBeenCalledWith(
    expect.objectContaining({
      actionHash: signParams.actionHash,
      allowReservedSignature: false,
    }),
    expect.any(Function)
  );
});

it('does not sign or write when the session ends during the new persisted-state read', async () => {
  const f = await fixture();
  configureSLHDSASessionStateCrypto(f.crypto);
  await registerRuntimeSLHDSAState(state(7));
  const original = mockStorage.get(storageKey);
  const entered = deferred<void>(),
    release = deferred<void>();
  configureSLHDSASessionStateCrypto(
    createSlhDsaProfileStateCrypto(
      {
        encryptPrivateRecord: f.keyring.encryptPrivateRecord.bind(f.keyring),
        decryptPrivateRecord: async (input: any) => {
          entered.resolve();
          await release.promise;
          return f.keyring.decryptPrivateRecord(input);
        },
      },
      f.guard
    )
  );
  jest.mocked(chromeStorage.setItem).mockClear();
  jest.mocked(signSLHDSAInOffscreen).mockClear();
  const pending = signSLHDSAActionHashLocal(signParams);
  const rejected = expect(pending).rejects.toThrow('wallet session changed');
  await entered.promise;
  clearRuntimeSLHDSAStates();
  release.resolve();
  await rejected;
  expect(mockStorage.get(storageKey)).toBe(original);
  expect(chromeStorage.setItem).not.toHaveBeenCalled();
  expect(signSLHDSAInOffscreen).not.toHaveBeenCalled();
});

it('the existing persistence mutex makes a recovery snapshot wait for the whole counter write and readback', async () => {
  const f = await fixture(),
    entered = deferred<void>(),
    release = deferred<void>();
  jest
    .mocked(chromeStorage.setItem)
    .mockImplementationOnce(async (key, value) => {
      mockStorage.set(key, value);
      entered.resolve();
      await release.promise;
    });
  const pending = saveEncryptedSLHDSAState(state(8), f.crypto, f.guard);
  await entered.promise;
  let captured = false;
  const snapshot = walletPersistenceMutex.runExclusive(async () => {
    captured = true;
    return structuredClone(mockStorage.get(storageKey));
  });
  await Promise.resolve();
  expect(captured).toBe(false);
  release.resolve();
  await pending;
  const row = (await snapshot) as { cipherText: string };
  expect(
    JSON.parse(await f.crypto.decrypt(row.cipherText, keyId)).signatureCount
  ).toBe(8);
});
