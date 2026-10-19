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
