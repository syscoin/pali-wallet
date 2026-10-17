jest.mock('..', () => ({ getController: jest.fn() }));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState, dispatch: jest.fn() },
}));
jest.mock('utils/slhDsa', () => ({
  ...jest.requireActual('utils/slhDsa'),
  startSLHDSASmartAccountValidatorSetup: jest.fn(),
}));

import { KeyringAccountType } from 'types/network';
import { startSLHDSASmartAccountValidatorSetup } from 'utils/slhDsa';

import MainController from './MainController';
import SmartAccountController from './smartAccount';

let mockState: any;
const address = `0x${'11'.repeat(20)}`;
const expectedContext = {
  account: { id: 1, type: KeyringAccountType.SmartAccount, address },
  chainId: 57057,
  rpcUrl: 'https://fixture.invalid',
  slip44: 60,
  sessionGeneration: 9,
};

describe('SLH setup approval admission', () => {
  let wallet: any;
  const derive = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    mockState = {
      vault: {
        activeAccount: { id: 1, type: KeyringAccountType.SmartAccount },
        activeNetwork: { chainId: 57057, url: 'https://fixture.invalid' },
        isBitcoinBased: false,
        accounts: {
          SmartAccount: {
            1: { id: 1, address, isSmartAccount: true, smartAccount: {} },
          },
        },
      },
      vaultGlobal: { activeSlip44: 60 },
    };
    const keyring = { isUnlocked: () => true };
    wallet = Object.create(MainController.prototype);
    wallet.walletSessionGeneration = 9;
    wallet.getActiveKeyring = () => keyring;
    wallet.assertWalletReadyForSigning = jest.fn();
    wallet.configureSLHDSASessionStateCrypto = jest.fn();
    derive.mockResolvedValue({
      derivationLabel: 'fixture',
      setupSecretHex: 'synthetic',
    });
    wallet.deriveSLHDSASetupSecretForAccount = derive;
    wallet.smartAccount = new SmartAccountController({
      getWalletSessionGeneration: () => wallet.walletSessionGeneration,
    } as any);
    jest
      .mocked(startSLHDSASmartAccountValidatorSetup)
      .mockImplementation(async ({ getSetupSecret }) => {
        await getSetupSecret();
        return { accountId: 1, status: 'running', startedAt: 1, updatedAt: 1 };
      });
  });
  const mutate = (axis: string) => {
    if (axis === 'account') mockState.vault.activeAccount.id = 2;
    if (axis === 'RPC')
      mockState.vault.activeNetwork.url = 'https://other.invalid';
    if (axis === 'session') wallet.walletSessionGeneration++;
  };
  it.each(['account', 'RPC', 'session'])(
    'rejects stale %s before setup starts',
    async (axis) => {
      mutate(axis);
      await expect(
        wallet.startSLHDSASmartAccountValidatorSetup({
          accountId: 1,
          expectedContext,
        })
      ).rejects.toThrow('PALI_TRANSACTION_CONTEXT_CHANGED');
      expect(startSLHDSASmartAccountValidatorSetup).not.toHaveBeenCalled();
      expect(derive).not.toHaveBeenCalled();
    }
  );
  it.each(['account', 'RPC', 'session'])(
    'rejects %s changed before the deferred secret request',
    async (axis) => {
      let resume!: () => void;
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      jest
        .mocked(startSLHDSASmartAccountValidatorSetup)
        .mockImplementation(async ({ getSetupSecret }) => {
          await gate;
          await getSetupSecret();
          return {
            accountId: 1,
            status: 'running',
            startedAt: 1,
            updatedAt: 1,
          };
        });
      const operation = wallet.startSLHDSASmartAccountValidatorSetup({
        accountId: 1,
        expectedContext,
      });
      const rejected = expect(operation).rejects.toThrow(
        'PALI_TRANSACTION_CONTEXT_CHANGED'
      );
      mutate(axis);
      resume();
      await rejected;
      expect(derive).not.toHaveBeenCalled();
    }
  );
  it('keeps unchanged selected setup and legacy internal callers available', async () => {
    await expect(
      wallet.startSLHDSASmartAccountValidatorSetup({
        accountId: 1,
        expectedContext,
      })
    ).resolves.toMatchObject({ status: 'running' });
    await expect(
      wallet.startSLHDSASmartAccountValidatorSetup({ accountId: 1 })
    ).resolves.toMatchObject({ status: 'running' });
    expect(derive).toHaveBeenCalledTimes(2);
  });
});
