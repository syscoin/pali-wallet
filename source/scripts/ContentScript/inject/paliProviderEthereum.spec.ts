/** @jest-environment jsdom */

import { PaliInpageProviderEth } from './paliProviderEthereum';

const ADDRESS = `0x${'11'.repeat(20)}`;
const permission = { parentCapability: 'eth_accounts' };
let approved: boolean;
let unlocked: boolean;
let failNext: { code: number; message: string } | undefined;
let denyAccountRequest: boolean;
let connectedChainId: string;
let backgroundIsBitcoinBased: boolean;
let holdChainReplies: boolean;
let pendingChainReplies: string[];
let onChainRequest: (() => void) | undefined;
let notificationListeners: EventListener[];
let postMessageMock: jest.SpyInstance;

const notify = (method: string, params: unknown) =>
  window.dispatchEvent(
    new CustomEvent('paliNotification', {
      detail: JSON.stringify({ method, params }),
    })
  );

const exposedAccounts = () =>
  approved && unlocked && !backgroundIsBitcoinBased ? [ADDRESS] : [];

const reply = (id: string, result: unknown) =>
  window.dispatchEvent(
    new CustomEvent(id, {
      detail:
        result === null || result === undefined
          ? result
          : JSON.stringify(result),
    })
  );

beforeEach(() => {
  approved = true;
  unlocked = true;
  failNext = undefined;
  denyAccountRequest = false;
  connectedChainId = '0x1';
  backgroundIsBitcoinBased = false;
  holdChainReplies = false;
  pendingChainReplies = [];
  onChainRequest = undefined;
  notificationListeners = [];
  const addEventListener = window.addEventListener.bind(window);
  jest
    .spyOn(window, 'addEventListener')
    .mockImplementation((type, listener, options) => {
      if (type === 'paliNotification')
        notificationListeners.push(listener as EventListener);
      addEventListener(type, listener, options);
    });
  jest.spyOn(console, 'debug').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  postMessageMock = jest
    .spyOn(window, 'postMessage')
    .mockImplementation((message) => {
      // Use the actual provider's window request/response transport, without a live wallet.
      queueMicrotask(() => {
        if (failNext) {
          const error = failNext;
          failNext = undefined;
          reply(message.id, { error });
          return;
        }
        switch (message.data.method) {
          case 'wallet_getProviderState':
            reply(message.id, {
              accounts: exposedAccounts(),
              chainId: connectedChainId,
              networkVersion: String(parseInt(connectedChainId, 16)),
              isBitcoinBased: backgroundIsBitcoinBased,
              isUnlocked: unlocked,
            });
            break;
          case 'eth_accounts':
            reply(message.id, exposedAccounts());
            break;
          case 'wallet_getPermissions':
            reply(message.id, approved ? [permission] : []);
            break;
          case 'wallet_revokePermissions':
            approved = false;
            notify('pali_accountsChanged', []);
            reply(message.id, null);
            break;
          case 'eth_requestAccounts':
            if (denyAccountRequest) {
              reply(message.id, {
                error: { code: 4001, message: 'User rejected' },
              });
            } else {
              approved = true;
              reply(message.id, exposedAccounts());
            }
            break;
          case 'eth_blockNumber':
            reply(message.id, '0x1');
            break;
          case 'eth_chainId':
            if (holdChainReplies) {
              pendingChainReplies.push(message.id);
              onChainRequest?.();
            } else {
              reply(message.id, connectedChainId);
            }
            break;
          case 'personal_sign':
            reply(
              message.id,
              approved && unlocked
                ? '0xsigned'
                : { error: { code: 4100, message: 'Not authorized' } }
            );
            break;
          default:
            reply(message.id, {
              error: { code: 4200, message: 'Unsupported method' },
            });
        }
      });
    });
});

