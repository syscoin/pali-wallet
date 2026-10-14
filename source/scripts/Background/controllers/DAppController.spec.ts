const dispatchMock = jest.fn();
const getStateMock = jest.fn();
const saveMainStateMock = jest.fn();
const persistMainStateStrictMock = jest.fn();

jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    dispatch: (...args: any[]) => dispatchMock(...args),
    getState: () => getStateMock(),
  },
  saveMainState: (...args: any[]) => saveMainStateMock(...args),
  persistMainStateStrict: (...args: any[]) =>
    persistMainStateStrictMock(...args),
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

import { notificationManager } from '../notification-manager';
import { INetworkType, KeyringAccountType } from 'types/network';

import DAppController from './DAppController';
import { clearProviderCache } from './message-handler/provider-cache';
import { PaliEvents, PaliSyscoinEvents } from './message-handler/types';

describe('DAppController idempotent permission revocation', () => {
  const host = 'https://revoking.example';
  const options = {
    allowAlreadyDisconnected: true,
    propagateErrors: true,
  };
  let state: any;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    dispatchMock.mockReset();
    errorSpy = jest.spyOn(console, 'error').mockImplementation();
    (chrome.runtime as any).id = 'test-extension';
    (chrome as any).tabs = {
      query: jest.fn((_query, callback) => callback([])),
    };
    (chrome as any).scripting = { executeScript: jest.fn() };
    saveMainStateMock.mockResolvedValue(true);
    persistMainStateStrictMock.mockResolvedValue(undefined);
    state = {
      dapp: { dapps: {} },
      vault: {
        accounts: {
          [KeyringAccountType.HDAccount]: {
            0: {
              id: 0,
              address: '0x1111111111111111111111111111111111111111',
              xpub: 'test-xpub',
            },
          },
        },
        isBitcoinBased: false,
      },
    };
    getStateMock.mockImplementation(() => state);
    dispatchMock.mockImplementation((action) => {
      if (action.type === 'dapp/removeDApp')
        delete state.dapp.dapps[action.payload];
      if (action.type === 'dapp/addDApp')
        state.dapp.dapps[action.payload.host] = action.payload;
    });
  });

  afterEach(() => {
    errorSpy.mockRestore();
    dispatchMock.mockReset();
  });

  it('makes sequential revocations from never-connected origins read-only no-ops', async () => {
    const controller = DAppController();
    for (let i = 0; i < 100; i++) {
      await expect(
        controller.disconnect(host, true, options)
      ).resolves.toBeUndefined();
      await expect(
        controller.disconnect(`https://untrusted-${i}.example`, true, options)
      ).resolves.toBeUndefined();
    }
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(saveMainStateMock).not.toHaveBeenCalled();
    expect(persistMainStateStrictMock).not.toHaveBeenCalled();
    expect(notificationManager.notifyDappConnection).not.toHaveBeenCalled();
  });

  it('preserves the legacy missing-connection rejection by default', async () => {
    await expect(DAppController().disconnect(host)).rejects.toThrow(
      'DApp not connected'
    );
  });

  it('removes and persists a stored connection after worker restart', async () => {
    state.dapp.dapps[host] = { host, accountId: 0, accountType: 'HDAccount' };
    await DAppController().disconnect(host, true, options);
    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'dapp/removeDApp',
      payload: host,
    });
    expect(persistMainStateStrictMock).toHaveBeenCalledTimes(1);
    expect(saveMainStateMock).not.toHaveBeenCalled();
  });

  it('removes and persists an active connection', async () => {
    const controller = DAppController();
    controller.connect({
      host,
      accountId: 0,
      accountType: KeyringAccountType.HDAccount,
      chain: INetworkType.Ethereum,
      chainId: 57057,
      date: Date.now(),
    });
    dispatchMock.mockClear();
    saveMainStateMock.mockClear();
    persistMainStateStrictMock.mockClear();

    await controller.disconnect(host, true, options);
    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'dapp/removeDApp',
      payload: host,
    });
    expect(persistMainStateStrictMock).toHaveBeenCalledTimes(1);
    expect(saveMainStateMock).not.toHaveBeenCalled();
  });

  it('propagates real persistence failures for permission revocation', async () => {
    state.dapp.dapps[host] = { host, accountId: 0, accountType: 'HDAccount' };
    const failure = new Error('Storage unavailable');
    persistMainStateStrictMock.mockRejectedValueOnce(failure);
    await expect(DAppController().disconnect(host, true, options)).rejects.toBe(
      failure
    );
    expect(persistMainStateStrictMock).toHaveBeenCalledTimes(1);
    expect(saveMainStateMock).not.toHaveBeenCalled();
  });

  it('preserves legacy best-effort persistence behavior by default', async () => {
    state.dapp.dapps[host] = { host, accountId: 0, accountType: 'HDAccount' };
    saveMainStateMock.mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(DAppController().disconnect(host)).resolves.toBeUndefined();
    expect(saveMainStateMock).toHaveBeenCalledTimes(1);
    expect(persistMainStateStrictMock).not.toHaveBeenCalled();
  });

  it('does not mistake a legacy false result for a durable revocation', async () => {
    state.dapp.dapps[host] = { host, accountId: 0, accountType: 'HDAccount' };
    saveMainStateMock.mockResolvedValue(false);
    await DAppController().disconnect(host, true, options);
    expect(persistMainStateStrictMock).toHaveBeenCalledTimes(1);
    expect(saveMainStateMock).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'retries a failed revocation durably after the in-memory removal (active=%s)',
    async (active) => {
      state.dapp.dapps[host] = {
        host,
        accountId: 0,
        accountType: 'HDAccount',
      };
      const controller = DAppController();
      if (active) {
        controller.connect({
          host,
          accountId: 0,
          accountType: KeyringAccountType.HDAccount,
          chain: INetworkType.Ethereum,
          chainId: 57057,
          date: Date.now(),
        });
      }
      (notificationManager.notifyDappConnection as jest.Mock).mockClear();
      (chrome.tabs.query as jest.Mock).mockImplementation((_query, callback) =>
        callback([
          { id: 1, url: `${host}/one` },
          { id: 2, url: `${host}/two` },
          { id: 3, url: 'https://another-origin.example' },
        ])
      );
      (chrome.scripting.executeScript as jest.Mock).mockResolvedValue([]);
      dispatchMock.mockImplementation((action) => {
        if (action.type === 'dapp/removeDApp') delete state.dapp.dapps[host];
      });
      const failure = new Error('Storage unavailable');
      persistMainStateStrictMock.mockRejectedValueOnce(failure);

      await expect(controller.disconnect(host, true, options)).rejects.toBe(
        failure
      );
      expect(state.dapp.dapps[host]).toBeUndefined();
      expect(notificationManager.notifyDappConnection).not.toHaveBeenCalled();
      expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
      await controller.disconnect('https://unrelated.example', true, options);
      expect(persistMainStateStrictMock).toHaveBeenCalledTimes(1);
      await expect(
        controller.disconnect(host, true, options)
      ).resolves.toBeUndefined();
      await new Promise((resolve) => setImmediate(resolve));
      expect(persistMainStateStrictMock).toHaveBeenCalledTimes(2);
      expect(saveMainStateMock).not.toHaveBeenCalled();
      expect(notificationManager.notifyDappConnection).toHaveBeenCalledTimes(1);
      expect(notificationManager.notifyDappConnection).toHaveBeenCalledWith(
        host,
        false
      );
      for (const tabId of [1, 2]) {
        expect(
          (chrome.scripting.executeScript as jest.Mock).mock.calls
            .filter(([call]) => call.target.tabId === tabId)
            .map(([call]) => call.args[0].data)
        ).toEqual([
          { method: PaliEvents.accountsChanged, params: [] },
          { method: PaliSyscoinEvents.xpubChanged, params: null },
        ]);
      }
      expect(
        (chrome.scripting.executeScript as jest.Mock).mock.calls.some(
          ([call]) => call.target.tabId === 3
        )
      ).toBe(false);
      await controller.disconnect(host, true, options);
      expect(persistMainStateStrictMock).toHaveBeenCalledTimes(2);
      expect(notificationManager.notifyDappConnection).toHaveBeenCalledTimes(1);
    }
  );

  it('coalesces concurrent same-origin revocations into one write and one notification', async () => {
    state.dapp.dapps[host] = { host, accountId: 0, accountType: 'HDAccount' };
    const controller = DAppController();
    let release!: () => void;
    persistMainStateStrictMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const first = controller.disconnect(host, true, options);
    const second = controller.disconnect(host, true, options);
    await Promise.resolve();
    expect(persistMainStateStrictMock).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(notificationManager.notifyDappConnection).toHaveBeenCalledTimes(1);
    await controller.disconnect(host, true, options);
    expect(persistMainStateStrictMock).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    'revokes a newly reconnected permission after the earlier write settles (failed=%s)',
    async (failed) => {
      state.dapp.dapps[host] = { host, accountId: 0, accountType: 'HDAccount' };
      const controller = DAppController();
      let finish!: () => void;
      persistMainStateStrictMock.mockImplementationOnce(
        () =>
          new Promise<void>((resolve, reject) => {
            finish = () =>
              failed ? reject(new Error('first write failed')) : resolve();
          })
      );
      const first = controller.disconnect(host, true, options);
      const firstResult = first.catch(() => undefined);
      await Promise.resolve();
      expect(state.dapp.dapps[host]).toBeUndefined();
      controller.connect({
        host,
        accountId: 0,
        accountType: KeyringAccountType.HDAccount,
        chain: INetworkType.Ethereum,
        chainId: 57057,
        date: Date.now(),
      });
      (notificationManager.notifyDappConnection as jest.Mock).mockClear();
      const second = controller.disconnect(host, true, options);
      finish();
      await firstResult;
      await second;
      expect(state.dapp.dapps[host]).toBeUndefined();
      expect(persistMainStateStrictMock).toHaveBeenCalledTimes(2);
      expect(notificationManager.notifyDappConnection).toHaveBeenCalledTimes(1);
      expect(notificationManager.notifyDappConnection).toHaveBeenCalledWith(
        host,
        false
      );
    }
  );

  it('bounds failed-origin retry state without removing another permission at capacity', async () => {
    const controller = DAppController();
    const failure = new Error('Storage unavailable');
    persistMainStateStrictMock.mockRejectedValue(failure);
    for (let i = 0; i < 256; i++) {
      const origin = `https://connected-${i}.example`;
      state.dapp.dapps[origin] = {
        host: origin,
        accountId: 0,
        accountType: 'HDAccount',
      };
      await expect(controller.disconnect(origin, true, options)).rejects.toBe(
        failure
      );
    }
    state.dapp.dapps[host] = { host, accountId: 0, accountType: 'HDAccount' };
    await expect(controller.disconnect(host, true, options)).rejects.toThrow(
      'Too many pending revocations'
    );
    expect(state.dapp.dapps[host]).toBeDefined();
    expect(persistMainStateStrictMock).toHaveBeenCalledTimes(256);
    persistMainStateStrictMock.mockResolvedValue(undefined);
    await controller.disconnect('https://connected-0.example', true, options);
    await controller.disconnect(host, true, options);
    expect(state.dapp.dapps[host]).toBeUndefined();
    expect(persistMainStateStrictMock).toHaveBeenCalledTimes(258);
  });
});

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
    saveMainStateMock.mockResolvedValue(true);
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

