const dispatchMock = jest.fn();
const getStateMock = jest.fn();
const saveMainStateMock = jest.fn();
const permissionWriteMock = jest.fn();

jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    dispatch: (...args: any[]) => dispatchMock(...args),
    getState: () => getStateMock(),
  },
  dappPermissionPort: {
    assertWritable: () => undefined,
    // The real-store suite covers serialized I/O. These unit fixtures hold
    // individual writes to exercise the session owner's overlap guards.
    exclusive: (operation: () => Promise<unknown>) => operation(),
    read: () => ({
      dapps: getStateMock().dapp.dapps,
      pendingOrigins: getStateMock().dapp.pendingOrigins ?? [],
    }),
    write: (frame: unknown) => permissionWriteMock(frame),
    publish: (frame: any) => {
      getStateMock().dapp = {
        dapps: { ...frame.dapps },
        pendingOrigins: [...frame.pendingOrigins],
      };
      dispatchMock({ type: 'dapp/rehydrate', payload: getStateMock().dapp });
    },
  },
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

import { smartAccountAddressFixture } from '../../../../tests/fixtures/smartAccountAddress';
import { notificationManager } from '../notification-manager';
import { INetworkType, KeyringAccountType } from 'types/network';

import DAppController from './DAppController';
import { clearProviderCache } from './message-handler/provider-cache';
import { PaliEvents, PaliSyscoinEvents } from './message-handler/types';

beforeEach(() => {
  permissionWriteMock.mockReset().mockResolvedValue(undefined);
});

// Event/revocation fixtures use the same explicit approval contract as
// current callers. Their disk-boundary behavior is covered in the real-store
// connectionPersistence suite.
const connect = (controller: ReturnType<typeof DAppController>, dapp: any) => {
  const state = getStateMock();
  state.dapp ||= { dapps: {} };
  state.vault.activeNetwork ||= {
    kind: INetworkType.Ethereum,
    chainId: 57057,
  };
  const network = state.vault.activeNetwork;
  const account = state.vault.accounts[dapp.accountType][dapp.accountId];
  return controller.connect(
    { ...dapp, chain: network.kind, chainId: network.chainId },
    { address: account.address, xpub: account.xpub, network }
  );
};

