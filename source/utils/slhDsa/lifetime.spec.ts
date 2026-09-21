jest.mock('./offscreenClient', () => ({
  prepareSLHDSAKeypairInOffscreen: jest.fn(),
  signSLHDSAInOffscreen: jest.fn(),
}));

const mockStorage = new Map<string, unknown>();

jest.mock('utils/storageAPI', () => ({
  chromeStorage: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    removeItem: jest.fn(async (key: string) => mockStorage.delete(key)),
    setItem: jest.fn(async (key: string, value: unknown) => {
      mockStorage.set(key, value);
    }),
  },
}));

import { chromeStorage } from 'utils/storageAPI';

import {
  SLH_DSA_ABSOLUTE_SIGNATURE_LIMIT,
  SLH_DSA_PARAMETER_SET,
  SLH_DSA_SIGNATURE_LIMIT,
  getSLHDSAKeyId,
  getSLHDSAStateStorageKey,
} from './constants';
import {
  prepareSLHDSAKeypairInOffscreen,
  signSLHDSAInOffscreen,
} from './offscreenClient';
import {
  clearRuntimeSLHDSAStates,
  configureSLHDSASessionStateCrypto,
  getSLHDSASessionGeneration,
  provisionRuntimeSLHDSAStateFromSetupSecret,
  putRuntimeSLHDSAState,
  registerRuntimeSLHDSAState,
  signSLHDSAActionHashLocal,
} from './signer';
import { provisionSLHDSASmartAccountValidator } from './smartAccountSetup';
import {
  createSLHDSAProvisionedState,
  loadEncryptedSLHDSAState,
  saveEncryptedSLHDSAState,
} from './state';

const keypair = {
  pkRoot: `0x${'11'.repeat(16)}${'00'.repeat(16)}`,
  pkSeed: `0x${'22'.repeat(16)}${'00'.repeat(16)}`,
  secretKeyHex: `0x${'33'.repeat(64)}`,
};
const keyId = getSLHDSAKeyId(keypair);
const storageKey = getSLHDSAStateStorageKey(keyId);
const crypto = {
  decrypt: (value: string) => value,
  encrypt: (value: string) => value,
};
const makeState = (signatureCount = 0) => ({
  ...createSLHDSAProvisionedState({
    ...keypair,
    accountIndex: 0,
    derivationLabel: 'account/0',
    keyId,
  }),
  signatureCount,
});
const signParams = {
  actionHash: `0x${'aa'.repeat(32)}`,
  keyId,
  parameterSet: SLH_DSA_PARAMETER_SET,
  pkRoot: keypair.pkRoot,
  pkSeed: keypair.pkSeed,
};
const provision = () =>
  provisionRuntimeSLHDSAStateFromSetupSecret({
    accountIndex: 0,
    derivationLabel: 'account/0',
    setupSecretHex: `0x${'44'.repeat(32)}`,
  });
const readState = () => loadEncryptedSLHDSAState({ crypto, keyId });
const validSignature = `0x${'55'.repeat(3856)}`;