describe('per-site account notification disclosure', () => {
  const originA = 'https://site-a.example';
  const originB = 'https://site-b.example';
  const addressA = `0x${'11'.repeat(20)}`;
  const addressB = `0x${'22'.repeat(20)}`;
  let state: any;
  let unlocked: boolean;

  beforeEach(() => {
    jest.clearAllMocks();
    unlocked = true;
    state = {
      dapp: {
        dapps: {
          [originA]: {
            accountId: 0,
            accountType: KeyringAccountType.HDAccount,
          },
          [originB]: {
            accountId: 1,
            accountType: KeyringAccountType.HDAccount,
          },
        },
      },
      vault: {
        activeNetwork: {
          chainId: 57057,
          kind: INetworkType.Ethereum,
          slip44: 60,
        },
        accounts: {
          HDAccount: {
            0: { id: 0, address: addressA, xpub: 'public-xpub-a' },
            1: { id: 1, address: addressB, xpub: 'public-xpub-b' },
          },
        },
        isBitcoinBased: false,
      },
    };
    getStateMock.mockImplementation(() => state);
    (chrome.runtime as any).id = 'test-extension';
    (chrome as any).tabs = {
      query: jest.fn(({ url }, callback) =>
        callback([
          { id: url.startsWith(originA) ? 1 : 2, url: url.slice(0, -1) },
        ])
      ),
    };
    (chrome as any).scripting = {
      executeScript: jest.fn().mockResolvedValue([]),
    };
  });

  const controller = () => {
    const instance = DAppController(() => unlocked);
    instance.setup({ url: `${originA}/page` });
    instance.setup({ url: `${originB}/page` });
    return instance;
  };
  const deliver = async (instance, method, params) => {
    await instance.handleStateChange(method, { method, params });
    await new Promise((resolve) => setImmediate(resolve));
  };
  const messages = (tabId: number) =>
    (chrome.scripting.executeScript as jest.Mock).mock.calls
      .filter(([call]) => call.target.tabId === tabId)
      .map(([call]) => call.args[0].data);

  it('does not disclose the globally active EVM account to other site connections', async () => {
    await deliver(controller(), PaliEvents.accountsChanged, [addressB]);
    expect(messages(1)).toEqual([
      { method: PaliEvents.accountsChanged, params: [addressA] },
    ]);
    expect(messages(2)).toEqual([
      { method: PaliEvents.accountsChanged, params: [addressB] },
    ]);
  });

  it('projects UTXO address and xpub separately for each site', async () => {
    state.vault.activeNetwork = {
      chainId: 57,
      kind: INetworkType.Syscoin,
      slip44: 57,
    };
    state.vault.isBitcoinBased = true;
    state.vault.accounts.HDAccount[0].address = 'sys-account-a';
    state.vault.accounts.HDAccount[1].address = 'sys-account-b';
    const instance = controller();
    await deliver(instance, PaliEvents.accountsChanged, ['sys-account-b']);
    await deliver(instance, PaliEvents.xpubChanged, 'public-xpub-b');
    expect(messages(1)).toEqual([
      { method: PaliEvents.accountsChanged, params: ['sys-account-a'] },
      { method: PaliEvents.xpubChanged, params: 'public-xpub-a' },
    ]);
    expect(messages(2)).toEqual([
      { method: PaliEvents.accountsChanged, params: ['sys-account-b'] },
      { method: PaliEvents.xpubChanged, params: 'public-xpub-b' },
    ]);
  });

  it('sends no account or xpub while the wallet is locked', async () => {
    const instance = controller();
    unlocked = false;
    await deliver(instance, PaliEvents.accountsChanged, [addressB]);
    await deliver(instance, PaliEvents.xpubChanged, 'public-xpub-b');
    expect(messages(1)).toEqual([
      { method: PaliEvents.accountsChanged, params: [] },
      { method: PaliEvents.xpubChanged, params: null },
    ]);
  });

  it('rechecks a revoked connection after the asynchronous tab lookup', async () => {
    const instance = controller();
    (chrome.tabs.query as jest.Mock).mockImplementation(({ url }, callback) => {
      if (url.startsWith(originA)) delete state.dapp.dapps[originA];
      callback([
        { id: url.startsWith(originA) ? 1 : 2, url: url.slice(0, -1) },
      ]);
    });
    await deliver(instance, PaliEvents.accountsChanged, [addressB]);
    expect(messages(1)).toEqual([
      { method: PaliEvents.accountsChanged, params: [] },
    ]);
    expect(messages(2)[0].params).toEqual([addressB]);
  });

  it('does not disclose a wrong-chain smart account or UTXO-family address', async () => {
    const instance = controller();
    state.dapp.dapps[originA] = {
      accountId: 0,
      accountType: KeyringAccountType.SmartAccount,
    };
    state.vault.accounts.SmartAccount = {
      0: { address: addressA, smartAccount: { chainId: 5700 } },
    };
    state.vault.accounts.HDAccount[1].address = 'sys-account-b';
    await deliver(instance, PaliEvents.accountsChanged, [addressA]);
    expect(messages(1)[0].params).toEqual([]);
    expect(messages(2)[0].params).toEqual([]);
  });

  it('never sends an EVM account xpub and keeps unrelated public events intact', async () => {
    const instance = controller();
    await deliver(instance, PaliEvents.xpubChanged, 'public-xpub-b');
    await deliver(instance, PaliEvents.chainChanged, { chainId: '0xdee1' });
    expect(messages(1)).toEqual([
      { method: PaliEvents.xpubChanged, params: null },
      { method: PaliEvents.chainChanged, params: { chainId: '0xdee1' } },
    ]);
  });

  it('projects only public lock state fields and the site account on unlock', async () => {
    await deliver(controller(), PaliEvents.lockStateChanged, {
      isUnlocked: true,
      accounts: [addressB],
      xpub: 'public-xpub-b',
      unexpectedVaultData: 'fixture-private-data',
    });
    expect(messages(1)).toEqual([
      {
        method: PaliEvents.lockStateChanged,
        params: { isUnlocked: true, accounts: [addressA], xpub: null },
      },
    ]);
  });
});

