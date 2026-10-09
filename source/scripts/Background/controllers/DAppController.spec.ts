const dispatchMock = jest.fn();
const getStateMock = jest.fn();
const saveMainStateMock = jest.fn();

jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    dispatch: (...args: any[]) => dispatchMock(...args),
    getState: () => getStateMock(),
  },
  saveMainState: (...args: any[]) => saveMainStateMock(...args),
}));

jest.mock('../notification-manager', () => ({
  notificationManager: {
    notifyDappConnection: jest.fn(),
  },
}));

jest.mock('./message-handler/provider-cache', () => ({
  clearProviderCache: jest.fn(),
}));

import { runInNewContext } from 'vm';

import { KeyringAccountType } from 'types/network';

import DAppController from './DAppController';
import { clearProviderCache } from './message-handler/provider-cache';

describe('DAppController account changes', () => {
  const account = {
    address: '0x2222222222222222222222222222222222222222',
    id: 1,
    xpub: 'connected-xpub',
  };
  const host = 'connected.example';

  beforeEach(() => {
    jest.clearAllMocks();
    (chrome.runtime as any).id = 'test-extension';
    (chrome as any).tabs = {
      query: jest.fn((_query, callback) => callback([])),
    };
    (chrome as any).scripting = { executeScript: jest.fn() };
    saveMainStateMock.mockResolvedValue(undefined);
    getStateMock.mockReturnValue({
      dapp: {
        dapps: {
          [host]: {
            accountId: 0,
            accountType: KeyringAccountType.HDAccount,
            host,
          },
        },
      },
      vault: {
        accounts: {
          [KeyringAccountType.HDAccount]: { 1: account },
        },
        isBitcoinBased: false,
      },
    });
  });

  it('clears cached provider accounts when the persisted connection changes', async () => {
    const controller = DAppController();

    await controller.changeAccount(
      host,
      account.id,
      KeyringAccountType.HDAccount
    );

    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          accountId: account.id,
          accountType: KeyringAccountType.HDAccount,
          host,
        }),
        type: 'dapp/updateDAppAccount',
      })
    );
    expect(clearProviderCache).toHaveBeenCalledTimes(1);
    expect(saveMainStateMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock.mock.invocationCallOrder[0]).toBeLessThan(
      (clearProviderCache as jest.Mock).mock.invocationCallOrder[0]
    );
    expect(
      (clearProviderCache as jest.Mock).mock.invocationCallOrder[0]
    ).toBeLessThan(saveMainStateMock.mock.invocationCallOrder[0]);
  });

  it('does not clear the cache when the requested account does not exist', async () => {
    const controller = DAppController();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();

    await controller.changeAccount(host, 99, KeyringAccountType.HDAccount);

    expect(dispatchMock).not.toHaveBeenCalled();
    expect(clearProviderCache).not.toHaveBeenCalled();
    expect(saveMainStateMock).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('legacy dapp permission isolation', () => {
  it('does not use hostname-only permissions for either web origin', async () => {
    getStateMock.mockReturnValue({
      dapp: { dapps: { 'legacy.example': { host: 'legacy.example' } } },
    });
    const controller = DAppController();
    expect(controller.isConnected('https://legacy.example')).toBe(false);
    expect(controller.isConnected('http://legacy.example')).toBe(false);
    await controller.disconnect('legacy.example');
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'dapp/removeDApp',
        payload: 'legacy.example',
      })
    );
  });

  it('queries event recipients using the exact approved origin', () => {
    const account = { address: '0x1234', xpub: 'xpub' };
    getStateMock.mockReturnValue({
      vault: { accounts: { HDAccount: { 0: account } }, isBitcoinBased: false },
    });
    (chrome.runtime as any).id = 'test-extension';
    (chrome as any).tabs = {
      query: jest.fn((_query, callback) => callback([])),
    };
    (chrome as any).scripting = { executeScript: jest.fn() };
    const controller = DAppController();
    controller.connect({
      host: 'https://example.com',
      accountId: 0,
      accountType: KeyringAccountType.HDAccount,
    } as any);
    expect(chrome.tabs.query).toHaveBeenCalledWith(
      { url: 'https://example.com/*' },
      expect.any(Function)
    );
  });

  it('rechecks the receiving origin after a queried tab navigates', async () => {
    getStateMock.mockReturnValue({
      vault: {
        accounts: { HDAccount: { 0: { address: '0x1234', xpub: 'xpub' } } },
        isBitcoinBased: false,
      },
    });
    (chrome as any).tabs = {
      query: jest.fn((_query, callback) =>
        callback([{ id: 7, url: 'https://example.com/approved-page' }])
      ),
    };
    (chrome as any).scripting = {
      executeScript: jest.fn().mockResolvedValue([]),
    };
    DAppController().connect({
      host: 'https://example.com',
      accountId: 0,
      accountType: KeyringAccountType.HDAccount,
    } as any);
    await new Promise(setImmediate);
    const injection = (chrome.scripting.executeScript as jest.Mock).mock
      .calls[0][0];
    const serialized = injection.func.toString();
    // Jest adds file-scoped counters to the captured callback. Supply only
    // their bookkeeping data; keep running the actual serialized function in
    // a fresh page context without access to the controller's closure.
    const coverage = (globalThis as any).__coverage__?.[
      require.resolve('./DAppController')
    ];
    const coverageHelpers = Object.fromEntries(
      [...serialized.matchAll(/\b(cov_[\w$]+)\(\)/g)].map(([, name]) => [
        name,
        () => coverage,
      ])
    );
    const receive = (origin: string) => {
      const dispatchEvent = jest.fn();
      runInNewContext(`(${serialized})(...args)`, {
        ...coverageHelpers,
        args: injection.args,
        window: { location: { origin }, dispatchEvent },
        CustomEvent: class {
          constructor(public type: string, public options: unknown) {}
        },
      });
      return dispatchEvent;
    };
    expect(receive('https://attacker.example')).not.toHaveBeenCalled();
    expect(receive('http://example.com')).not.toHaveBeenCalled();
    expect(receive('https://example.com:8443')).not.toHaveBeenCalled();
    expect(receive('https://example.com')).toHaveBeenCalledTimes(1);
  });
});