const deferred = <T>() => {
  let resolve: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('SLH-DSA local lifetime accounting', () => {
  beforeEach(() => {
    clearRuntimeSLHDSAStates();
    mockStorage.clear();
    jest.clearAllMocks();
    configureSLHDSASessionStateCrypto(crypto);
    jest.mocked(prepareSLHDSAKeypairInOffscreen).mockResolvedValue(keypair);
    jest.mocked(signSLHDSAInOffscreen).mockResolvedValue(validSignature);
  });

  afterEach(() => {
    clearRuntimeSLHDSAStates();
  });

  it.each([7, SLH_DSA_SIGNATURE_LIMIT, SLH_DSA_ABSOLUTE_SIGNATURE_LIMIT])(
    'preserves persisted count %i when rebuilding the same key after restart',
    async (signatureCount) => {
      await saveEncryptedSLHDSAState(makeState(signatureCount), crypto);

      const regenerated = await provision();

      expect(regenerated.signatureCount).toBe(signatureCount);
      expect((await readState()).signatureCount).toBe(signatureCount);
      if (signatureCount >= SLH_DSA_SIGNATURE_LIMIT) {
        await expect(signSLHDSAActionHashLocal(signParams)).rejects.toThrow(
          'signature limit reached'
        );
        expect(signSLHDSAInOffscreen).not.toHaveBeenCalled();
      }
    }
  );

  it('retains the runtime high-water count after an earlier signing persistence failure', async () => {
    await registerRuntimeSLHDSAState(makeState(7));
    jest
      .mocked(chromeStorage.setItem)
      .mockRejectedValueOnce(new Error('disk full'));

    await expect(signSLHDSAActionHashLocal(signParams)).rejects.toThrow(
      'disk full'
    );
    expect((await readState()).signatureCount).toBe(7);

    expect((await provision()).signatureCount).toBe(8);
    expect((await readState()).signatureCount).toBe(8);
  });

  it('serializes same-key reprovisioning behind an in-flight signature', async () => {
    await registerRuntimeSLHDSAState(makeState(7));
    let release: (signature: string) => void;
    let started: () => void;
    const didStart = new Promise<void>((resolve) => {
      started = resolve;
    });
    jest.mocked(signSLHDSAInOffscreen).mockImplementationOnce(() => {
      started();
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    });
    const signing = signSLHDSAActionHashLocal(signParams);
    await didStart;
    const regenerating = provision();
    release(validSignature);

    await signing;
    expect((await regenerating).signatureCount).toBe(8);
    expect((await readState()).signatureCount).toBe(8);
  });

  it('does not roll back a used count when delayed hydration inserts older cached state', async () => {
    await registerRuntimeSLHDSAState(makeState(7));
    const cached = await readState();
    await signSLHDSAActionHashLocal(signParams);
    putRuntimeSLHDSAState(cached);

    await signSLHDSAActionHashLocal(signParams);

    expect((await readState()).signatureCount).toBe(9);
  });

  it('does not let callers mutate the runtime counter through returned state', async () => {
    const state = await registerRuntimeSLHDSAState(makeState(7));
    state.signatureCount = 0;

    await signSLHDSAActionHashLocal(signParams);

    expect((await readState()).signatureCount).toBe(8);
  });

  it('preserves an updated runtime high-water count while a signature is in flight', async () => {
    await registerRuntimeSLHDSAState(makeState(7));
    jest.mocked(signSLHDSAInOffscreen).mockImplementationOnce(async () => {
      putRuntimeSLHDSAState(makeState(9));
      return validSignature;
    });

    await signSLHDSAActionHashLocal(signParams);

    expect((await readState()).signatureCount).toBe(10);
  });

  it.each([
    ['missing count', undefined],
    ['negative count', -1],
    ['fractional count', 1.5],
    ['string count', '7'],
    ['past absolute limit', SLH_DSA_ABSOLUTE_SIGNATURE_LIMIT + 1],
  ])(
    'refuses to overwrite existing state with %s',
    async (_label, signatureCount) => {
      await saveEncryptedSLHDSAState(makeState(7), crypto);
      const envelope = mockStorage.get(storageKey) as Record<string, unknown>;
      const corrupt = {
        ...envelope,
        cipherText: JSON.stringify({ ...makeState(7), signatureCount }),
      };
      mockStorage.set(storageKey, corrupt);
      jest.mocked(chromeStorage.setItem).mockClear();

      await expect(provision()).rejects.toThrow('usage history is unsafe');

      expect(chromeStorage.setItem).not.toHaveBeenCalled();
      expect(mockStorage.get(storageKey)).toBe(corrupt);
      await expect(signSLHDSAActionHashLocal(signParams)).rejects.toThrow(
        'not available in this unlocked session'
      );
    }
  );

  it('fails closed on unreadable encrypted state without replacing it', async () => {
    await saveEncryptedSLHDSAState(makeState(7), crypto);
    const original = mockStorage.get(storageKey);
    configureSLHDSASessionStateCrypto({
      ...crypto,
      decrypt: () => {
        throw new Error('cannot decrypt');
      },
    });
    jest.mocked(chromeStorage.setItem).mockClear();

    await expect(provision()).rejects.toThrow('cannot decrypt');

    expect(chromeStorage.setItem).not.toHaveBeenCalled();
    expect(mockStorage.get(storageKey)).toBe(original);
  });

  it.each([
    { signatureLimit: SLH_DSA_ABSOLUTE_SIGNATURE_LIMIT },
    { version: 99 },
    { keyId: 'a-different-key' },
  ])('refuses corrupted persisted policy or identity %j', async (overrides) => {
    await saveEncryptedSLHDSAState(makeState(7), crypto);
    const envelope = mockStorage.get(storageKey) as Record<string, unknown>;
    const corrupt = {
      ...envelope,
      cipherText: JSON.stringify({ ...makeState(7), ...overrides }),
    };
    mockStorage.set(storageKey, corrupt);
    jest.mocked(chromeStorage.setItem).mockClear();

    await expect(provision()).rejects.toThrow();

    expect(chromeStorage.setItem).not.toHaveBeenCalled();
    expect(mockStorage.get(storageKey)).toBe(corrupt);
  });

  it('rejects mismatched key material instead of replacing its usage history', async () => {
    await saveEncryptedSLHDSAState(makeState(7), crypto);
    jest.mocked(chromeStorage.setItem).mockClear();

    await expect(
      registerRuntimeSLHDSAState({
        ...makeState(),
        secretKeyHex: `0x${'99'.repeat(64)}`,
      })
    ).rejects.toThrow('conflicts with existing key material');

    expect(chromeStorage.setItem).not.toHaveBeenCalled();
    expect((await readState()).signatureCount).toBe(7);
  });

  it('does not expose a newly provisioned runtime signer if persistence fails', async () => {
    jest
      .mocked(chromeStorage.setItem)
      .mockRejectedValueOnce(new Error('disk full'));

    await expect(provision()).rejects.toThrow('disk full');
    await expect(signSLHDSAActionHashLocal(signParams)).rejects.toThrow(
      'not available in this unlocked session'
    );
  });

  it('rejects an old envelope readback instead of accepting the same key/version', async () => {
    await saveEncryptedSLHDSAState(makeState(7), crypto);
    const oldEnvelope = mockStorage.get(storageKey);
    jest.mocked(chromeStorage.getItem).mockResolvedValueOnce(oldEnvelope);

    await expect(
      saveEncryptedSLHDSAState(makeState(8), crypto)
    ).rejects.toThrow('Failed to persist');
  });

  it('does not republish signer material if locked during registration readback', async () => {
    const readStarted = deferred<void>();
    const readback = deferred<unknown>();
    jest
      .mocked(chromeStorage.getItem)
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(() => {
        readStarted.resolve();
        return readback.promise;
      });
    const registering = registerRuntimeSLHDSAState(makeState(7));
    const rejected = expect(registering).rejects.toThrow(
      'wallet session changed'
    );
    await readStarted.promise;
    clearRuntimeSLHDSAStates();
    configureSLHDSASessionStateCrypto(crypto);
    readback.resolve(mockStorage.get(storageKey));

    await rejected;
    await expect(signSLHDSAActionHashLocal(signParams)).rejects.toThrow(
      'not available in this unlocked session'
    );
    expect(signSLHDSAInOffscreen).not.toHaveBeenCalled();
  });

  it('keeps old storage writes fenced before a new session registers the same key', async () => {
    const writeStarted = deferred<void>();
    const releaseWrite = deferred<void>();
    jest
      .mocked(chromeStorage.setItem)
      .mockImplementationOnce(async (key, value) => {
        writeStarted.resolve();
        await releaseWrite.promise;
        mockStorage.set(key, value);
      });
    const oldRegistration = registerRuntimeSLHDSAState(makeState(7));
    const rejected = expect(oldRegistration).rejects.toThrow(
      'wallet session changed'
    );
    await writeStarted.promise;
    clearRuntimeSLHDSAStates();
    configureSLHDSASessionStateCrypto(crypto);
    const newRegistration = registerRuntimeSLHDSAState(makeState(9));
    await Promise.resolve();
    expect(chromeStorage.setItem).toHaveBeenCalledTimes(1);
    releaseWrite.resolve();

    await rejected;
    expect((await newRegistration).signatureCount).toBe(9);
    expect((await readState()).signatureCount).toBe(9);
  });

  it('rejects prepared key material from a previous session before registration', async () => {
    const keypairStarted = deferred<void>();
    const prepared = deferred<typeof keypair>();
    jest.mocked(prepareSLHDSAKeypairInOffscreen).mockImplementationOnce(() => {
      keypairStarted.resolve();
      return prepared.promise;
    });
    const provisioning = provision();
    const rejected = expect(provisioning).rejects.toThrow(
      'wallet session changed'
    );
    await keypairStarted.promise;
    clearRuntimeSLHDSAStates();
    configureSLHDSASessionStateCrypto(crypto);
    prepared.resolve(keypair);

    await rejected;
    expect(chromeStorage.setItem).not.toHaveBeenCalled();
  });

  it('discards in-flight and queued old-session signatures after a new unlock', async () => {
    await registerRuntimeSLHDSAState(makeState(7));
    const workerStarted = deferred<void>();
    const response = deferred<string>();
    jest.mocked(signSLHDSAInOffscreen).mockImplementationOnce(() => {
      workerStarted.resolve();
      return response.promise;
    });
    const first = signSLHDSAActionHashLocal(signParams);
    const firstRejected = expect(first).rejects.toThrow(
      'wallet session changed'
    );
    await workerStarted.promise;
    const queued = signSLHDSAActionHashLocal(signParams);
    const queuedRejected = expect(queued).rejects.toThrow(
      'wallet session changed'
    );
    clearRuntimeSLHDSAStates();
    configureSLHDSASessionStateCrypto(crypto);
    const newRegistration = registerRuntimeSLHDSAState(makeState(7));
    response.resolve(validSignature);

    await Promise.all([firstRejected, queuedRejected, newRegistration]);
    expect(signSLHDSAInOffscreen).toHaveBeenCalledTimes(1);
    expect((await readState()).signatureCount).toBe(7);
  });

  it('rejects old-session hydration even after a new session is configured', async () => {
    const generation = getSLHDSASessionGeneration();
    const cached = makeState(7);
    clearRuntimeSLHDSAStates();
    configureSLHDSASessionStateCrypto(crypto);

    expect(() => putRuntimeSLHDSAState(cached, generation)).toThrow(
      'wallet session changed'
    );
    await expect(
      signSLHDSAActionHashLocal(signParams, generation)
    ).rejects.toThrow('wallet session changed');
    expect(signSLHDSAInOffscreen).not.toHaveBeenCalled();
  });

  it('does not persist signing state or release a signature if locked during encryption', async () => {
    await registerRuntimeSLHDSAState(makeState(7));
    const encryptStarted = deferred<void>();
    const encrypted = deferred<string>();
    configureSLHDSASessionStateCrypto({
      ...crypto,
      encrypt: () => {
        encryptStarted.resolve();
        return encrypted.promise;
      },
    });
    jest.mocked(chromeStorage.setItem).mockClear();
    const signing = signSLHDSAActionHashLocal(signParams);
    const rejected = expect(signing).rejects.toThrow('wallet session changed');
    await encryptStarted.promise;
    clearRuntimeSLHDSAStates();
    configureSLHDSASessionStateCrypto(crypto);
    encrypted.resolve(JSON.stringify(makeState(8)));

    await rejected;
    expect(chromeStorage.setItem).not.toHaveBeenCalled();
    expect((await readState()).signatureCount).toBe(7);
  });

  it('does not provision an old setup job when secret derivation crosses a session change', async () => {
    const derivationStarted = deferred<void>();
    const derived = deferred<{
      derivationLabel: string;
      setupSecretHex: string;
    }>();
    const provisioning = provisionSLHDSASmartAccountValidator({
      accountId: 9,
      accountIndex: 0,
      getSetupSecret: () => {
        derivationStarted.resolve();
        return derived.promise;
      },
    });
    const rejected = expect(provisioning).rejects.toThrow(
      'wallet session changed'
    );
    await derivationStarted.promise;
    clearRuntimeSLHDSAStates();
    configureSLHDSASessionStateCrypto(crypto);
    derived.resolve({
      derivationLabel: 'account/0',
      setupSecretHex: `0x${'44'.repeat(32)}`,
    });

    await rejected;
    expect(prepareSLHDSAKeypairInOffscreen).not.toHaveBeenCalled();
    expect(mockStorage.has(storageKey)).toBe(false);
  });
});