describe('Ethereum property toggle dispatch', () => {
  const origin = 'https://connected.example';
  let state: any;

  beforeEach(() => {
    jest.clearAllMocks();
    state = {
      dapp: {
        dapps: {
          [origin]: {
            host: origin,
            accountId: 0,
            accountType: KeyringAccountType.HDAccount,
          },
        },
      },
      vault: {
        accounts: { HDAccount: { 0: { address: '0x1234', xpub: 'xpub' } } },
        isBitcoinBased: false,
      },
    };
    getStateMock.mockImplementation(() => state);
    dispatchMock.mockImplementation((action) => {
      if (action.type === 'dapp/removeDApp')
        delete state.dapp.dapps[action.payload];
    });
    saveMainStateMock.mockResolvedValue(undefined);
    (chrome.runtime as any).id = 'test-extension';
    (chrome as any).tabs = {
      query: jest.fn((_query, callback) =>
        callback([
          { id: 7, url: `${origin}/page` },
          { id: 8, url: 'http://unconnected.example/page' },
          { id: 9, url: 'chrome://settings' },
          { id: 10, url: 'chrome-extension://other/app.html' },
          { id: 11, url: 'file:///tmp/test.html' },
          { id: 12 },
          { url: 'https://missing-id.example/' },
        ])
      ),
      sendMessage: jest.fn().mockResolvedValue(undefined),
    };
    (chrome as any).scripting = {
      executeScript: jest.fn().mockResolvedValue([]),
    };
  });

  it('delivers normal remove, disconnect and re-enable to live top-frame tabs without reconnecting', async () => {
    const controller = DAppController();
    controller.setup({ url: `${origin}/page` });
    await controller.handleStateChange(PaliEvents.removeProperty, {
      method: PaliEvents.removeProperty,
      params: { type: PaliEvents.removeProperty },
    });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      7,
      {
        id: PaliEvents.removeProperty,
        data: {
          method: PaliEvents.removeProperty,
          params: { type: PaliEvents.removeProperty },
        },
      },
      { frameId: 0 }
    );

    await controller.disconnect(origin);
    await new Promise(setImmediate);
    expect(controller.getAll()).toEqual({});
    (chrome.tabs.sendMessage as jest.Mock).mockClear();
    (chrome.tabs.query as jest.Mock).mockClear();
    (chrome.scripting.executeScript as jest.Mock).mockClear();
    dispatchMock.mockClear();

    await controller.handleStateChange(PaliEvents.addProperty, {
      method: PaliEvents.addProperty,
      params: { type: PaliEvents.addProperty },
    });

    expect(chrome.tabs.query).toHaveBeenCalledWith(
      { url: ['http://*/*', 'https://*/*'] },
      expect.any(Function)
    );
    expect((chrome.tabs.sendMessage as jest.Mock).mock.calls).toEqual(
      [7, 8].map((tabId) => [
        tabId,
        {
          id: PaliEvents.addProperty,
          data: {
            method: PaliEvents.addProperty,
            params: { type: PaliEvents.addProperty },
          },
        },
        { frameId: 0 },
      ])
    );
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(controller.isConnected(origin)).toBe(false);
    expect(controller.getAll()).toEqual({});
  });

  it('broadcasts only the fixed public property notification, not attached account data', async () => {
    state.dapp.dapps = {};
    await DAppController().handleStateChange(PaliEvents.addProperty, {
      method: PaliEvents.addProperty,
      params: { type: PaliEvents.addProperty, accounts: ['private-account'] },
    });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
    expect((chrome.tabs.sendMessage as jest.Mock).mock.calls[0][1]).toEqual({
      id: PaliEvents.addProperty,
      data: {
        method: PaliEvents.addProperty,
        params: { type: PaliEvents.addProperty },
      },
    });
  });

  it('keeps account notifications scoped to connected sessions', async () => {
    state.dapp.dapps = {};
    await DAppController().handleStateChange(PaliEvents.accountsChanged, {
      method: PaliEvents.accountsChanged,
      params: ['private-account'],
    });
    expect(chrome.tabs.query).not.toHaveBeenCalled();
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('finishes other tab deliveries if one document has closed', async () => {
    (chrome.tabs.sendMessage as jest.Mock).mockRejectedValueOnce(
      new Error('Receiving end does not exist')
    );
    await expect(
      DAppController().handleStateChange(PaliEvents.addProperty, {
        method: PaliEvents.addProperty,
        params: { type: PaliEvents.addProperty },
      })
    ).resolves.toBeUndefined();
    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
  });
});
