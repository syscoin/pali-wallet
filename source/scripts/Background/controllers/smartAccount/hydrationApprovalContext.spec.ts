jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState, dispatch: jest.fn() },
  persistSmartAccountMetadata: jest.fn(),
}));
jest.mock('utils/security/blacklistService', () => ({ blacklistService: {} }));

import { persistSmartAccountMetadata } from 'state/store';
import { INetworkType, KeyringAccountType } from 'types/network';

import SmartAccountController from './index';

let mockState: any;
const PAYER = `0x${'11'.repeat(20)}`;
const TARGET = `0x${'22'.repeat(20)}`;
const OTHER = `0x${'33'.repeat(20)}`;
const metadata = { chainId: 57057, isDeployed: true, installedModules: [] };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('read-only smart-account hydration approval and target identity', () => {
  let controller: any;
  let generation: number;
  let provider: any;
  let read: jest.Mock;
  let persist: jest.Mock;
  const expectedContext = () => {
    const { id, type } = mockState.vault.activeAccount;
    return {
      account: {
        id,
        type,
        address: mockState.vault.accounts[type][id].address,
      },
      chainId: 57057,
      rpcUrl: 'https://fixture.invalid',
      slip44: 60,
      sessionGeneration: generation,
    };
  };
  beforeEach(() => {
    generation = 9;
    provider = {};
    mockState = {
      vault: {
        activeNetwork: {
          chainId: 57057,
          kind: INetworkType.Ethereum,
          url: 'https://fixture.invalid',
        },
        activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
        isBitcoinBased: false,
        accounts: {
          HDAccount: {
            0: { id: 0, address: PAYER },
            1: { id: 1, address: OTHER },
          },
          SmartAccount: {
            7: {
              id: 7,
              type: KeyringAccountType.SmartAccount,
              address: TARGET,
              isSmartAccount: true,
              smartAccount: { ...metadata },
            },
            8: {
              id: 8,
              type: KeyringAccountType.SmartAccount,
              address: OTHER,
              isSmartAccount: true,
              smartAccount: { ...metadata },
            },
          },
        },
      },
      vaultGlobal: { activeSlip44: 60 },
    };
    controller = new SmartAccountController({
      getEthereumTransaction: () => ({ web3Provider: provider }),
      getWalletSessionGeneration: () => generation,
      getWalletStateGeneration: () => 0,
    } as any);
    // Hold the actual transaction object stable, as the production controller does.
    const transaction = { web3Provider: provider };
    Object.defineProperty(controller, 'ethereumTransaction', {
      get: () => transaction,
    });
    read = jest.fn().mockResolvedValue(metadata);
    persist = jest.fn().mockResolvedValue(undefined);
    controller.hydrateSmartAccountMetadata = read;
    controller.persistSmartAccountMetadata = persist;
  });

  it.each(['EOA', 'other smart account', 'target smart account'])(
    'allows a current %s approval to refresh the named local target',
    async (payer) => {
      if (payer !== 'EOA')
        mockState.vault.activeAccount = {
          id: payer === 'target smart account' ? 7 : 8,
          type: KeyringAccountType.SmartAccount,
        };
      await expect(
        controller.hydrateSmartAccount(7, expectedContext())
      ).resolves.toEqual(metadata);
      expect(read).toHaveBeenCalledWith(
        mockState.vault.accounts.SmartAccount[7],
        { forceRefresh: true }
      );
      expect(persist).toHaveBeenCalledWith(7, metadata, expectedContext(), {
        account: mockState.vault.accounts.SmartAccount[7],
        metadata: mockState.vault.accounts.SmartAccount[7].smartAccount,
      });
    }
  );

  it.each([
    'payer',
    'session',
    'target address',
    'target id',
    'target chain',
    'target type',
    'target deleted',
  ])(
    'does not persist when %s changes during the forced read',
    async (axis) => {
      // Omitted explicit context is also used by ordinary read-only entry hydration.
      const gate = deferred<typeof metadata>();
      read.mockReturnValueOnce(gate.promise);
      // The real persistence helper owns the captured target checks. Preserve
      // that boundary while keeping this test's unrelated storage stub.
      const actualPersist = (SmartAccountController.prototype as any)
        .persistSmartAccountMetadata;
      controller.persistSmartAccountMetadata = actualPersist;
      const pending = controller.hydrateSmartAccount(7);
      const rejected = expect(pending).rejects.toThrow();
      if (axis === 'payer') mockState.vault.activeAccount.id = 1;
      if (axis === 'session') generation++;
      const account = mockState.vault.accounts.SmartAccount[7];
      if (axis === 'target address')
        mockState.vault.accounts.SmartAccount[7] = {
          ...account,
          address: OTHER,
        };
      if (axis === 'target id')
        mockState.vault.accounts.SmartAccount[7] = { ...account, id: 8 };
      if (axis === 'target chain')
        mockState.vault.accounts.SmartAccount[7] = {
          ...account,
          smartAccount: { ...account.smartAccount, chainId: 1 },
        };
      if (axis === 'target type')
        mockState.vault.accounts.SmartAccount[7] = {
          ...account,
          type: KeyringAccountType.HDAccount,
        };
      if (axis === 'target deleted')
        delete mockState.vault.accounts.SmartAccount[7];
      gate.resolve(metadata);
      await rejected;
      expect(persistSmartAccountMetadata).not.toHaveBeenCalled();
    }
  );

  it('rejects a stale explicit payer approval before reading', async () => {
    const expected = expectedContext();
    generation++;
    await expect(controller.hydrateSmartAccount(7, expected)).rejects.toThrow(
      'PALI_TRANSACTION_CONTEXT_CHANGED'
    );
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects a target from a different chain before reading', async () => {
    mockState.vault.accounts.SmartAccount[7].smartAccount.chainId = 1;
    await expect(controller.hydrateSmartAccount(7)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });
});
