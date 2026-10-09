jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: jest.fn(), dispatch: jest.fn() },
}));
jest.mock('utils/security/blacklistService', () => ({ blacklistService: {} }));
jest.mock('utils/smartAccount', () => ({
  ...jest.requireActual('utils/smartAccount'),
  getPaliInfrastructureContracts: () => [
    {
      id: 'factory',
      address: '0x0000000000000000000000000000000000000001',
      displayName: 'Factory',
      deployCalldata: '0x01',
    },
  ],
}));
jest.mock('./infrastructureJournal', () => ({
  ...jest.requireActual('./infrastructureJournal'),
  readInfrastructureJournal: jest.fn(),
  clearInfrastructureJournal: jest.fn(),
}));

import store from 'state/store';
import { INetworkType, KeyringAccountType } from 'types/network';
import { PALI_CREATE2_DEPLOYER_ADDRESS } from 'utils/smartAccount';

import SmartAccountController from './index';
import {
  readInfrastructureJournal,
  clearInfrastructureJournal,
} from './infrastructureJournal';

const hash = (index: number) => `0x${index.toString(16).padStart(64, '0')}`;
const delayed = <T>(value: T, delay: number) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), delay));
const history = (index: number) => ({
  smartAccountInfrastructureDeployment: true,
  smartAccountInfrastructureId: 'factory',
  hash: hash(index),
  confirmations: 0,
});

describe('infrastructure status aggregate deadline', () => {
  let state: any;
  let provider: any;
  let controller: SmartAccountController;

  beforeEach(() => {
    jest.useFakeTimers();
    jest
      .mocked(readInfrastructureJournal)
      .mockReset()
      .mockResolvedValue(undefined);
    jest
      .mocked(clearInfrastructureJournal)
      .mockReset()
      .mockResolvedValue(undefined);
    state = {
      vaultGlobal: { activeSlip44: 60 },
      vault: {
        isBitcoinBased: false,
        activeNetwork: {
          kind: INetworkType.Ethereum,
          chainId: 1,
          url: 'https://rpc.example',
        },
        activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
        accounts: {
          HDAccount: {
            0: { id: 0, address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
          },
        },
        accountTransactions: { HDAccount: { 0: { ethereum: { 1: [] } } } },
      },
    };
    jest.mocked(store.getState).mockImplementation(() => state);
    provider = {
      sendBatch: jest.fn().mockResolvedValue(['0x11', '0x']),
      getCode: jest.fn(async (address: string) =>
        address === PALI_CREATE2_DEPLOYER_ADDRESS ? '0x11' : '0x'
      ),
      getTransactionReceipt: jest.fn(async (txHash: string) => ({
        hash: txHash,
        status: 0,
      })),
    };
    controller = new SmartAccountController({
      getEthereumTransaction: () => ({ web3Provider: provider }),
    } as any);
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('reserves fallback time so a hung batch and four-second individual probes recover', async () => {
    provider.sendBatch.mockReturnValue(new Promise(() => undefined));
    provider.getCode.mockImplementation((address: string) =>
      delayed(address === PALI_CREATE2_DEPLOYER_ADDRESS ? '0x11' : '0x', 4000)
    );
    const started = Date.now();
    const request = controller.getSmartAccountInfrastructureStatus(true);
    await jest.advanceTimersByTimeAsync(1799);
    expect(provider.getCode).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(provider.getCode).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(4000);
    await expect(request).resolves.toMatchObject({
      missing: ['factory'],
      ready: false,
    });
    expect(Date.now() - started).toBe(5800);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('shares one eighteen-second budget across storage, fallback, receipt and journal clearing', async () => {
    const journal = {
      contractId: 'factory' as const,
      transactionHash: hash(1),
    };
    jest
      .mocked(readInfrastructureJournal)
      .mockImplementation(() => delayed(journal, 7000));
    provider.sendBatch.mockReturnValue(new Promise(() => undefined));
    provider.getCode.mockImplementation((address: string) =>
      delayed(address === PALI_CREATE2_DEPLOYER_ADDRESS ? '0x11' : '0x', 7000)
    );
    provider.getTransactionReceipt.mockImplementation((txHash: string) =>
      delayed({ hash: txHash, status: 0 }, 1700)
    );
    jest
      .mocked(clearInfrastructureJournal)
      .mockReturnValue(new Promise(() => undefined));
    const request = controller.getSmartAccountInfrastructureStatus(true);
    const rejected = expect(request).rejects.toThrow(
      'Infrastructure RPC timed out'
    );
    let completed = false;
    void request.catch(() => {
      completed = true;
    });
    await jest.advanceTimersByTimeAsync(17999);
    expect(completed).toBe(false);
    expect(clearInfrastructureJournal).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await rejected;
    expect(completed).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('stops scheduling historical receipt probes once the aggregate budget is spent', async () => {
    jest
      .mocked(readInfrastructureJournal)
      .mockImplementation(() => delayed(undefined, 7000));
    provider.sendBatch.mockImplementation(() => delayed(['0x11', '0x'], 1000));
    state.vault.accountTransactions.HDAccount[0].ethereum[1] = Array.from(
      { length: 12 },
      (_, index) => history(index)
    );
    provider.getTransactionReceipt.mockImplementation((txHash: string) =>
      delayed({ hash: txHash, status: 0 }, 1000)
    );
    const request = controller.getSmartAccountInfrastructureStatus(true);
    const rejected = expect(request).rejects.toThrow(
      'Infrastructure RPC timed out'
    );
    await jest.advanceTimersByTimeAsync(18000);
    await rejected;
    expect(provider.getTransactionReceipt).toHaveBeenCalledTimes(10);
    expect(clearInfrastructureJournal).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('settles historical receipts without unnecessary serialized journal reads or writes', async () => {
    state.vault.accountTransactions.HDAccount[0].ethereum[1] = [
      history(1),
      history(2),
      history(3),
    ];
    await expect(
      controller.getSmartAccountInfrastructureStatus(true)
    ).resolves.not.toHaveProperty('pending');
    expect(provider.getTransactionReceipt).toHaveBeenCalledTimes(3);
    expect(readInfrastructureJournal).toHaveBeenCalledTimes(1);
    expect(clearInfrastructureJournal).not.toHaveBeenCalled();
  });

  it('clears the captured journal only once when memory and history repeat that submission', async () => {
    const journal = {
      contractId: 'factory' as const,
      transactionHash: hash(1),
    };
    jest.mocked(readInfrastructureJournal).mockResolvedValue(journal);
    (controller as any).pendingInfrastructure.set(1, journal);
    state.vault.accountTransactions.HDAccount[0].ethereum[1] = [history(1)];
    await controller.getSmartAccountInfrastructureStatus(true);
    expect(clearInfrastructureJournal).toHaveBeenCalledTimes(1);
    expect(clearInfrastructureJournal).toHaveBeenCalledWith(1, journal);
  });
});
