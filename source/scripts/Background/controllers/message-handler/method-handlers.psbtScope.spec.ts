const mockState = jest.fn();
const mockController = jest.fn();
const mockSubscribe = jest.fn();
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockState(),
    subscribe: (listener: () => void) => mockSubscribe(listener),
  },
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
import { assertSentryDappResponseCurrent } from 'utils/sentry/approvalLifetime';

import { SysMethodHandler } from './method-handlers';
import { popupPromise } from './popup-promise';

describe('extension-owned PSBT approval context', () => {
  const account = { id: 0, address: 'approved-address', xpub: 'approved-xpub' };
  const grant = { accountId: 0, accountType: KeyringAccountType.HDAccount };
  let currentGrant: typeof grant | undefined;
  beforeEach(() => {
    jest.clearAllMocks();
    currentGrant = grant;
    mockSubscribe.mockReturnValue(jest.fn());
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
      wallet: { prepareSentryFeePsbt: jest.fn().mockResolvedValue(undefined) },
      dapp: {
        get: () => currentGrant,
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
              sentryFeeAuthorization: 'attacker-token',
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
            sentryFeeAuthorization: undefined,
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
  it('binds a background-only Sentry fee token to the actual request origin', async () => {
    mockController().wallet.prepareSentryFeePsbt.mockResolvedValue(
      'trusted-token'
    );
    await new SysMethodHandler().handle({
      originalRequest: {
        host: 'site.example',
        method: 'sys_sign',
        params: [{ psbt: 'fixture' }],
      },
      methodConfig: {
        hasPopup: true,
        popupRoute: 'sign',
        popupEventName: 'sign',
      },
    } as any);
    expect(mockController().wallet.prepareSentryFeePsbt).toHaveBeenCalledWith(
      { psbt: 'fixture' },
      'site.example',
      true
    );
    expect(popupPromise).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sentryFeeAuthorization: 'trusted-token',
        }),
      })
    );
  });
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

  it('retires a request when the original grant is removed and restored during preflight', async () => {
    let finish!: () => void;
    mockController().wallet.prepareSentryFeePsbt.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      })
    );
    const pending = new SysMethodHandler().handle({
      originalRequest: {
        host: 'site.example',
        method: 'sys_sign',
        params: [{ psbt: 'fixture' }],
      },
      methodConfig: {
        hasPopup: true,
        popupRoute: 'sign',
        popupEventName: 'sign',
      },
    } as any);
    const onStoreChange = mockSubscribe.mock.calls[0][0];
    currentGrant = undefined;
    onStoreChange();
    currentGrant = grant;
    onStoreChange();
    finish();
    await expect(pending).rejects.toMatchObject({ code: 4001 });
    expect(popupPromise).not.toHaveBeenCalled();
    expect(mockSubscribe.mock.results[0].value).toHaveBeenCalledTimes(1);
  });

  describe('Sentry request and response lifetime', () => {
    const methods = [
      [
        'sys_signSentryOperation',
        'prepareSentryOperation',
        'cancelSentryApproval',
      ],
      ['sys_signSentryVote', 'prepareSentryVote', 'cancelSentryVoteApproval'],
      ['sys_linkSentryNode', 'prepareSentryLink', 'cancelSentryLink'],
    ];
    const request = (method: string) =>
      ({
        originalRequest: {
          host: 'site.example',
          method,
          params: [{ version: 1 }],
          sender: {},
        },
        methodConfig: {
          hasPopup: true,
          popupRoute: 'sentry',
          popupEventName: method,
        },
      } as any);
    beforeEach(() => {
      const { wallet, dapp } = mockController();
      wallet.getWalletSessionGeneration = () => 1;
      wallet.captureSentryFeeDisclosure = jest.fn(async (id) => ({
        disclose: jest.fn(),
        retire: () => {
          void wallet.cancelSentryApproval(id);
        },
      }));
      dapp.captureApproval = () => {
        const captured = currentGrant;
        return () => {
          if (!captured || currentGrant !== captured)
            throw new Error('Grant retired');
        };
      };
      for (const [, prepare, cancel] of methods) {
        wallet[prepare] = jest.fn().mockResolvedValue('approval-id');
        wallet[cancel] = jest.fn().mockResolvedValue(undefined);
      }
    });
    it.each(methods)(
      'keeps %s original authority through final delivery',
      async (method, prepare, cancel) => {
        const result = { version: 1, transactionHex: '0102' };
        (popupPromise as jest.Mock).mockResolvedValue(result);
        const response = await new SysMethodHandler().handle(request(method));
        expect(response).toBe(result);
        expect(mockController().wallet[prepare]).toHaveBeenCalledWith(
          { version: 1 },
          'site.example',
          ...(method === 'sys_linkSentryNode'
            ? []
            : [
                expect.objectContaining({
                  assertCurrent: expect.any(Function),
                  signal: expect.any(AbortSignal),
                }),
              ])
        );
        if (method === 'sys_signSentryOperation')
          expect(mockController().wallet[cancel]).not.toHaveBeenCalled();
        else
          expect(mockController().wallet[cancel]).toHaveBeenCalledWith(
            'approval-id'
          );
        expect(popupPromise).toHaveBeenCalledWith(
          expect.objectContaining({
            signal: expect.any(AbortSignal),
            data: { sentryApprovalId: 'approval-id' },
          })
        );
        expect(() =>
          assertSentryDappResponseCurrent(method, response)
        ).not.toThrow();
        expect(mockController().wallet[cancel]).toHaveBeenCalledWith(
          'approval-id'
        );
        expect(mockSubscribe.mock.results[0].value).toHaveBeenCalledTimes(1);
      }
    );
    it.each(methods)(
      'cancels %s admission when revocation wins its asynchronous preparation',
      async (method, prepare, cancel) => {
        let release!: (id: string) => void;
        mockController().wallet[prepare].mockReturnValue(
          new Promise<string>((resolve) => {
            release = resolve;
          })
        );
        const pending = new SysMethodHandler().handle(request(method));
        currentGrant = undefined;
        mockSubscribe.mock.calls[0][0]();
        currentGrant = grant;
        release('late-id');
        await expect(pending).rejects.toMatchObject({ code: 4001 });
        expect(popupPromise).not.toHaveBeenCalled();
        expect(mockController().wallet[cancel]).toHaveBeenCalledWith('late-id');
        expect(mockSubscribe.mock.results[0].value).toHaveBeenCalledTimes(1);
      }
    );
    it.each(methods)(
      'blocks %s already produced response when revoke occurs during final cleanup',
      async (method, _prepare, cancel) => {
        let finish!: () => void;
        let entered!: () => void;
        const enteredCleanup = new Promise<void>((resolve) => {
          entered = resolve;
        });
        if (method === 'sys_signSentryOperation') {
          mockController().wallet.captureSentryFeeDisclosure.mockImplementation(
            async (id) => {
              entered();
              await new Promise<void>((resolve) => {
                finish = resolve;
              });
              return {
                disclose: jest.fn(),
                retire: () => {
                  void mockController().wallet[cancel](id);
                },
              };
            }
          );
        } else
          mockController().wallet[cancel].mockImplementation(() => {
            entered();
            return new Promise<void>((resolve) => {
              finish = resolve;
            });
          });
        const result = { version: 1, transactionHex: '0102' };
        (popupPromise as jest.Mock).mockResolvedValue(result);
        const pending = new SysMethodHandler().handle(request(method));
        await enteredCleanup;
        currentGrant = undefined;
        mockSubscribe.mock.calls[0][0]();
        currentGrant = grant;
        finish();
        if (method === 'sys_signSentryOperation')
          await expect(pending).rejects.toThrow(/no longer current/);
        else {
          const response = await pending;
          expect(() =>
            assertSentryDappResponseCurrent(method, response)
          ).toThrow(/no longer current/);
        }
        expect(mockController().wallet[cancel]).toHaveBeenCalledWith(
          'approval-id'
        );
        expect(mockSubscribe.mock.results[0].value).toHaveBeenCalledTimes(1);
      }
    );
  });
});
