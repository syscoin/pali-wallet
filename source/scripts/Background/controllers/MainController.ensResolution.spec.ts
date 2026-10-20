let mockState: any;
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockState,
    dispatch: (action: any) => {
      mockState = {
        ...mockState,
        vaultGlobal: jest
          .requireActual('state/vaultGlobal')
          .default(mockState.vaultGlobal, action),
      };
      return action;
    },
  },
}));
jest.mock('scripts/Background', () => ({
  getController: jest.fn(),
  notificationManager: {},
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));

import { selectEnsNameToAddress } from 'state/vault/selectors';
import vaultGlobalReducer, { clearAllEnsCache } from 'state/vaultGlobal';

import MainController from './MainController';

const NAME = 'receiver.eth';
const OLDER = `0x${'11'.repeat(20)}`;
const NEWER = `0x${'22'.repeat(20)}`;
const deferred = () => {
  let resolve!: (value: string | null) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string | null>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

let wallet: any;
let provider: { lookupAddress: jest.Mock; resolveName: jest.Mock };
const cached = (name = NAME) => selectEnsNameToAddress(mockState)[name];
beforeEach(() => {
  mockState = {
    vaultGlobal: vaultGlobalReducer(undefined, { type: 'test/init' }),
  };
  wallet = Object.create(MainController.prototype);
  wallet.walletStateGeneration = 0;
  wallet.ensResolutionRequests = new Map();
  provider = { resolveName: jest.fn(), lookupAddress: jest.fn() };
  wallet.getEnsMainnetProvider = () => provider;
});

it('publishes an ordinary result and releases its active request token', async () => {
  provider.resolveName.mockResolvedValue(OLDER);
  expect(await wallet.resolveEns(NAME)).toBe(OLDER);
  expect(cached()).toBe(OLDER);
  expect(wallet.ensResolutionRequests.size).toBe(0);
});

it.each(['older-first', 'newer-first'])(
  'returns successful parallel same-address results to both callers (%s)',
  async (order) => {
    const old = deferred();
    const current = deferred();
    provider.resolveName
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(current.promise);
    // Independent views may resolve the same name without editing either form.
    const first = wallet.resolveEns(NAME);
    const second = wallet.resolveEns(NAME);
    if (order === 'older-first') {
      old.resolve(OLDER);
      expect(await first).toBe(OLDER);
      expect(cached()).toBeUndefined();
      current.resolve(OLDER);
      expect(await second).toBe(OLDER);
    } else {
      current.resolve(OLDER);
      expect(await second).toBe(OLDER);
      const published = mockState.vaultGlobal.ensCache;
      old.resolve(OLDER);
      expect(await first).toBe(OLDER);
      expect(mockState.vaultGlobal.ensCache).toBe(published);
    }
    expect(cached()).toBe(OLDER);
    expect(wallet.ensResolutionRequests.size).toBe(0);
  }
);

it.each(['older-first', 'newer-first'])(
  'returns each same-name result but publishes only the latest request (%s)',
  async (order) => {
    const old = deferred();
    const current = deferred();
    provider.resolveName
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(current.promise);
    const first = wallet.resolveEns(NAME);
    const second = wallet.resolveEns(NAME.toUpperCase());
    if (order === 'older-first') {
      old.resolve(OLDER);
      expect(await first).toBe(OLDER);
      expect(cached()).toBeUndefined();
      expect(wallet.ensResolutionRequests.size).toBe(1);
      current.resolve(NEWER);
      expect(await second).toBe(NEWER);
    } else {
      current.resolve(NEWER);
      expect(await second).toBe(NEWER);
      expect(cached()).toBe(NEWER);
      old.resolve(OLDER);
      expect(await first).toBe(OLDER);
    }
    expect(cached()).toBe(NEWER);
    expect(mockState.vaultGlobal.ensCache[OLDER]).toBeUndefined();
    expect(wallet.ensResolutionRequests.size).toBe(0);
  }
);

it('does not let an older failed request erase the current token', async () => {
  const old = deferred();
  const current = deferred();
  provider.resolveName
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(current.promise);
  const first = wallet.resolveEns(NAME);
  const second = wallet.resolveEns(NAME);
  old.reject(new Error('Synthetic RPC failure'));
  expect(await first).toBeNull();
  expect(wallet.ensResolutionRequests.size).toBe(1);
  current.resolve(NEWER);
  expect(await second).toBe(NEWER);
  expect(cached()).toBe(NEWER);
  expect(wallet.ensResolutionRequests.size).toBe(0);
});

it('returns an older caller success even if the newer lookup fails', async () => {
  const old = deferred();
  const current = deferred();
  provider.resolveName
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(current.promise);
  const first = wallet.resolveEns(NAME);
  const second = wallet.resolveEns(NAME);
  current.reject(new Error('Synthetic newer lookup failure'));
  expect(await second).toBeNull();
  old.resolve(OLDER);
  expect(await first).toBe(OLDER);
  expect(cached()).toBeUndefined();
  expect(wallet.ensResolutionRequests.size).toBe(0);
});

it('keeps lookups of different names independent', async () => {
  const firstResult = deferred();
  const secondResult = deferred();
  provider.resolveName
    .mockReturnValueOnce(firstResult.promise)
    .mockReturnValueOnce(secondResult.promise);
  const first = wallet.resolveEns(NAME);
  const second = wallet.resolveEns('another.eth');
  secondResult.resolve(NEWER);
  expect(await second).toBe(NEWER);
  firstResult.resolve(OLDER);
  expect(await first).toBe(OLDER);
  expect(cached()).toBe(OLDER);
  expect(cached('another.eth')).toBe(NEWER);
  expect(wallet.ensResolutionRequests.size).toBe(0);
});

it('does not refill the cleared cache after the wallet generation advances', async () => {
  const response = deferred();
  provider.resolveName.mockReturnValue(response.promise);
  const first = wallet.resolveEns(NAME);
  // resetWalletStateExclusive advances this generation before asynchronous
  // cleanup. Exercise its freshness boundary without replacing the resolver.
  wallet.walletStateGeneration += 1;
  mockState = {
    ...mockState,
    vaultGlobal: vaultGlobalReducer(mockState.vaultGlobal, clearAllEnsCache()),
  };
  response.resolve(OLDER);
  expect(await first).toBeNull();
  expect(cached()).toBeUndefined();
  expect(wallet.ensResolutionRequests.size).toBe(0);

  provider.resolveName.mockResolvedValue(NEWER);
  expect(await wallet.resolveEns(NAME)).toBe(NEWER);
  expect(cached()).toBe(NEWER);
});

it('does not let a pre-reset reply retire a new same-name lookup', async () => {
  const old = deferred();
  const current = deferred();
  provider.resolveName
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(current.promise);
  const first = wallet.resolveEns(NAME);
  wallet.walletStateGeneration += 1;
  const second = wallet.resolveEns(NAME);
  old.resolve(OLDER);
  expect(await first).toBeNull();
  expect(cached()).toBeUndefined();
  expect(wallet.ensResolutionRequests.size).toBe(1);
  current.resolve(NEWER);
  expect(await second).toBe(NEWER);
  expect(cached()).toBe(NEWER);
  expect(wallet.ensResolutionRequests.size).toBe(0);
});

it.each([null, 'invalid', 'failure'])(
  'releases the request token for a %s result and allows retry',
  async (result) => {
    if (result === 'failure')
      provider.resolveName.mockRejectedValueOnce(
        new Error('Synthetic RPC failure')
      );
    else provider.resolveName.mockResolvedValueOnce(result);
    expect(await wallet.resolveEns(NAME)).toBeNull();
    expect(cached()).toBeUndefined();
    expect(wallet.ensResolutionRequests.size).toBe(0);
    provider.resolveName.mockResolvedValueOnce(NEWER);
    expect(await wallet.resolveEns(NAME)).toBe(NEWER);
    expect(cached()).toBe(NEWER);
  }
);

it('returns a reverse name only after its fresh forward result matches the address', async () => {
  provider.lookupAddress.mockResolvedValue(NAME);
  provider.resolveName.mockResolvedValue(
    OLDER.toUpperCase().replace('0X', '0x')
  );
  expect(await wallet.reverseResolveEns(OLDER)).toBe(NAME);
  expect(provider.resolveName).toHaveBeenCalledWith(NAME);
  expect(cached()).toBe(OLDER);
});

it('does not let a late reverse lookup replace a newer forward destination', async () => {
  const reverse = deferred();
  provider.lookupAddress.mockReturnValue(reverse.promise);
  provider.resolveName.mockResolvedValue(NEWER);
  const oldReverse = wallet.reverseResolveEns(OLDER);
  expect(await wallet.resolveEns(NAME)).toBe(NEWER);
  reverse.resolve(NAME);
  expect(await oldReverse).toBeNull();
  expect(cached()).toBe(NEWER);
  expect(mockState.vaultGlobal.ensCache[OLDER]).toBeUndefined();
});

it('does not publish a reverse result over a newer forward request during verification', async () => {
  const reverseVerification = deferred();
  const current = deferred();
  provider.lookupAddress.mockResolvedValue(NAME);
  provider.resolveName
    .mockReturnValueOnce(reverseVerification.promise)
    .mockReturnValueOnce(current.promise);
  const reverse = wallet.reverseResolveEns(OLDER);
  // Allow the reverse method to start its guarded forward verification.
  await Promise.resolve();
  expect(provider.resolveName).toHaveBeenCalledTimes(1);
  const forward = wallet.resolveEns(NAME);
  current.resolve(NEWER);
  expect(await forward).toBe(NEWER);
  reverseVerification.resolve(OLDER);
  expect(await reverse).toBe(NAME);
  expect(cached()).toBe(NEWER);
});

it.each(['reverse lookup', 'forward verification'])(
  'does not repopulate the cache when reset overtakes the %s',
  async (stage) => {
    const response = deferred();
    if (stage === 'reverse lookup')
      provider.lookupAddress.mockReturnValue(response.promise);
    else {
      provider.lookupAddress.mockResolvedValue(NAME);
      provider.resolveName.mockReturnValue(response.promise);
    }
    const result = wallet.reverseResolveEns(OLDER);
    await Promise.resolve();
    wallet.walletStateGeneration += 1;
    mockState = {
      ...mockState,
      vaultGlobal: vaultGlobalReducer(
        mockState.vaultGlobal,
        clearAllEnsCache()
      ),
    };
    response.resolve(stage === 'reverse lookup' ? NAME : OLDER);
    expect(await result).toBeNull();
    expect(mockState.vaultGlobal.ensCache).toEqual({});
    if (stage === 'reverse lookup')
      expect(provider.resolveName).not.toHaveBeenCalled();
    expect(wallet.ensResolutionRequests.size).toBe(0);
  }
);

it.each(['reverse failure', 'forward failure', 'mismatch', 'missing name'])(
  'does not cache the requested address after %s',
  async (mode) => {
    provider.lookupAddress.mockResolvedValue(
      mode === 'missing name' ? null : NAME
    );
    provider.resolveName.mockResolvedValue(mode === 'mismatch' ? NEWER : OLDER);
    if (mode === 'reverse failure')
      provider.lookupAddress.mockRejectedValue(
        new Error('Synthetic reverse failure')
      );
    if (mode === 'forward failure')
      provider.resolveName.mockRejectedValue(
        new Error('Synthetic forward failure')
      );
    expect(await wallet.reverseResolveEns(OLDER)).toBeNull();
    expect(mockState.vaultGlobal.ensCache[OLDER]).toBeUndefined();
    expect(cached()).toBe(mode === 'mismatch' ? NEWER : undefined);
    expect(wallet.ensResolutionRequests.size).toBe(0);
  }
);

it('keeps the latest forward destination when a name moves A to B to A', async () => {
  provider.resolveName
    .mockResolvedValueOnce(OLDER)
    .mockResolvedValueOnce(NEWER)
    .mockResolvedValueOnce(OLDER);
  expect(await wallet.resolveEns(NAME)).toBe(OLDER);
  expect(cached()).toBe(OLDER);
  expect(await wallet.resolveEns(NAME)).toBe(NEWER);
  expect(cached()).toBe(NEWER);
  expect(await wallet.resolveEns(NAME)).toBe(OLDER);
  expect(cached()).toBe(OLDER);
  expect(Object.keys(mockState.vaultGlobal.ensCache)).toEqual([OLDER]);
});

describe('bulk ENS resolution', () => {
  it('uses the guarded ethers lookup for each unique ENS name and retains input keys', async () => {
    const resolve = jest.spyOn(wallet, 'resolveEns');
    provider.resolveName.mockImplementation(async (name: string) => {
      if (name === NAME) return OLDER;
      if (name === 'OTHER.ETH') return NEWER;
      if (name === 'failed.eth') throw new Error('Synthetic resolver failure');
      return null;
    });

    expect(
      await wallet.batchResolveEns([
        NAME,
        NAME,
        'OTHER.ETH',
        'missing.eth',
        'failed.eth',
        OLDER,
        '',
        null,
      ])
    ).toEqual({
      [NAME]: OLDER,
      'OTHER.ETH': NEWER,
      'missing.eth': null,
      'failed.eth': null,
    });
    expect(resolve.mock.calls.map(([name]) => name).sort()).toEqual(
      [NAME, 'OTHER.ETH', 'missing.eth', 'failed.eth'].sort()
    );
    expect(provider.resolveName).toHaveBeenCalledTimes(4);
    expect(cached()).toBe(OLDER);
    expect(cached('other.eth')).toBe(NEWER);
    expect(wallet.ensResolutionRequests.size).toBe(0);
  });

  it('limits active ethers lookups to three without dropping queued names', async () => {
    const responses = Array.from({ length: 5 }, deferred);
    const names = responses.map((_, index) => `receiver${index}.eth`);
    let active = 0;
    let maximumActive = 0;
    provider.resolveName.mockImplementation((name: string) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      return responses[names.indexOf(name)].promise.finally(() => {
        active -= 1;
      });
    });
    const result = wallet.batchResolveEns(names);
    expect(provider.resolveName).toHaveBeenCalledTimes(3);
    for (const response of responses) response.resolve(OLDER);
    expect(await result).toEqual(
      Object.fromEntries(names.map((name) => [name, OLDER]))
    );
    expect(maximumActive).toBe(3);
    expect(provider.resolveName).toHaveBeenCalledTimes(5);
    expect(wallet.ensResolutionRequests.size).toBe(0);
  });

  it('does not let a bulk reply overwrite a newer individual lookup', async () => {
    const bulkReply = deferred();
    provider.resolveName
      .mockReturnValueOnce(bulkReply.promise)
      .mockResolvedValueOnce(NEWER);
    const bulk = wallet.batchResolveEns([NAME]);
    expect(provider.resolveName).toHaveBeenCalledTimes(1);
    expect(await wallet.resolveEns(NAME)).toBe(NEWER);
    bulkReply.resolve(OLDER);
    expect(await bulk).toEqual({ [NAME]: OLDER });
    expect(cached()).toBe(NEWER);
    expect(wallet.ensResolutionRequests.size).toBe(0);
  });

  it('stops queued lookups and returns no obsolete results after wallet reset', async () => {
    const responses = Array.from({ length: 3 }, deferred);
    const names = Array.from({ length: 5 }, (_, index) => `name${index}.eth`);
    provider.resolveName.mockImplementation(
      (name: string) => responses[names.indexOf(name)].promise
    );
    const result = wallet.batchResolveEns(names);
    expect(provider.resolveName).toHaveBeenCalledTimes(3);
    wallet.walletStateGeneration += 1;
    mockState = {
      ...mockState,
      vaultGlobal: vaultGlobalReducer(
        mockState.vaultGlobal,
        clearAllEnsCache()
      ),
    };
    for (const response of responses) response.resolve(OLDER);
    expect(await result).toEqual(
      Object.fromEntries(names.map((name) => [name, null]))
    );
    expect(provider.resolveName).toHaveBeenCalledTimes(3);
    expect(mockState.vaultGlobal.ensCache).toEqual({});
    expect(wallet.ensResolutionRequests.size).toBe(0);
  });

  it('invalidates completed entries too when reset overtakes a partially completed batch', async () => {
    const responses = Array.from({ length: 3 }, deferred);
    const names = responses.map((_, index) => `partial${index}.eth`);
    provider.resolveName.mockImplementation(
      (name: string) => responses[names.indexOf(name)].promise
    );
    const result = wallet.batchResolveEns(names);
    responses[0].resolve(OLDER);
    await responses[0].promise;
    expect(cached(names[0])).toBe(OLDER);
    wallet.walletStateGeneration += 1;
    mockState = {
      ...mockState,
      vaultGlobal: vaultGlobalReducer(
        mockState.vaultGlobal,
        clearAllEnsCache()
      ),
    };
    responses[1].resolve(OLDER);
    responses[2].resolve(OLDER);
    expect(await result).toEqual(
      Object.fromEntries(names.map((name) => [name, null]))
    );
    expect(mockState.vaultGlobal.ensCache).toEqual({});
    provider.resolveName.mockResolvedValue(NEWER);
    expect(await wallet.batchResolveEns([NAME])).toEqual({ [NAME]: NEWER });
    expect(cached()).toBe(NEWER);
    expect(wallet.ensResolutionRequests.size).toBe(0);
  });

  it.each(['older-first', 'newer-first'])(
    'shares newest-result cache protection between concurrent batches (%s)',
    async (order) => {
      const old = deferred();
      const current = deferred();
      provider.resolveName
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(current.promise);
      const first = wallet.batchResolveEns([NAME]);
      const second = wallet.batchResolveEns([NAME]);
      if (order === 'older-first') {
        old.resolve(OLDER);
        expect(await first).toEqual({ [NAME]: OLDER });
        expect(cached()).toBeUndefined();
        current.resolve(NEWER);
        expect(await second).toEqual({ [NAME]: NEWER });
      } else {
        current.resolve(NEWER);
        expect(await second).toEqual({ [NAME]: NEWER });
        expect(cached()).toBe(NEWER);
        old.resolve(OLDER);
        expect(await first).toEqual({ [NAME]: OLDER });
      }
      expect(cached()).toBe(NEWER);
      expect(wallet.ensResolutionRequests.size).toBe(0);
    }
  );

  it('returns an empty result without looking up a provider for non-ENS input', async () => {
    const getProvider = jest.spyOn(wallet, 'getEnsMainnetProvider');
    expect(await wallet.batchResolveEns([OLDER, '', null])).toEqual({});
    expect(getProvider).not.toHaveBeenCalled();
    expect(provider.resolveName).not.toHaveBeenCalled();
  });

  it('retains the missing-mainnet configuration error', async () => {
    wallet.getEnsMainnetProvider = () => null;
    await expect(wallet.batchResolveEns([NAME])).rejects.toThrow(
      'Ethereum mainnet RPC not configured. Cannot batch-resolve ENS.'
    );
    expect(provider.resolveName).not.toHaveBeenCalled();
  });
});