describe('DAppController idempotent permission revocation', () => {
  const host = 'https://revoking.example';
  const options = {
    allowAlreadyDisconnected: true,
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
    permissionWriteMock.mockResolvedValue(undefined);
    state = {
      dapp: { dapps: {} },
      vault: {
        activeNetwork: { kind: INetworkType.Ethereum, chainId: 57057 },
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
  });

  afterEach(() => {
    errorSpy.mockRestore();
    dispatchMock.mockReset();
  });

  it('makes sequential revocations from never-connected origins read-only no-ops', async () => {
    const controller = DAppController(
      () => false,
      () => 0
    );
    for (let i = 0; i < 100; i++) {
      await expect(
        controller.revoke(host, {
          allowAlreadyDisconnected: options.allowAlreadyDisconnected,
        })
      ).resolves.toBeUndefined();
      await expect(
        controller.revoke(`https://untrusted-${i}.example`, {
          allowAlreadyDisconnected: options.allowAlreadyDisconnected,
        })
      ).resolves.toBeUndefined();
    }
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(saveMainStateMock).not.toHaveBeenCalled();
    expect(permissionWriteMock).not.toHaveBeenCalled();
    expect(notificationManager.notifyDappConnection).not.toHaveBeenCalled();
  });

  it('rejects an oversized canonical origin before creating a persisted marker', async () => {
    const origin = `https://${'a'.repeat(2048)}.example`;
    expect(new URL(origin).origin).toBe(origin);
    await expect(
      connect(
        DAppController(
          () => true,
          () => 0
        ),
        {
          host: origin,
          accountId: 0,
          accountType: KeyringAccountType.HDAccount,
          date: Date.now(),
        }
      )
    ).rejects.toThrow('complete requesting origin');
    expect(permissionWriteMock).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('rejects an explicitly required connection when it is missing', async () => {
    await expect(
      DAppController(
        () => false,
        () => 0
      ).revoke(host, { allowAlreadyDisconnected: false })
    ).rejects.toThrow('DApp not connected');
  });

  it('retires a captured approval immediately and cannot revive it through revoke rollback', async () => {
    const controller = DAppController(
      () => true,
      () => 0
    );
    await connect(controller, {
      host,
      accountId: 0,
      accountType: KeyringAccountType.HDAccount,
      date: 1,
    });
    const original = controller.get(host);
    const check = controller.captureApproval(host);
    const unobserved = controller.captureApproval(host);
    check();
    permissionWriteMock.mockRejectedValueOnce(new Error('Storage unavailable'));
    const revoke = controller.revoke(host, options);
    expect(() => check()).toThrow(/no longer current/);
    await expect(revoke).rejects.toThrow('Storage unavailable');
    expect(controller.get(host)).toBe(original);
    expect(() => check()).toThrow(/no longer current/);
    expect(() => unobserved()).toThrow(/no longer current/);
    // Restored permissions may admit a genuinely new user review.
    expect(() => controller.captureApproval(host)()).not.toThrow();
  });

  it('never transfers a captured approval to a fresh grant for the same account', async () => {
    const controller = DAppController(
      () => true,
      () => 0
    );
    const grant = {
      host,
      accountId: 0,
      accountType: KeyringAccountType.HDAccount,
      date: 1,
    };
    await connect(controller, grant);
    const check = controller.captureApproval(host);
    await controller.revoke(host, options);
    await connect(controller, grant);
    expect(() => check()).toThrow(/no longer current/);
    expect(() => controller.captureApproval(host)()).not.toThrow();
  });

  it('removes and persists a stored connection after worker restart', async () => {
    state.dapp.dapps[host] = { host, accountId: 0, accountType: 'HDAccount' };
    await DAppController(
      () => false,
      () => 0
    ).revoke(host, {
      allowAlreadyDisconnected: options.allowAlreadyDisconnected,
    });
    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'dapp/rehydrate',
      payload: { dapps: {}, pendingOrigins: [] },
    });
    expect(permissionWriteMock).toHaveBeenCalledTimes(1);
    expect(saveMainStateMock).not.toHaveBeenCalled();
  });

  it('removes and persists an active connection', async () => {
    const controller = DAppController(
      () => false,
      () => 0
    );
    await connect(controller, {
      host,
      accountId: 0,
      accountType: KeyringAccountType.HDAccount,
      chain: INetworkType.Ethereum,
      chainId: 57057,
      date: Date.now(),
    });
    dispatchMock.mockClear();
    saveMainStateMock.mockClear();
    permissionWriteMock.mockClear();

    await controller.revoke(host, {
      allowAlreadyDisconnected: options.allowAlreadyDisconnected,
    });
    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'dapp/rehydrate',
      payload: { dapps: {}, pendingOrigins: [] },
    });
    expect(permissionWriteMock).toHaveBeenCalledTimes(1);
    expect(saveMainStateMock).not.toHaveBeenCalled();
  });

  it('propagates real persistence failures for permission revocation', async () => {
    state.dapp.dapps[host] = { host, accountId: 0, accountType: 'HDAccount' };
    const failure = new Error('Storage unavailable');
    permissionWriteMock.mockRejectedValueOnce(failure);
    await expect(
      DAppController(
        () => false,
        () => 0
      ).revoke(host, {
        allowAlreadyDisconnected: options.allowAlreadyDisconnected,
      })
    ).rejects.toBe(failure);
    expect(permissionWriteMock).toHaveBeenCalledTimes(1);
    expect(saveMainStateMock).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'keeps a failed removal retryable after another save and worker restart (UTXO=%s)',
    async (isBitcoinBased) => {
      state.vault.isBitcoinBased = isBitcoinBased;
      state.vault.activeNetwork.kind = isBitcoinBased
        ? INetworkType.Syscoin
        : INetworkType.Ethereum;
      state.dapp.dapps[host] = {
        host,
        accountId: 0,
        accountType: 'HDAccount',
        chain: state.vault.activeNetwork.kind,
      };
      const controller = DAppController(
        () => false,
        () => 0
      );
      const failure = new Error('Storage unavailable');
      permissionWriteMock.mockRejectedValueOnce(failure);
      await expect(
        controller.revoke(host, {
          allowAlreadyDisconnected: options.allowAlreadyDisconnected,
        })
      ).rejects.toBe(failure);
      expect(state.dapp.dapps[host]).toBeDefined();
      expect(notificationManager.notifyDappConnection).not.toHaveBeenCalled();
      expect(chrome.scripting.executeScript).not.toHaveBeenCalled();

      // An unrelated save must keep the permission restored by the failed revoke.
      let persisted: any;
      saveMainStateMock.mockImplementationOnce(async () => {
        persisted = JSON.parse(JSON.stringify(state));
        return true;
      });
      await saveMainStateMock();
      state = persisted;
      const restarted = DAppController(
        () => false,
        () => 0
      );
      (chrome.tabs.query as jest.Mock).mockImplementation((_query, callback) =>
        callback([
          { id: 1, url: `${host}/one` },
          { id: 2, url: 'https://sub.revoking.example/one' },
          { id: 3, url: 'http://revoking.example/one' },
        ])
      );
      (chrome.scripting.executeScript as jest.Mock).mockResolvedValue([]);

      await expect(
        restarted.revoke(host, {
          allowAlreadyDisconnected: options.allowAlreadyDisconnected,
        })
      ).resolves.toBeUndefined();
      await new Promise((resolve) => setImmediate(resolve));

      expect(permissionWriteMock).toHaveBeenCalledTimes(2);
      expect(saveMainStateMock).toHaveBeenCalledTimes(1);
      expect(notificationManager.notifyDappConnection).toHaveBeenCalledTimes(1);
      expect(
        (chrome.scripting.executeScript as jest.Mock).mock.calls.map(
          ([call]) => ({
            tabId: call.target.tabId,
            args: call.args.map((value, index) =>
              index === 0 ? JSON.parse(value) : value
            ),
          })
        )
      ).toEqual([
        {
          tabId: 1,
          args: [
            {
              id: PaliEvents.accountsChanged,
              data: { method: PaliEvents.accountsChanged, params: [] },
            },
            host,
          ],
        },
        {
          tabId: 1,
          args: [
            {
              id: PaliSyscoinEvents.xpubChanged,
              data: { method: PaliSyscoinEvents.xpubChanged, params: null },
            },
            host,
          ],
        },
      ]);
    }
  );

  it('does not clear a new grant made during absent-origin reconciliation', async () => {
    state.vault.activeNetwork = {
      kind: INetworkType.Ethereum,
      chainId: 57057,
    };
    const callbacks: Array<(tabs: chrome.tabs.Tab[]) => void> = [];
    (chrome.tabs.query as jest.Mock).mockImplementation((_query, callback) => {
      callbacks.push(callback);
    });
    (chrome.scripting.executeScript as jest.Mock).mockResolvedValue([]);
    const controller = DAppController(
      () => true,
      () => 0
    );
    await controller.revoke(host, {
      allowAlreadyDisconnected: options.allowAlreadyDisconnected,
    });
    expect(callbacks).toHaveLength(2);

    await connect(controller, {
      host,
      accountId: 0,
      accountType: KeyringAccountType.HDAccount,
      chain: INetworkType.Ethereum,
      chainId: 57057,
      date: Date.now(),
    });
    // Resume only the older reconciliation lookups, after the new grant.
    callbacks[0]([{ id: 1, url: `${host}/one` } as chrome.tabs.Tab]);
    callbacks[1]([{ id: 1, url: `${host}/one` } as chrome.tabs.Tab]);
    await new Promise((resolve) => setImmediate(resolve));

    expect(
      (chrome.scripting.executeScript as jest.Mock).mock.calls.map(
        ([call]) => JSON.parse(call.args[0]).data
      )
    ).toEqual([
      {
        method: PaliEvents.accountsChanged,
        params: ['0x1111111111111111111111111111111111111111'],
      },
      { method: PaliSyscoinEvents.xpubChanged, params: null },
    ]);
    expect(state.dapp.dapps[host]).toBeDefined();
    expect(permissionWriteMock).toHaveBeenCalledTimes(2);
    expect(saveMainStateMock).not.toHaveBeenCalled();
    expect(notificationManager.notifyDappConnection).toHaveBeenCalledTimes(1);
    expect(notificationManager.notifyDappConnection).toHaveBeenCalledWith(
      host,
      true
    );
  });

  it('retires a connection within its caller-owned transaction without a separate write', () => {
    state.dapp.dapps[host] = { host, accountId: 0, accountType: 'HDAccount' };
    DAppController(
      () => false,
      () => 0
    ).retireForTransaction(host);
    expect(state.dapp.dapps[host]).toBeUndefined();
    expect(saveMainStateMock).not.toHaveBeenCalled();
    expect(permissionWriteMock).not.toHaveBeenCalled();
  });

  it('uses the strict write when an unrelated save reports no change', async () => {
    state.dapp.dapps[host] = { host, accountId: 0, accountType: 'HDAccount' };
    saveMainStateMock.mockResolvedValue(false);
    await DAppController(
      () => false,
      () => 0
    ).revoke(host, {
      allowAlreadyDisconnected: options.allowAlreadyDisconnected,
    });
    expect(permissionWriteMock).toHaveBeenCalledTimes(1);
    expect(saveMainStateMock).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'retries a failed revocation durably after restoring the permission (active=%s)',
    async (active) => {
      state.dapp.dapps[host] = {
        host,
        accountId: 0,
        accountType: 'HDAccount',
        chain: INetworkType.Ethereum,
      };
      const controller = DAppController(
        () => false,
        () => 0
      );
      if (active) {
        await connect(controller, {
          host,
          accountId: 0,
          accountType: KeyringAccountType.HDAccount,
          chain: INetworkType.Ethereum,
          chainId: 57057,
          date: Date.now(),
        });
      }
      permissionWriteMock.mockClear();
      (notificationManager.notifyDappConnection as jest.Mock).mockClear();
      (chrome.tabs.query as jest.Mock).mockImplementation((_query, callback) =>
        callback([
          { id: 1, url: `${host}/one` },
          { id: 2, url: `${host}/two` },
          { id: 3, url: 'https://another-origin.example' },
        ])
      );
      (chrome.scripting.executeScript as jest.Mock).mockResolvedValue([]);
      const failure = new Error('Storage unavailable');
      permissionWriteMock.mockRejectedValueOnce(failure);

      await expect(
        controller.revoke(host, {
          allowAlreadyDisconnected: options.allowAlreadyDisconnected,
        })
      ).rejects.toBe(failure);
      expect(state.dapp.dapps[host]).toBeDefined();
      expect(notificationManager.notifyDappConnection).not.toHaveBeenCalled();
      expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
      await controller.revoke('https://unrelated.example', {
        allowAlreadyDisconnected: options.allowAlreadyDisconnected,
      });
      expect(permissionWriteMock).toHaveBeenCalledTimes(1);
      await expect(
        controller.revoke(host, {
          allowAlreadyDisconnected: options.allowAlreadyDisconnected,
        })
      ).resolves.toBeUndefined();
      await new Promise((resolve) => setImmediate(resolve));
      expect(permissionWriteMock).toHaveBeenCalledTimes(2);
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
            .map(([call]) => JSON.parse(call.args[0]).data)
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
      await controller.revoke(host, {
        allowAlreadyDisconnected: options.allowAlreadyDisconnected,
      });
      expect(permissionWriteMock).toHaveBeenCalledTimes(2);
      expect(notificationManager.notifyDappConnection).toHaveBeenCalledTimes(1);
    }
  );

  it('coalesces concurrent same-origin revocations into one write and one notification', async () => {
    state.dapp.dapps[host] = { host, accountId: 0, accountType: 'HDAccount' };
    const controller = DAppController(
      () => false,
      () => 0
    );
    let release!: () => void;
    permissionWriteMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const first = controller.revoke(host, {
      allowAlreadyDisconnected: options.allowAlreadyDisconnected,
    });
    const second = controller.revoke(host, {
      allowAlreadyDisconnected: options.allowAlreadyDisconnected,
    });
    await Promise.resolve();
    expect(permissionWriteMock).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(notificationManager.notifyDappConnection).toHaveBeenCalledTimes(1);
    await controller.revoke(host, {
      allowAlreadyDisconnected: options.allowAlreadyDisconnected,
    });
    expect(permissionWriteMock).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    'revokes a newly reconnected permission after the earlier write settles (failed=%s)',
    async (failed) => {
      state.dapp.dapps[host] = { host, accountId: 0, accountType: 'HDAccount' };
      const controller = DAppController(
        () => false,
        () => 0
      );
      let finish!: () => void;
      permissionWriteMock.mockImplementationOnce(
        () =>
          new Promise<void>((resolve, reject) => {
            finish = () =>
              failed ? reject(new Error('first write failed')) : resolve();
          })
      );
      const first = controller.revoke(host, {
        allowAlreadyDisconnected: options.allowAlreadyDisconnected,
      });
      const firstResult = first.catch(() => undefined);
      await Promise.resolve();
      expect(state.dapp.dapps[host]).toBeUndefined();
      await connect(controller, {
        host,
        accountId: 0,
        accountType: KeyringAccountType.HDAccount,
        chain: INetworkType.Ethereum,
        chainId: 57057,
        date: Date.now(),
      });
      (notificationManager.notifyDappConnection as jest.Mock).mockClear();
      const second = controller.revoke(host, {
        allowAlreadyDisconnected: options.allowAlreadyDisconnected,
      });
      finish();
      await firstResult;
      await second;
      expect(state.dapp.dapps[host]).toBeUndefined();
      expect(permissionWriteMock).toHaveBeenCalledTimes(4);
      expect(notificationManager.notifyDappConnection).toHaveBeenCalledTimes(1);
      expect(notificationManager.notifyDappConnection).toHaveBeenCalledWith(
        host,
        false
      );
    }
  );

  it.each(['revoke', 'reset'])(
    'does not stage a candidate after reentrant %s during marker publication',
    async (change) => {
      let generation = 0;
      const controller = DAppController(
        () => true,
        () => generation
      );
      const nextOrigin = 'https://new-wallet.example';
      let retirement: Promise<void> | undefined;
      dispatchMock.mockImplementationOnce(() => {
        if (change === 'revoke') {
          retirement = controller.revoke(host, {
            allowAlreadyDisconnected: true,
          });
        } else {
          generation += 1;
          state.dapp = { dapps: {}, pendingOrigins: [nextOrigin] };
          retirement = controller.resetSessions([host]);
        }
      });
      await expect(
        connect(controller, {
          host,
          accountId: 0,
          accountType: KeyringAccountType.HDAccount,
          date: Date.now(),
        })
      ).rejects.toThrow('context changed');
      await retirement;
      expect(state.dapp.dapps[host]).toBeUndefined();
      expect(
        permissionWriteMock.mock.calls.every(
          ([frame]) => frame.dapps[host] === undefined
        )
      ).toBe(true);
      expect(notificationManager.notifyDappConnection).not.toHaveBeenCalledWith(
        host,
        true
      );
      if (change === 'reset') {
        expect(permissionWriteMock).not.toHaveBeenCalled();
        expect(state.dapp.pendingOrigins).toEqual([nextOrigin]);
      }
    }
  );

  it.each(['revoke', 'reset'])(
    'does not return stale approval after %s while committed marker cleanup waits',
    async (change) => {
      let generation = 0;
      const controller = DAppController(
        () => true,
        () => generation
      );
      let finishCleanup!: () => void;
      permissionWriteMock
        .mockResolvedValueOnce(undefined)
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              finishCleanup = resolve;
            })
        );
      const granting = connect(controller, {
        host,
        accountId: 0,
        accountType: KeyringAccountType.HDAccount,
        date: Date.now(),
      });
      const rejected = expect(granting).rejects.toThrow('context changed');
      await new Promise(setImmediate);
      // The staged grant passed its guard and committed before cleanup awaited.
      expect(state.dapp.dapps[host]).toBeDefined();
      expect(permissionWriteMock).toHaveBeenCalledTimes(2);
      const nextOrigin = 'https://new-wallet.example';
      let revocation: Promise<void> | undefined;
      if (change === 'revoke') {
        revocation = controller.revoke(host, {
          allowAlreadyDisconnected: false,
        });
      } else {
        generation += 1;
        state.dapp = { dapps: {}, pendingOrigins: [nextOrigin] };
        await controller.resetSessions([host]);
      }
      finishCleanup();
      await rejected;
      await revocation;
      expect(state.dapp.dapps[host]).toBeUndefined();
      expect(notificationManager.notifyDappConnection).not.toHaveBeenCalledWith(
        host,
        true
      );
      if (change === 'reset')
        expect(state.dapp.pendingOrigins).toEqual([nextOrigin]);
    }
  );

  it('restores failed-origin permissions without consuming pending retry capacity', async () => {
    const controller = DAppController(
      () => false,
      () => 0
    );
    const failure = new Error('Storage unavailable');
    permissionWriteMock.mockRejectedValue(failure);
    for (let i = 0; i < 256; i++) {
      const origin = `https://connected-${i}.example`;
      state.dapp.dapps[origin] = {
        host: origin,
        accountId: 0,
        accountType: 'HDAccount',
      };
      await expect(
        controller.revoke(origin, {
          allowAlreadyDisconnected: options.allowAlreadyDisconnected,
        })
      ).rejects.toBe(failure);
    }
    state.dapp.dapps[host] = { host, accountId: 0, accountType: 'HDAccount' };
    await expect(
      controller.revoke(host, {
        allowAlreadyDisconnected: options.allowAlreadyDisconnected,
      })
    ).rejects.toBe(failure);
    expect(state.dapp.dapps[host]).toBeDefined();
    expect(permissionWriteMock).toHaveBeenCalledTimes(257);
    permissionWriteMock.mockResolvedValue(undefined);
    await controller.revoke('https://connected-0.example', {
      allowAlreadyDisconnected: options.allowAlreadyDisconnected,
    });
    await controller.revoke(host, {
      allowAlreadyDisconnected: options.allowAlreadyDisconnected,
    });
    expect(state.dapp.dapps[host]).toBeUndefined();
    expect(permissionWriteMock).toHaveBeenCalledTimes(259);
  });
});

