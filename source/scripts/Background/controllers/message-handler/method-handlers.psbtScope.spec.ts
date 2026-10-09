const mockState = jest.fn();
const mockController = jest.fn();
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState() },
}));
jest.mock('scripts/Background', () => ({
  getController: () => mockController(),
}));
jest.mock('scripts/Provider/EthProvider', () => ({ EthProvider: jest.fn() }));
jest.mock('scripts/Provider/SysProvider', () => ({ SysProvider: jest.fn() }));
jest.mock('./popup-promise', () => ({ popupPromise: jest.fn() }));
jest.mock('./request-pipeline', () => ({
  requestCoordinator: {
    coordinatePopupRequest: jest.fn((_context, open) => open()),
  },
}));

import { INetworkType, KeyringAccountType } from 'types/network';

import { SysMethodHandler } from './method-handlers';
import { popupPromise } from './popup-promise';

describe('extension-owned PSBT approval context', () => {
  const account = { id: 0, address: 'approved-address', xpub: 'approved-xpub' };
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.mockReturnValue({
      vault: {
        isBitcoinBased: true,
        activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
        activeNetwork: {
          kind: INetworkType.Syscoin,
          chainId: 57,
          url: 'approved-rpc',
        },
      },
      vaultGlobal: { activeSlip44: 57 },
    });
    mockController.mockReturnValue({
      dapp: {
        get: () => ({
          accountId: 0,
          accountType: KeyringAccountType.HDAccount,
        }),
        getAccount: () => account,
      },
    });
  });
  it.each(['sys_sign', 'sys_signAndSend'])(
    'overwrites caller authorization in %s',
    async (method) => {
      await new SysMethodHandler().handle({
        originalRequest: {
          host: 'site.example',
          method,
          params: [
            {
              psbt: 'fixture',
              approvedContext: { account: { id: 99 }, rpcUrl: 'attacker-rpc' },
            },
          ],
        },
        methodConfig: {
          hasPopup: true,
          popupRoute: 'sign',
          popupEventName: 'sign',
        },
      } as any);
      expect(popupPromise).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            approvedContext: {
              account: {
                id: 0,
                type: KeyringAccountType.HDAccount,
                address: account.address,
                xpub: account.xpub,
              },
              chainId: 57,
              kind: INetworkType.Syscoin,
              rpcUrl: 'approved-rpc',
              slip44: 57,
            },
          }),
        })
      );
    }
  );
  it('refuses a different globally active account before opening approval', async () => {
    mockState().vault.activeAccount.id = 1;
    await expect(
      new SysMethodHandler().handle({
        originalRequest: {
          host: 'site.example',
          method: 'sys_sign',
          params: [{}],
        },
        methodConfig: {
          hasPopup: true,
          popupRoute: 'sign',
          popupEventName: 'sign',
        },
      } as any)
    ).rejects.toThrow(/connected account/);
    expect(popupPromise).not.toHaveBeenCalled();
  });
});
