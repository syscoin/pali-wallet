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

import { KeyringAccountType } from 'types/network';
import { BigNumber } from 'utils/ethersV6Compat';
import {
  buildSmartAccountUserOperation,
  encodeSmartAccountGasFees,
  encodeSmartAccountGasLimits,
} from 'utils/smartAccount';

import SmartAccountController from './index';

const ACCOUNT_ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
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

describe('SmartAccountController smart account execution fees', () => {
  const gasPayer = {
    address: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
    id: 0,
    type: KeyringAccountType.HDAccount,
  };

  const buildController = () => {
    const estimateGas = jest.fn().mockResolvedValue('143280');
    const sendAndSaveEthTransaction = jest.fn().mockResolvedValue({
      hash: '0xabc',
      wait: jest.fn(),
    });
    const controller: any = new SmartAccountController({
      getEthereumTransaction: () => ({
        web3Provider: { estimateGas },
      }),
      sendAndSaveEthTransaction,
    } as any);
    controller.getActiveSmartAccount = jest.fn(() => ({
      account: { address: ACCOUNT_ADDRESS, id: 9 },
      metadata: {
        chainId: CHAIN_ID,
        deploymentGasPayer: gasPayer,
      },
    }));
    controller.getWalletGasPayerAccount = jest.fn().mockResolvedValue(gasPayer);
    controller.getLocalNativeExecutionRecipients = jest.fn(() => []);
    controller.invalidateHydratedMetadata = jest.fn();

    return { controller, estimateGas, sendAndSaveEthTransaction };
  };

  const buildUserOperation = () =>
    buildSmartAccountUserOperation({
      accountGasLimits: encodeSmartAccountGasLimits({
        callGasLimit: 1,
        verificationGasLimit: 1,
      }),
      callData: '0x',
      gasFees: encodeSmartAccountGasFees({
        maxFeePerGas: 1,
        maxPriorityFeePerGas: 0,
      }),
      nonce: '0',
      preVerificationGas: '0',
      sender: ACCOUNT_ADDRESS,
    });

  it('does not add EIP-1559 outer fees when legacy preparation has no priority fee', async () => {
    const { controller, sendAndSaveEthTransaction } = buildController();

    await controller.submitSmartAccountExecution({
      executions: [],
      gasPayer,
      maxFeePerGas: '1000000000',
      signature: '0x1234',
      userOperation: buildUserOperation(),
    });

    expect(sendAndSaveEthTransaction).toHaveBeenCalledWith(
      expect.not.objectContaining({
        maxFeePerGas: expect.anything(),
        maxPriorityFeePerGas: expect.anything(),
      }),
      false,
      { id: gasPayer.id, type: gasPayer.type },
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('preserves explicit zero priority fee overrides for the outer transaction', async () => {
    const { controller, estimateGas, sendAndSaveEthTransaction } =
      buildController();

    await controller.submitSmartAccountExecution({
      executions: [],
      gasPayer,
      maxFeePerGas: '1000000000',
      maxPriorityFeePerGas: '0',
      signature: '0x1234',
      userOperation: buildUserOperation(),
    });

    expect(sendAndSaveEthTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        gasLimit: '143280',
        maxFeePerGas: '1000000000',
        maxPriorityFeePerGas: '0',
      }),
      false,
      { id: gasPayer.id, type: gasPayer.type },
      expect.any(Object),
      expect.any(Object)
    );
    expect(estimateGas).toHaveBeenCalledWith(
      expect.objectContaining({
        from: gasPayer.address,
      })
    );
    expect(estimateGas).toHaveBeenCalledWith(
      expect.not.objectContaining({
        maxFeePerGas: expect.anything(),
        maxPriorityFeePerGas: expect.anything(),
      })
    );
  });

  it('reuses the gas-tank credit estimate for the outer transaction', async () => {
    const { controller, estimateGas, sendAndSaveEthTransaction } =
      buildController();
    controller.getActiveSmartAccount.mockReturnValue({
      account: { address: ACCOUNT_ADDRESS, id: 9 },
      metadata: {
        chainId: 57057,
        deploymentGasPayer: gasPayer,
      },
    });
    controller.assertZkSysGasTankCoversTransaction = jest
      .fn()
      .mockResolvedValue(BigNumber.from('143280'));
    const userOperation = buildUserOperation();
    userOperation.gasFees = encodeSmartAccountGasFees({
      maxFeePerGas: 0,
      maxPriorityFeePerGas: 0,
    });

    await controller.submitSmartAccountExecution({
      executions: [],
      gasPayer,
      maxFeePerGas: '1000000000',
      maxPriorityFeePerGas: '0',
      signature: '0x1234',
      userOperation,
    });

    expect(
      controller.assertZkSysGasTankCoversTransaction
    ).toHaveBeenCalledTimes(1);
    expect(estimateGas).not.toHaveBeenCalled();
    expect(sendAndSaveEthTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ gasLimit: '143280' }),
      false,
      { id: gasPayer.id, type: gasPayer.type },
      expect.any(Object),
      expect.any(Object)
    );
  });
});