describe('DAppController account changes', () => {
  const account = {
    address: '0x2222222222222222222222222222222222222222',
    id: 1,
    xpub: 'connected-xpub',
  };
  const host = 'https://connected.example';

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
            chain: INetworkType.Ethereum,
          },
        },
      },
      vault: {
        accounts: {
          [KeyringAccountType.HDAccount]: { 1: account },
        },
        activeNetwork: {
          kind: INetworkType.Ethereum,
          chainId: 1,
          url: 'https://rpc.invalid',
        },
        isBitcoinBased: false,
      },
    });
  });

  it('clears cached provider accounts when the persisted connection changes', async () => {
    const controller = DAppController(
      () => false,
      () => 0
    );

    await controller.changeAccount(
      host,
      account.id,
      KeyringAccountType.HDAccount,
      {
        address: account.address,
        xpub: account.xpub,
        network: getStateMock().vault.activeNetwork,
      }
    );

    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          dapps: expect.objectContaining({
            [host]: expect.objectContaining({
              accountId: account.id,
              accountType: KeyringAccountType.HDAccount,
              host,
            }),
          }),
        }),
        type: 'dapp/rehydrate',
      })
    );
    expect(clearProviderCache).toHaveBeenCalledTimes(1);
    expect(saveMainStateMock).not.toHaveBeenCalled();
    expect(dispatchMock.mock.invocationCallOrder[0]).toBeLessThan(
      (clearProviderCache as jest.Mock).mock.invocationCallOrder[0]
    );
  });

  it('does not clear the cache when the requested account does not exist', async () => {
    const controller = DAppController(
      () => false,
      () => 0
    );
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();

    await expect(
      controller.changeAccount(host, 99, KeyringAccountType.HDAccount, {
        address: account.address,
        xpub: account.xpub,
        network: getStateMock().vault.activeNetwork,
      })
    ).rejects.toThrow('Account is not available');

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
      vault: {
        activeNetwork: { kind: INetworkType.Ethereum },
        accounts: {},
        isBitcoinBased: false,
      },
    });
    const controller = DAppController(
      () => false,
      () => 0
    );
    expect(controller.isConnected('https://legacy.example')).toBe(false);
    expect(controller.isConnected('http://legacy.example')).toBe(false);
    await controller.revoke('legacy.example', {
      allowAlreadyDisconnected: false,
    });
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'dapp/rehydrate',
        payload: { dapps: {}, pendingOrigins: [] },
      })
    );
  });

  it('queries event recipients using the exact approved origin', async () => {
    const account = { address: '0x1234', xpub: 'xpub' };
    getStateMock.mockReturnValue({
      vault: { accounts: { HDAccount: { 0: account } }, isBitcoinBased: false },
    });
    (chrome.runtime as any).id = 'test-extension';
    (chrome as any).tabs = {
      query: jest.fn((_query, callback) => callback([])),
    };
    (chrome as any).scripting = { executeScript: jest.fn() };
    const controller = DAppController(
      () => false,
      () => 0
    );
    await connect(controller, {
      host: 'https://example.com',
      accountId: 0,
      accountType: KeyringAccountType.HDAccount,
    } as any);
    expect(chrome.tabs.query).toHaveBeenCalledWith(
      { url: 'https://example.com/*' },
      expect.any(Function)
    );
  });

  it('checks the receiving document origin before publishing account data', async () => {
    (chrome.runtime as any).id = 'test-extension';
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
    const controller = DAppController(
      () => true,
      () => 0
    );
    await connect(controller, {
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
    const receive = (urlOrigin: string, actualOrigin = urlOrigin) => {
      const dispatchEvent = jest.fn();
      const documentWindow = {
        location: { origin: urlOrigin },
        origin: actualOrigin,
        dispatchEvent,
      };
      runInNewContext(`(${serialized})(...args)`, {
        ...coverageHelpers,
        args: injection.args,
        self: documentWindow,
        window: documentWindow,
        CustomEvent: class {
          constructor(public type: string, public options: unknown) {}
        },
      });
      return dispatchEvent;
    };
    expect(receive('https://attacker.example')).not.toHaveBeenCalled();
    expect(receive('http://example.com')).not.toHaveBeenCalled();
    expect(receive('https://example.com:8443')).not.toHaveBeenCalled();
    expect(receive('https://example.com', 'null')).not.toHaveBeenCalled();

    expect(injection.world).toBe('ISOLATED');
    expect(injection.target).toEqual({ tabId: 7 });
    const receiveApproved = receive('https://example.com');
    expect(receiveApproved).toHaveBeenCalledTimes(1);
    expect(receiveApproved).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'paliNotification',
        options: {
          detail: JSON.stringify({
            id: PaliEvents.accountsChanged,
            data: { method: PaliEvents.accountsChanged, params: ['0x1234'] },
          }),
        },
      })
    );
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
            chain: INetworkType.Ethereum,
          },
          [originB]: {
            accountId: 1,
            accountType: KeyringAccountType.HDAccount,
            chain: INetworkType.Ethereum,
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
    const instance = DAppController(
      () => unlocked,
      () => 0
    );
    instance.setup({ url: `${originA}/page`, origin: originA });
    instance.setup({ url: `${originB}/page`, origin: originB });
    return instance;
  };
  const deliver = async (instance, method, params) => {
    await instance.handleStateChange(method, { method, params });
    await new Promise((resolve) => setImmediate(resolve));
  };
  const messages = (tabId: number) =>
    (chrome.scripting.executeScript as jest.Mock).mock.calls
      .filter(([call]) => call.target.tabId === tabId)
      .map(([call]) => JSON.parse(call.args[0]).data);

  it('does not set up a connected site for an opaque document at its URL', async () => {
    const instance = DAppController(
      () => unlocked,
      () => 0
    );
    instance.setup({ url: originA + '/sandboxed', origin: 'null' });
    await deliver(instance, PaliEvents.accountsChanged, [addressA]);
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

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
    state.dapp.dapps[originA].chain = INetworkType.Syscoin;
    state.dapp.dapps[originB].chain = INetworkType.Syscoin;
    state.dapp.dapps[originA].utxoAccount = {
      slip44: 57,
      xpub: 'public-xpub-a',
    };
    state.dapp.dapps[originB].utxoAccount = {
      slip44: 57,
      xpub: 'public-xpub-b',
    };
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
      chain: INetworkType.Ethereum,
    };
    state.vault.accounts.SmartAccount = {
      0: { address: addressA, smartAccount: { chainId: 5700 } },
    };
    state.vault.accounts.HDAccount[1].address = 'sys-account-b';
    await deliver(instance, PaliEvents.accountsChanged, [addressA]);
    expect(messages(1)[0].params).toEqual([]);
    expect(messages(2)[0].params).toEqual([]);
  });

  it('withholds a granted same-chain smart address if its derivation no longer matches', async () => {
    const instance = controller();
    const { account } = smartAccountAddressFixture(57057);
    state.dapp.dapps[originA] = {
      accountId: 0,
      accountType: KeyringAccountType.SmartAccount,
      chain: INetworkType.Ethereum,
    };
    state.vault.accounts.SmartAccount = { 0: { id: 0, ...account } };
    expect(instance.getAccount(originA)?.address).toBe(account.address);
    await deliver(instance, PaliEvents.accountsChanged, [addressB]);
    expect(messages(1)[0].params).toEqual([account.address]);

    state.vault.accounts.SmartAccount[0] = {
      ...account,
      id: 0,
      address: addressA,
      xpub: addressA,
    };
    expect(instance.getAccount(originA)).toBeNull();
    await deliver(instance, PaliEvents.accountsChanged, [addressA]);
    expect(messages(1)[1].params).toEqual([]);
    expect(messages(2)[1].params).toEqual([addressB]);
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
            chain: INetworkType.Ethereum,
          },
        },
      },
      vault: {
        activeNetwork: { kind: INetworkType.Ethereum, chainId: 1 },
        accounts: { HDAccount: { 0: { address: '0x1234', xpub: 'xpub' } } },
        isBitcoinBased: false,
      },
    };
    getStateMock.mockImplementation(() => state);
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
    const controller = DAppController(
      () => false,
      () => 0
    );
    controller.setup({ url: `${origin}/page`, origin: origin });
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

    await controller.revoke(origin, { allowAlreadyDisconnected: false });
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
    await DAppController(
      () => false,
      () => 0
    ).handleStateChange(PaliEvents.addProperty, {
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
    await DAppController(
      () => false,
      () => 0
    ).handleStateChange(PaliEvents.accountsChanged, {
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
      DAppController(
        () => false,
        () => 0
      ).handleStateChange(PaliEvents.addProperty, {
        method: PaliEvents.addProperty,
        params: { type: PaliEvents.addProperty },
      })
    ).resolves.toBeUndefined();
    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
  });
});
