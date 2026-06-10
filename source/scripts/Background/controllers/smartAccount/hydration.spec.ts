jest.unmock('@ethersproject/abi');
jest.unmock('@ethersproject/address');
jest.unmock('@ethersproject/bignumber');
jest.unmock('@ethersproject/bytes');
jest.unmock('@ethersproject/constants');
jest.unmock('@ethersproject/contracts');
jest.unmock('@ethersproject/hash');
jest.unmock('@ethersproject/keccak256');
jest.unmock('@ethersproject/strings');

jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    dispatch: jest.fn(),
    getState: () => ({ vault: {} }),
  },
}));

jest.mock('state/vault', () => ({
  setAccountPropertyByIdAndType: (payload: any) => ({
    payload,
    type: 'vault/setAccountPropertyByIdAndType',
  }),
}));

jest.mock('utils/security/blacklistService', () => ({
  blacklistService: {},
}));

import SmartAccountController from './index';

const ACCOUNT_ADDRESS = '0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa';
const CHAIN_ID = 57;

const buildAccount = () => ({
  address: ACCOUNT_ADDRESS,
  smartAccount: { chainId: CHAIN_ID },
});

interface IDeferred {
  promise: Promise<any>;
  resolve: (value: any) => void;
}

const createDeferred = (): IDeferred => {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('SmartAccountController metadata hydration cache', () => {
  let controller: any;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    controller = new SmartAccountController({} as any);
    fetchMock = jest.fn();
    controller.fetchSmartAccountMetadata = fetchMock;
  });

  it('deduplicates concurrent non-forced hydrations onto one fetch', async () => {
    const deferred = createDeferred();
    fetchMock.mockReturnValue(deferred.promise);

    const account = buildAccount();
    const first = controller.hydrateSmartAccountMetadata(account);
    const second = controller.hydrateSmartAccountMetadata(account);

    deferred.resolve({ isDeployed: true, marker: 'shared' });

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(firstResult.marker).toBe('shared');
    expect(secondResult.marker).toBe('shared');

    // Completed result is served from cache without another fetch.
    const cachedResult = await controller.hydrateSmartAccountMetadata(account);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cachedResult.marker).toBe('shared');
  });

  it('forceRefresh bypasses an in-flight hydration started before the change', async () => {
    const staleFetch = createDeferred();
    const freshFetch = createDeferred();
    fetchMock
      .mockReturnValueOnce(staleFetch.promise)
      .mockReturnValueOnce(freshFetch.promise);

    const account = buildAccount();
    // Pre-change hydration is still in flight when the forced refresh runs
    // (e.g. right after deployment confirmation).
    const stalePromise = controller.hydrateSmartAccountMetadata(account);
    const forcedPromise = controller.hydrateSmartAccountMetadata(account, {
      forceRefresh: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    freshFetch.resolve({ isDeployed: true, marker: 'fresh' });
    const forcedResult = await forcedPromise;
    expect(forcedResult.marker).toBe('fresh');

    // The superseded fetch resolving late must not clobber the fresh cache.
    staleFetch.resolve({ isDeployed: false, marker: 'stale' });
    await stalePromise;
    await flushMicrotasks();

    const cachedResult = await controller.hydrateSmartAccountMetadata(account);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cachedResult.marker).toBe('fresh');
    expect(cachedResult.isDeployed).toBe(true);
  });

  it('invalidateHydratedMetadata detaches in-flight hydrations', async () => {
    const staleFetch = createDeferred();
    const freshFetch = createDeferred();
    fetchMock
      .mockReturnValueOnce(staleFetch.promise)
      .mockReturnValueOnce(freshFetch.promise);

    const account = buildAccount();
    const stalePromise = controller.hydrateSmartAccountMetadata(account);

    controller.invalidateHydratedMetadata(ACCOUNT_ADDRESS);

    // A non-forced call after invalidation must not join the detached fetch.
    const refreshedPromise = controller.hydrateSmartAccountMetadata(account);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    staleFetch.resolve({ isDeployed: false, marker: 'stale' });
    await stalePromise;
    freshFetch.resolve({ isDeployed: true, marker: 'fresh' });
    const refreshedResult = await refreshedPromise;
    await flushMicrotasks();

    expect(refreshedResult.marker).toBe('fresh');
    const cachedResult = await controller.hydrateSmartAccountMetadata(account);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cachedResult.marker).toBe('fresh');
  });
});