afterEach(() => {
  notificationListeners.forEach((listener) =>
    window.removeEventListener('paliNotification', listener)
  );
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const initialize = async () => {
  const provider = new PaliInpageProviderEth();
  const connect = jest.fn();
  provider.on('connect', connect);
  await new Promise<void>((resolve) => provider.once('_initialized', resolve));
  return { provider, connect };
};

describe('Ethereum provider account exposure and RPC connectivity', () => {
  it('connects to public RPC without exposing unapproved accounts', async () => {
    approved = false;
    const { provider, connect } = await initialize();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith({ chainId: '0x1' });
    expect(provider.isConnected()).toBe(true);
    expect(provider.accounts).toEqual([]);
    expect(provider.selectedAddress).toBeNull();
    await expect(provider.request({ method: 'eth_accounts' })).resolves.toEqual(
      []
    );
    await expect(
      provider.request({ method: 'wallet_getPermissions' })
    ).resolves.toEqual([]);
    await expect(provider.request({ method: 'eth_blockNumber' })).resolves.toBe(
      '0x1'
    );
    await expect(
      provider.request({ method: 'personal_sign', params: ['0x00', ADDRESS] })
    ).rejects.toMatchObject({ code: 4100 });
    expect(provider.accounts).toEqual([]);
    expect(provider.isConnected()).toBe(true);
  });

  it('revokes accounts without disconnecting public RPC or emitting another connect on reapproval', async () => {
    const { provider, connect } = await initialize();
    const disconnect = jest.fn();
    const accountsChanged = jest.fn();
    provider.on('disconnect', disconnect);
    provider.on('accountsChanged', accountsChanged);
    connect.mockClear();

    await expect(
      provider.request({
        method: 'wallet_revokePermissions',
        params: [Object.fromEntries([['eth_accounts', {}]])],
      })
    ).resolves.toBeNull();
    await expect(provider.request({ method: 'eth_accounts' })).resolves.toEqual(
      []
    );
    await expect(
      provider.request({ method: 'wallet_getPermissions' })
    ).resolves.toEqual([]);
    await expect(provider.request({ method: 'eth_blockNumber' })).resolves.toBe(
      '0x1'
    );
    expect(accountsChanged.mock.calls).toEqual([[[]]]);
    expect(provider.accounts).toEqual([]);
    expect(provider.selectedAddress).toBeNull();
    expect(provider.isConnected()).toBe(true);
    expect(disconnect).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();

    await expect(
      provider.request({ method: 'eth_requestAccounts' })
    ).resolves.toEqual([ADDRESS]);
    expect(accountsChanged.mock.calls).toEqual([[[]], [[ADDRESS]]]);
    expect(provider.selectedAddress).toBe(ADDRESS);
    expect(connect).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('hides locked accounts while preserving the public RPC connection', async () => {
    const { provider } = await initialize();
    const disconnect = jest.fn();
    const accountsChanged = jest.fn();
    provider.on('disconnect', disconnect);
    provider.on('accountsChanged', accountsChanged);
    unlocked = false;
    notify('pali_unlockStateChanged', {
      isUnlocked: false,
      accounts: [ADDRESS],
    });
    expect(provider.accounts).toEqual([]);
    expect(provider.selectedAddress).toBeNull();
    expect(await provider._metamask.isUnlocked()).toBe(false);
    expect(accountsChanged).toHaveBeenCalledWith([]);
    await expect(provider.request({ method: 'eth_accounts' })).resolves.toEqual(
      []
    );
    await expect(provider.request({ method: 'eth_blockNumber' })).resolves.toBe(
      '0x1'
    );
    await expect(
      provider.request({ method: 'personal_sign', params: ['0x00', ADDRESS] })
    ).rejects.toMatchObject({ code: 4100 });
    expect(provider.isConnected()).toBe(true);
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('initializes locked accounts privately without hiding RPC connectivity', async () => {
    unlocked = false;
    const { provider } = await initialize();
    expect(provider.accounts).toEqual([]);
    expect(provider.selectedAddress).toBeNull();
    expect(provider.isConnected()).toBe(true);
    expect(await provider._metamask.isUnlocked()).toBe(false);
  });

  it('keeps existing exposed accounts when an account request is rejected', async () => {
    const { provider } = await initialize();
    const accountsChanged = jest.fn();
    const disconnect = jest.fn();
    provider.on('accountsChanged', accountsChanged);
    provider.on('disconnect', disconnect);
    denyAccountRequest = true;
    await expect(
      provider.request({ method: 'eth_requestAccounts' })
    ).rejects.toMatchObject({ code: 4001 });
    expect(provider.accounts).toEqual([ADDRESS]);
    expect(provider.selectedAddress).toBe(ADDRESS);
    expect(provider.isConnected()).toBe(true);
    expect(accountsChanged).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it.each([4001, 4100, 4200, 4901, -32603])(
    'does not disconnect for ordinary RPC rejection %s',
    async (code) => {
      const { provider } = await initialize();
      const disconnect = jest.fn();
      provider.on('disconnect', disconnect);
      failNext = { code, message: 'Request failed' };
      await expect(
        provider.request({ method: 'eth_blockNumber' })
      ).rejects.toMatchObject({ code });
      expect(provider.isConnected()).toBe(true);
      expect(provider.accounts).toEqual([ADDRESS]);
      expect(disconnect).not.toHaveBeenCalled();
    }
  );

  it.each([
    'Pali: Background script temporarily unavailable. Please try again.',
    'Pali: Connection interrupted. Reload this page and check wallet activity before retrying; the request may already have completed.',
  ])(
    'disconnects on transport loss and reconnects after a successful chain RPC: %s',
    async (message) => {
      const { provider, connect } = await initialize();
      const disconnect = jest.fn();
      const accountsChanged = jest.fn();
      provider.on('disconnect', disconnect);
      provider.on('accountsChanged', accountsChanged);
      connect.mockClear();
      failNext = { code: -32603, message };
      await expect(
        provider.request({ method: 'eth_blockNumber' })
      ).rejects.toMatchObject({ code: -32603, message });
      expect(provider.isConnected()).toBe(false);
      expect(disconnect).toHaveBeenCalledTimes(1);
      expect(disconnect).toHaveBeenCalledWith({ code: 1013, message });
      expect(accountsChanged).not.toHaveBeenCalled();

      // BaseProvider briefly caches missing-background failures; allow a fresh request.
      const time = Date.now();
      const now = jest.spyOn(Date, 'now').mockReturnValue(time + 3000);
      await expect(
        provider.request({ method: 'eth_blockNumber' })
      ).resolves.toBe('0x1');
      now.mockRestore();
      expect(provider.isConnected()).toBe(true);
      expect(connect.mock.calls).toEqual([[{ chainId: '0x1' }]]);
      await provider.request({ method: 'eth_blockNumber' });
      expect(connect).toHaveBeenCalledTimes(1);
      expect(disconnect).toHaveBeenCalledTimes(1);
    }
  );

  it('reconnects from a valid chain notification and emits chainChanged only for a changed ID', async () => {
    const { provider, connect } = await initialize();
    const chainChanged = jest.fn();
    provider.on('chainChanged', chainChanged);
    connect.mockClear();
    notify('pali_chainChanged', {
      chainId: '0x1',
      networkVersion: '1',
      isBitcoinBased: false,
    });
    expect(chainChanged).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    failNext = { code: 4900, message: 'All chains disconnected' };
    await expect(
      provider.request({ method: 'eth_blockNumber' })
    ).rejects.toMatchObject({ code: 4900 });
    expect(provider.isConnected()).toBe(false);
    notify('pali_chainChanged', {
      chainId: '0x1',
      networkVersion: '1',
      isBitcoinBased: false,
    });
    expect(provider.isConnected()).toBe(true);
    expect(connect.mock.calls).toEqual([[{ chainId: '0x1' }]]);
    expect(chainChanged).not.toHaveBeenCalled();
    notify('pali_chainChanged', {
      chainId: '0x2',
      networkVersion: '2',
      isBitcoinBased: false,
    });
    expect(chainChanged.mock.calls).toEqual([['0x2']]);
    expect(provider.chainId).toBe('0x2');
    expect(provider.networkVersion).toBe('2');
    expect(postMessageMock).toHaveBeenCalled();
  });

  it('recovers a chain ID after initialization failed without exposing accounts', async () => {
    approved = false;
    failNext = {
      code: -32603,
      message:
        'Pali: Background script temporarily unavailable. Please try again.',
    };
    const { provider, connect } = await initialize();
    const chainChanged = jest.fn();
    provider.on('chainChanged', chainChanged);
    expect(provider.isInitialized()).toBe(true);
    expect(provider.isConnected()).toBe(false);
    expect(provider.accounts).toEqual([]);
    expect(connect).not.toHaveBeenCalled();
    const now = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 3000);
    await expect(provider.request({ method: 'eth_chainId' })).resolves.toBe(
      '0x1'
    );
    now.mockRestore();
    expect(provider.chainId).toBe('0x1');
    expect(provider.isConnected()).toBe(true);
    expect(connect.mock.calls).toEqual([[{ chainId: '0x1' }]]);
    expect(chainChanged).not.toHaveBeenCalled();
    expect(provider.accounts).toEqual([]);
    expect(provider.selectedAddress).toBeNull();
  });

  it('updates a changed chain before emitting reconnect and emits chainChanged once', async () => {
    const { provider, connect } = await initialize();
    const chainChanged = jest.fn();
    const chainSeenOnConnect: Array<string | null> = [];
    provider.on('chainChanged', chainChanged);
    provider.on('connect', () => chainSeenOnConnect.push(provider.chainId));
    connect.mockClear();
    failNext = { code: 4900, message: 'All chains disconnected' };
    await expect(
      provider.request({ method: 'eth_blockNumber' })
    ).rejects.toMatchObject({ code: 4900 });
    connectedChainId = '0x2';

    await expect(provider.request({ method: 'eth_chainId' })).resolves.toBe(
      '0x2'
    );
    expect(provider.chainId).toBe('0x2');
    expect(chainSeenOnConnect).toEqual(['0x2']);
    expect(connect.mock.calls).toEqual([[{ chainId: '0x2' }]]);
    expect(chainChanged.mock.calls).toEqual([['0x2']]);
    await provider.request({ method: 'eth_chainId' });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(chainChanged).toHaveBeenCalledTimes(1);
  });

  it('returns an old chain RPC result without overwriting a newer chain notification', async () => {
    const { provider, connect } = await initialize();
    const chainChanged = jest.fn();
    provider.on('chainChanged', chainChanged);
    connect.mockClear();
    holdChainReplies = true;
    const lookupStarted = new Promise<void>((resolve) => {
      onChainRequest = resolve;
    });
    const pending = provider.request({ method: 'eth_chainId' });
    await lookupStarted;
    notify('pali_chainChanged', {
      chainId: '0x2',
      networkVersion: '2',
      isBitcoinBased: false,
    });
    reply(pendingChainReplies[0], '0x1');
    await expect(pending).resolves.toBe('0x1');
    expect(provider.chainId).toBe('0x2');
    expect(provider.networkVersion).toBe('2');
    expect(provider.isConnected()).toBe(true);
    expect(chainChanged.mock.calls).toEqual([['0x2']]);
    expect(connect).not.toHaveBeenCalled();
  });

  it('does not reconnect from a chain query dispatched before a transport failure', async () => {
    const { provider, connect } = await initialize();
    const disconnect = jest.fn();
    provider.on('disconnect', disconnect);
    connect.mockClear();
    holdChainReplies = true;
    const lookupStarted = new Promise<void>((resolve) => {
      onChainRequest = resolve;
    });
    const pending = provider.request({ method: 'eth_chainId' });
    await lookupStarted;
    failNext = { code: 4900, message: 'All chains disconnected' };
    await expect(
      provider.request({ method: 'eth_blockNumber' })
    ).rejects.toMatchObject({ code: 4900 });
    reply(pendingChainReplies[0], '0x1');
    await expect(pending).resolves.toBe('0x1');
    expect(provider.isConnected()).toBe(false);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(connect).not.toHaveBeenCalled();
  });

  it('treats a stable-chain notification as newer than a pending chain reply', async () => {
    const { provider } = await initialize();
    const chainChanged = jest.fn();
    provider.on('chainChanged', chainChanged);
    holdChainReplies = true;
    const lookupStarted = new Promise<void>((resolve) => {
      onChainRequest = resolve;
    });
    const pending = provider.request({ method: 'eth_chainId' });
    await lookupStarted;
    notify('pali_chainChanged', {
      chainId: '0x1',
      networkVersion: '1',
      isBitcoinBased: false,
    });
    reply(pendingChainReplies[0], '0x2');
    await expect(pending).resolves.toBe('0x2');
    expect(provider.chainId).toBe('0x1');
    expect(provider.networkVersion).toBe('1');
    expect(chainChanged).not.toHaveBeenCalled();
  });

  it('does not disconnect a newer chain because an older chain request fails', async () => {
    const { provider } = await initialize();
    const disconnect = jest.fn();
    provider.on('disconnect', disconnect);
    holdChainReplies = true;
    const lookupStarted = new Promise<void>((resolve) => {
      onChainRequest = resolve;
    });
    const pending = provider.request({ method: 'eth_chainId' });
    await lookupStarted;
    notify('pali_chainChanged', {
      chainId: '0x2',
      networkVersion: '2',
      isBitcoinBased: false,
    });
    reply(pendingChainReplies[0], {
      error: { code: 4900, message: 'Old transport disconnected' },
    });
    await expect(pending).rejects.toMatchObject({ code: 4900 });
    expect(provider.chainId).toBe('0x2');
    expect(provider.isConnected()).toBe(true);
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('keeps a newer recovery query shared after an older query settles', async () => {
    const { provider, connect } = await initialize();
    const chainChanged = jest.fn();
    provider.on('chainChanged', chainChanged);
    connect.mockClear();
    failNext = { code: 4900, message: 'All chains disconnected' };
    await expect(
      provider.request({ method: 'eth_blockNumber' })
    ).rejects.toMatchObject({ code: 4900 });
    holdChainReplies = true;
    const firstLookupStarted = new Promise<void>((resolve) => {
      onChainRequest = resolve;
    });
    const firstRecovery = provider.request({ method: 'eth_blockNumber' });
    await firstLookupStarted;
    failNext = { code: 4900, message: 'All chains disconnected again' };
    await expect(
      provider.request({ method: 'eth_blockNumber' })
    ).rejects.toMatchObject({ code: 4900 });
    const secondLookupStarted = new Promise<void>((resolve) => {
      onChainRequest = resolve;
    });
    const secondRecovery = provider.request({ method: 'eth_blockNumber' });
    await secondLookupStarted;
    expect(pendingChainReplies).toHaveLength(2);
    reply(pendingChainReplies[0], '0x1');
    await expect(firstRecovery).resolves.toBe('0x1');
    expect(provider.isConnected()).toBe(false);
    const concurrentRecovery = provider.request({ method: 'eth_blockNumber' });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(pendingChainReplies).toHaveLength(2);
    reply(pendingChainReplies[1], '0x2');
    await expect(
      Promise.all([secondRecovery, concurrentRecovery])
    ).resolves.toEqual(['0x1', '0x1']);
    expect(provider.isConnected()).toBe(true);
    expect(provider.chainId).toBe('0x2');
    expect(connect.mock.calls).toEqual([[{ chainId: '0x2' }]]);
    expect(chainChanged.mock.calls).toEqual([['0x2']]);
  });

  it.each([true, false])(
    'orders chain observations when the newer reply arrives first: %p',
    async (newerFirst) => {
      const { provider } = await initialize();
      const chainChanged = jest.fn();
      provider.on('chainChanged', chainChanged);
      holdChainReplies = true;
      const olderStarted = new Promise<void>((resolve) => {
        onChainRequest = resolve;
      });
      const older = provider.request({ method: 'eth_chainId' });
      await olderStarted;
      const newerStarted = new Promise<void>((resolve) => {
        onChainRequest = resolve;
      });
      const newer = provider.request({ method: 'eth_chainId' });
      await newerStarted;
      if (newerFirst) {
        reply(pendingChainReplies[1], '0x1');
        await expect(newer).resolves.toBe('0x1');
        reply(pendingChainReplies[0], '0x2');
        await expect(older).resolves.toBe('0x2');
      } else {
        reply(pendingChainReplies[0], '0x2');
        await expect(older).resolves.toBe('0x2');
        reply(pendingChainReplies[1], '0x1');
        await expect(newer).resolves.toBe('0x1');
      }
      expect(provider.chainId).toBe('0x1');
      expect(provider.networkVersion).toBe('1');
      expect(chainChanged.mock.calls).toEqual(
        newerFirst ? [] : [['0x2'], ['0x1']]
      );
    }
  );

  it('releases an RPC result on a fresh notification before obsolete metadata returns', async () => {
    const { provider, connect } = await initialize();
    const chainChanged = jest.fn();
    provider.on('chainChanged', chainChanged);
    connect.mockClear();
    failNext = { code: 4900, message: 'All chains disconnected' };
    await expect(
      provider.request({ method: 'eth_blockNumber' })
    ).rejects.toMatchObject({ code: 4900 });
    holdChainReplies = true;
    const lookupStarted = new Promise<void>((resolve) => {
      onChainRequest = resolve;
    });
    const pending = provider.request({ method: 'eth_blockNumber' });
    await lookupStarted;
    notify('pali_chainChanged', {
      chainId: '0x2',
      networkVersion: '2',
      isBitcoinBased: false,
    });
    await expect(pending).resolves.toBe('0x1');
    expect(provider.chainId).toBe('0x2');
    expect(connect.mock.calls).toEqual([[{ chainId: '0x2' }]]);
    reply(pendingChainReplies[0], '0x1');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(provider.chainId).toBe('0x2');
    expect(chainChanged.mock.calls).toEqual([['0x2']]);
  });

  it('bounds stalled recovery metadata to two seconds and ignores its late reply', async () => {
    const { provider, connect } = await initialize();
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    connect.mockClear();
    failNext = { code: 4900, message: 'All chains disconnected' };
    await expect(
      provider.request({ method: 'eth_blockNumber' })
    ).rejects.toMatchObject({ code: 4900 });
    holdChainReplies = true;
    const lookupStarted = new Promise<void>((resolve) => {
      onChainRequest = resolve;
    });
    const pending = provider.request({ method: 'eth_blockNumber' });
    let settled = false;
    pending.then(() => {
      settled = true;
    });
    await lookupStarted;
    await jest.advanceTimersByTimeAsync(1999);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe('0x1');
    expect(provider.isConnected()).toBe(false);
    reply(pendingChainReplies[0], '0x2');
    await jest.advanceTimersByTimeAsync(0);
    expect(provider.chainId).toBe('0x1');
    expect(connect).not.toHaveBeenCalled();
    holdChainReplies = false;
    connectedChainId = '0x2';
    await expect(provider.request({ method: 'eth_blockNumber' })).resolves.toBe(
      '0x1'
    );
    expect(provider.chainId).toBe('0x2');
    expect(provider.isConnected()).toBe(true);
    expect(connect.mock.calls).toEqual([[{ chainId: '0x2' }]]);
  });

  it('shares one chain lookup after an outage and adds no lookup to normal RPC calls', async () => {
    const { provider, connect } = await initialize();
    const chainChanged = jest.fn();
    provider.on('chainChanged', chainChanged);
    connect.mockClear();
    await provider.request({ method: 'eth_blockNumber' });
    expect(
      postMessageMock.mock.calls.filter(
        ([message]) => message.data.method === 'eth_chainId'
      )
    ).toHaveLength(0);
    failNext = { code: 4900, message: 'All chains disconnected' };
    await expect(
      provider.request({ method: 'eth_blockNumber' })
    ).rejects.toMatchObject({ code: 4900 });
    connectedChainId = '0x2';
    holdChainReplies = true;
    const lookupStarted = new Promise<void>((resolve) => {
      onChainRequest = resolve;
    });
    const pending = Promise.all([
      provider.request({ method: 'eth_blockNumber' }),
      provider.request({ method: 'eth_blockNumber' }),
    ]);
    await lookupStarted;
    expect(pendingChainReplies).toHaveLength(1);
    expect(provider.isConnected()).toBe(false);
    expect(connect).not.toHaveBeenCalled();
    reply(pendingChainReplies[0], connectedChainId);
    await expect(pending).resolves.toEqual(['0x1', '0x1']);
    expect(provider.chainId).toBe('0x2');
    expect(provider.isConnected()).toBe(true);
    expect(connect.mock.calls).toEqual([[{ chainId: '0x2' }]]);
    expect(chainChanged.mock.calls).toEqual([['0x2']]);
    await provider.request({ method: 'eth_blockNumber' });
    expect(
      postMessageMock.mock.calls.filter(
        ([message]) => message.data.method === 'eth_chainId'
      )
    ).toHaveLength(1);
  });

  it('preserves a successful RPC result when recovery lookup fails and permits a later recovery', async () => {
    const { provider, connect } = await initialize();
    connect.mockClear();
    failNext = { code: 4900, message: 'All chains disconnected' };
    await expect(
      provider.request({ method: 'eth_blockNumber' })
    ).rejects.toMatchObject({ code: 4900 });
    connectedChainId = '0x2';
    holdChainReplies = true;
    const lookupStarted = new Promise<void>((resolve) => {
      onChainRequest = resolve;
    });
    const pending = provider.request({ method: 'eth_blockNumber' });
    await lookupStarted;
    reply(pendingChainReplies[0], {
      error: { code: -32603, message: 'Chain query failed' },
    });
    await expect(pending).resolves.toBe('0x1');
    expect(provider.isConnected()).toBe(false);
    expect(connect).not.toHaveBeenCalled();
    expect(provider.accounts).toEqual([ADDRESS]);

    holdChainReplies = false;
    await expect(provider.request({ method: 'eth_blockNumber' })).resolves.toBe(
      '0x1'
    );
    expect(provider.isConnected()).toBe(true);
    expect(provider.chainId).toBe('0x2');
    expect(connect.mock.calls).toEqual([[{ chainId: '0x2' }]]);
    expect(
      postMessageMock.mock.calls.filter(
        ([message]) => message.data.method === 'eth_chainId'
      )
    ).toHaveLength(2);
  });

  it('preserves UTXO and EVM transition metadata without repeating stable-chain events', async () => {
    const { provider, connect } = await initialize();
    const chainChanged = jest.fn();
    provider.on('chainChanged', chainChanged);
    connect.mockClear();
    notify('pali_isBitcoinBased', { isBitcoinBased: true });
    notify('pali_chainChanged', {
      chainId: '0x39',
      networkVersion: 57,
      isBitcoinBased: true,
    });
    expect(provider.isBitcoinBased()).toBe(true);
    expect(provider.networkVersion).toBe('57');
    expect(chainChanged).not.toHaveBeenCalled();
    notify('pali_accountsChanged', ['syscoin-utxo-address']);
    expect(provider.accounts).toEqual([]);
    expect(provider.selectedAddress).toBeNull();

    notify('pali_isBitcoinBased', { isBitcoinBased: false });
    notify('pali_chainChanged', {
      chainId: '0x1',
      networkVersion: 1,
      isBitcoinBased: false,
    });
    expect(provider.isBitcoinBased()).toBe(false);
    expect(provider.networkVersion).toBe('1');
    expect(provider.chainId).toBe('0x1');
    expect(chainChanged.mock.calls).toEqual([['0x1']]);
    notify('pali_chainChanged', {
      chainId: '0x1',
      networkVersion: '1',
      isBitcoinBased: false,
    });
    expect(chainChanged).toHaveBeenCalledTimes(1);
    expect(connect).not.toHaveBeenCalled();
  });

  it('applies an initial UTXO-to-EVM chain snapshot before the first account grant', async () => {
    approved = false;
    backgroundIsBitcoinBased = true;
    connectedChainId = '0x39';
    const { provider } = await initialize();
    const accountsChanged = jest.fn();
    provider.on('accountsChanged', accountsChanged);
    expect(provider.isBitcoinBased()).toBe(true);
    expect(provider.accounts).toEqual([]);

    backgroundIsBitcoinBased = false;
    connectedChainId = '0x1';
    notify('pali_chainChanged', {
      chainId: '0x1',
      networkVersion: 1,
      isBitcoinBased: false,
    });
    expect(provider.isBitcoinBased()).toBe(false);
    await expect(
      provider.request({ method: 'eth_requestAccounts' })
    ).resolves.toEqual([ADDRESS]);
    expect(provider.accounts).toEqual([ADDRESS]);
    expect(provider.selectedAddress).toBe(ADDRESS);
    expect(accountsChanged.mock.calls).toEqual([[[ADDRESS]]]);
  });

  it.each([true, false])(
    'preserves network kind and account privacy for a partial chain notification: UTXO=%p',
    async (isBitcoinBased) => {
      backgroundIsBitcoinBased = isBitcoinBased;
      const { provider } = await initialize();
      const chainChanged = jest.fn();
      provider.on('chainChanged', chainChanged);
      notify('pali_chainChanged', { chainId: '0x2', networkVersion: '2' });
      expect(provider.isBitcoinBased()).toBe(isBitcoinBased);
      await expect(
        provider.request({ method: 'eth_accounts' })
      ).resolves.toEqual(isBitcoinBased ? [] : [ADDRESS]);
      expect(provider.accounts).toEqual(isBitcoinBased ? [] : [ADDRESS]);
      expect(provider.selectedAddress).toBe(isBitcoinBased ? null : ADDRESS);
      expect(chainChanged.mock.calls).toEqual(isBitcoinBased ? [] : [['0x2']]);
    }
  );
});
