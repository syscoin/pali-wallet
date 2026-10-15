/** @jest-environment jsdom */

import { getMethodConfig } from 'scripts/Background/controllers/message-handler/method-registry';
import {
  clearProviderCache,
  executeMethodWithCache,
} from 'scripts/Background/controllers/message-handler/provider-cache';

import { PaliInpageProviderEth } from './paliProviderEthereum';

const ADDRESS = `0x${'11'.repeat(20)}`;
const permission = { parentCapability: 'eth_accounts' };
let approved: boolean;
let unlocked: boolean;
let failNext: { code: number; message: string } | undefined;
let denyAccountRequest: boolean;
let connectedChainId: string;
let connectedNetworkVersion: string;
let backgroundIsBitcoinBased: boolean;
let holdChainReplies: boolean;
let pendingChainReplies: string[];
let onChainRequest: (() => void) | undefined;
let holdProviderStateReplies: boolean;
let pendingProviderStateReplies: string[];
let onProviderStateRequest: (() => void) | undefined;
let notifyOnGrant: boolean;
let holdAccountReplies: boolean;
let pendingAccountReplies: Array<{ id: string; result: string[] }>;
let onAccountRequest: (() => void) | undefined;
let notificationListeners: EventListener[];
let postMessageMock: jest.SpyInstance;
let useBackgroundProviderCache: boolean;
let providerStateReads: number;
let accountReads: number;

const notify = (method: string, params: unknown) =>
  window.dispatchEvent(
    new CustomEvent('paliNotification', {
      detail: JSON.stringify({ method, params }),
    })
  );

const exposedAccounts = () =>
  approved && unlocked && !backgroundIsBitcoinBased ? [ADDRESS] : [];

const providerState = () => ({
  accounts: exposedAccounts(),
  chainId: connectedChainId,
  networkVersion: connectedNetworkVersion,
  isBitcoinBased: backgroundIsBitcoinBased,
  isUnlocked: unlocked,
});

const readBackgroundProviderResult = (
  method: 'wallet_getProviderState' | 'eth_accounts'
) =>
  executeMethodWithCache(
    {
      methodConfig: getMethodConfig(method)!,
      originalRequest: {
        host: 'https://provider.example',
        method,
        sender: { tab: { id: 1 } } as chrome.runtime.MessageSender,
        type: 'METHOD_REQUEST',
      },
    },
    async () => {
      if (method === 'wallet_getProviderState') {
        providerStateReads += 1;
        return providerState();
      }
      accountReads += 1;
      return exposedAccounts();
    }
  );

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
  clearProviderCache();
  useBackgroundProviderCache = false;
  providerStateReads = 0;
  accountReads = 0;
  approved = true;
  unlocked = true;
  failNext = undefined;
  denyAccountRequest = false;
  connectedChainId = '0x1';
  connectedNetworkVersion = '1';
  backgroundIsBitcoinBased = false;
  holdChainReplies = false;
  pendingChainReplies = [];
  onChainRequest = undefined;
  holdProviderStateReplies = false;
  pendingProviderStateReplies = [];
  onProviderStateRequest = undefined;
  notifyOnGrant = false;
  holdAccountReplies = false;
  pendingAccountReplies = [];
  onAccountRequest = undefined;
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
        switch (message.data?.method) {
          case 'wallet_getProviderState':
            if (holdProviderStateReplies) {
              pendingProviderStateReplies.push(message.id);
              onProviderStateRequest?.();
            } else if (useBackgroundProviderCache) {
              void readBackgroundProviderResult('wallet_getProviderState').then(
                (state) => reply(message.id, state)
              );
            } else {
              reply(message.id, providerState());
            }
            break;
          case 'eth_accounts':
            if (holdAccountReplies) {
              pendingAccountReplies.push({
                id: message.id,
                result: exposedAccounts(),
              });
              onAccountRequest?.();
            } else if (useBackgroundProviderCache) {
              void readBackgroundProviderResult('eth_accounts').then(
                (accounts) => reply(message.id, accounts)
              );
            } else {
              reply(message.id, exposedAccounts());
            }
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
              if (notifyOnGrant)
                notify('pali_accountsChanged', exposedAccounts());
              if (holdAccountReplies) {
                pendingAccountReplies.push({
                  id: message.id,
                  result: exposedAccounts(),
                });
                onAccountRequest?.();
              } else {
                reply(message.id, exposedAccounts());
              }
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

describe('Ethereum account identity casing', () => {
  const mixed = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
  const lower = mixed.toLowerCase();
  const other = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

  async function accountReply(
    provider: PaliInpageProviderEth,
    method: string,
    accounts: string[]
  ) {
    holdAccountReplies = true;
    const started = new Promise<void>((resolve) => {
      onAccountRequest = resolve;
    });
    const pending = provider.request({ method });
    await started;
    reply(pendingAccountReplies[pendingAccountReplies.length - 1].id, accounts);
    return pending;
  }

  async function snapshotReply(
    provider: PaliInpageProviderEth,
    accounts: string[]
  ) {
    connectedChainId = provider.chainId === '0x1' ? '0x2' : '0x1';
    holdProviderStateReplies = true;
    const started = new Promise<void>((resolve) => {
      onProviderStateRequest = resolve;
    });
    const pending = provider.request({ method: 'eth_chainId' });
    await started;
    reply(pendingProviderStateReplies[pendingProviderStateReplies.length - 1], {
      ...providerState(),
      accounts,
    });
    await pending;
  }

  it.each([
    [mixed, lower],
    [lower, mixed],
  ])(
    'keeps the first grant presentation stable across RPC and snapshot casing',
    async (first, alternate) => {
      approved = false;
      const { provider } = await initialize();
      const changed = jest.fn();
      provider.on('accountsChanged', changed);
      holdAccountReplies = true;
      const started = new Promise<void>((resolve) => {
        onAccountRequest = resolve;
      });
      const grant = provider.request({ method: 'eth_requestAccounts' });
      await started;
      notify('pali_accountsChanged', [first]);
      const original = provider.accounts;
      reply(pendingAccountReplies[0].id, [alternate]);
      await expect(grant).resolves.toEqual([first]);
      await expect(
        accountReply(provider, 'eth_accounts', [alternate])
      ).resolves.toEqual([first]);
      await snapshotReply(provider, [alternate]);
      notify('pali_accountsChanged', [alternate]);
      expect(provider.accounts).toBe(original);
      expect(provider.accounts).toEqual([first]);
      expect(provider.selectedAddress).toBe(first);
      expect(changed.mock.calls).toEqual([[[first]]]);
    }
  );

  it.each(['notification', 'snapshot'])(
    'still emits real identity, order and empty transitions through %s',
    async (source) => {
      approved = false;
      const { provider } = await initialize();
      const changed = jest.fn();
      provider.on('accountsChanged', changed);
      const update = async (accounts: string[]) => {
        if (source === 'notification') notify('pali_accountsChanged', accounts);
        else await snapshotReply(provider, accounts);
      };
      await update([mixed]);
      const original = provider.accounts;
      await update([lower]);
      expect(provider.accounts).toBe(original);
      await update([other]);
      await update([other, mixed]);
      await update([lower, other.toLowerCase()]);
      await update([]);
      const empty = provider.accounts;
      await update([]);
      expect(provider.accounts).toBe(empty);
      await update([lower]);
      expect(changed.mock.calls).toEqual([
        [[mixed]],
        [[other]],
        [[other, mixed]],
        [[lower, other.toLowerCase()]],
        [[]],
        [[lower]],
      ]);
      expect(provider.selectedAddress).toBe(lower);
    }
  );

  it('does not make non-address hex strings case-insensitively equal', async () => {
    approved = false;
    const { provider } = await initialize();
    const changed = jest.fn();
    provider.on('accountsChanged', changed);
    notify('pali_accountsChanged', ['0xabc']);
    notify('pali_accountsChanged', ['0xABC']);
    expect(changed.mock.calls).toEqual([[['0xabc']], [['0xABC']]]);
  });

  it('keeps the snapshot event comparison after synchronous chain listeners', async () => {
    approved = false;
    const { provider } = await initialize();
    const changed = jest.fn();
    provider.on('accountsChanged', changed);
    provider.on('chainChanged', () => notify('pali_accountsChanged', []));
    await snapshotReply(provider, [mixed]);
    expect(provider.accounts).toEqual([]);
    expect(provider.selectedAddress).toBeNull();
    expect(changed.mock.calls).toEqual([[[]]]);
  });
});

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

  it.each([
    ['lock', false],
    ['revocation', false],
    ['lock', true],
    ['revocation', true],
  ])(
    'keeps accounts hidden after %s (recovery=%p) with the real background cache',
    async (change, recover) => {
      useBackgroundProviderCache = true;
      const { provider } = await initialize();
      expect(provider.accounts).toEqual([ADDRESS]);
      expect(providerStateReads).toBe(1);
      await expect(
        provider.request({ method: 'eth_accounts' })
      ).resolves.toEqual([ADDRESS]);
      expect(accountReads).toBe(1);
      const accountsChanged = jest.fn();
      provider.on('accountsChanged', accountsChanged);

      if (change === 'lock') {
        unlocked = false;
        notify('pali_unlockStateChanged', { isUnlocked: false, accounts: [] });
      } else {
        await provider.request({
          method: 'wallet_revokePermissions',
          params: [Object.fromEntries([['eth_accounts', {}]])],
        });
      }
      expect(provider.accounts).toEqual([]);
      if (recover) {
        failNext = { code: 4900, message: 'All chains disconnected' };
        await expect(
          provider.request({ method: 'eth_blockNumber' })
        ).rejects.toMatchObject({ code: 4900 });

        await expect(provider.request({ method: 'eth_chainId' })).resolves.toBe(
          '0x1'
        );
      }
      expect(provider.accounts).toEqual([]);
      await expect(
        provider.request({ method: 'eth_accounts' })
      ).resolves.toEqual([]);
      expect(provider.isConnected()).toBe(true);
      expect(provider.accounts).toEqual([]);
      expect(provider.selectedAddress).toBeNull();
      expect(await provider._metamask.isUnlocked()).toBe(change !== 'lock');
      expect(accountsChanged.mock.calls).toEqual([[[]]]);
      expect(providerStateReads).toBe(recover ? 2 : 1);
      expect(accountReads).toBe(2);

      if (change === 'lock') {
        unlocked = true;
        notify('pali_unlockStateChanged', {
          isUnlocked: true,
          accounts: [ADDRESS],
        });
      } else {
        notifyOnGrant = true;
        await expect(
          provider.request({ method: 'eth_requestAccounts' })
        ).resolves.toEqual([ADDRESS]);
      }
      await expect(
        provider.request({ method: 'eth_accounts' })
      ).resolves.toEqual([ADDRESS]);
      expect(provider.selectedAddress).toBe(ADDRESS);
      expect(await provider._metamask.isUnlocked()).toBe(true);
      expect(accountsChanged.mock.calls).toEqual([[[]], [[ADDRESS]]]);
      expect(accountReads).toBe(3);
    }
  );

  it('recovers a current unlock and first grant with the real background cache', async () => {
    useBackgroundProviderCache = true;
    approved = false;
    unlocked = false;
    const { provider } = await initialize();
    expect(provider.accounts).toEqual([]);
    expect(providerStateReads).toBe(1);
    await expect(provider.request({ method: 'eth_accounts' })).resolves.toEqual(
      []
    );
    unlocked = true;
    notify('pali_unlockStateChanged', { isUnlocked: true, accounts: [] });
    const accountsChanged = jest.fn();
    provider.on('accountsChanged', accountsChanged);
    notifyOnGrant = true;
    failNext = { code: 4900, message: 'All chains disconnected' };
    await expect(
      provider.request({ method: 'eth_blockNumber' })
    ).rejects.toMatchObject({ code: 4900 });

    await expect(
      provider.request({ method: 'eth_requestAccounts' })
    ).resolves.toEqual([ADDRESS]);
    await expect(provider.request({ method: 'eth_accounts' })).resolves.toEqual(
      [ADDRESS]
    );
    expect(provider.isConnected()).toBe(true);
    expect(provider.accounts).toEqual([ADDRESS]);
    expect(provider.selectedAddress).toBe(ADDRESS);
    expect(await provider._metamask.isUnlocked()).toBe(true);
    expect(accountsChanged.mock.calls).toEqual([[[ADDRESS]]]);
    expect(providerStateReads).toBe(2);
    expect(accountReads).toBe(2);
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
    const observedMetadata: unknown[] = [];
    const observe = () =>
      observedMetadata.push({
        chainId: provider.chainId,
        networkVersion: provider.networkVersion,
        syncVersion: (provider.send({ method: 'net_version' }) as any).result,
      });
    provider.on('chainChanged', chainChanged);
    provider.on('chainChanged', observe);
    provider.on('connect', observe);
    connect.mockClear();
    failNext = { code: 4900, message: 'All chains disconnected' };
    await expect(
      provider.request({ method: 'eth_blockNumber' })
    ).rejects.toMatchObject({ code: 4900 });
    connectedChainId = '0x2';
    connectedNetworkVersion = '2002';

    await expect(provider.request({ method: 'eth_chainId' })).resolves.toBe(
      '0x2'
    );
    expect(provider.chainId).toBe('0x2');
    expect(provider.networkVersion).toBe('2002');
    expect(observedMetadata).toEqual([
      { chainId: '0x2', networkVersion: '2002', syncVersion: '2002' },
      { chainId: '0x2', networkVersion: '2002', syncVersion: '2002' },
    ]);
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
    holdProviderStateReplies = true;
    const firstLookupStarted = new Promise<void>((resolve) => {
      onProviderStateRequest = resolve;
    });
    const firstRecovery = provider.request({ method: 'eth_blockNumber' });
    await firstLookupStarted;
    failNext = { code: 4900, message: 'All chains disconnected again' };
    await expect(
      provider.request({ method: 'eth_blockNumber' })
    ).rejects.toMatchObject({ code: 4900 });
    const secondLookupStarted = new Promise<void>((resolve) => {
      onProviderStateRequest = resolve;
    });
    const secondRecovery = provider.request({ method: 'eth_blockNumber' });
    await secondLookupStarted;
    expect(pendingProviderStateReplies).toHaveLength(2);
    reply(pendingProviderStateReplies[0], providerState());
    await expect(firstRecovery).resolves.toBe('0x1');
    expect(provider.isConnected()).toBe(false);
    const concurrentRecovery = provider.request({ method: 'eth_blockNumber' });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(pendingProviderStateReplies).toHaveLength(2);
    reply(pendingProviderStateReplies[1], {
      ...providerState(),
      chainId: '0x2',
      networkVersion: '2002',
    });
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
        connectedChainId = '0x2';
        connectedNetworkVersion = '2002';
        reply(pendingChainReplies[0], '0x2');
        await expect(older).resolves.toBe('0x2');
        connectedChainId = '0x1';
        connectedNetworkVersion = '1';
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
    holdProviderStateReplies = true;
    const lookupStarted = new Promise<void>((resolve) => {
      onProviderStateRequest = resolve;
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
    reply(pendingProviderStateReplies[0], providerState());
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
    holdProviderStateReplies = true;
    const lookupStarted = new Promise<void>((resolve) => {
      onProviderStateRequest = resolve;
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
    reply(pendingProviderStateReplies[0], {
      ...providerState(),
      chainId: '0x2',
      networkVersion: '2002',
    });
    await jest.advanceTimersByTimeAsync(0);
    expect(provider.chainId).toBe('0x1');
    expect(connect).not.toHaveBeenCalled();
    holdProviderStateReplies = false;
    connectedChainId = '0x2';
    connectedNetworkVersion = '2002';
    await expect(provider.request({ method: 'eth_blockNumber' })).resolves.toBe(
      '0x1'
    );
    expect(provider.chainId).toBe('0x2');
    expect(provider.isConnected()).toBe(true);
    expect(connect.mock.calls).toEqual([[{ chainId: '0x2' }]]);
  });

  it('shares one local snapshot after an outage and adds no lookup to normal RPC calls', async () => {
    const { provider, connect } = await initialize();
    const chainChanged = jest.fn();
    provider.on('chainChanged', chainChanged);
    connect.mockClear();
    await provider.request({ method: 'eth_blockNumber' });
    expect(
      postMessageMock.mock.calls.filter(
        ([message]) => message.data.method === 'wallet_getProviderState'
      )
    ).toHaveLength(1);
    failNext = { code: 4900, message: 'All chains disconnected' };
    await expect(
      provider.request({ method: 'eth_blockNumber' })
    ).rejects.toMatchObject({ code: 4900 });
    connectedChainId = '0x2';
    connectedNetworkVersion = '2002';
    holdProviderStateReplies = true;
    const lookupStarted = new Promise<void>((resolve) => {
      onProviderStateRequest = resolve;
    });
    const pending = Promise.all([
      provider.request({ method: 'eth_blockNumber' }),
      provider.request({ method: 'eth_blockNumber' }),
    ]);
    await lookupStarted;
    expect(pendingProviderStateReplies).toHaveLength(1);
    expect(provider.isConnected()).toBe(false);
    expect(connect).not.toHaveBeenCalled();
    reply(pendingProviderStateReplies[0], providerState());
    await expect(pending).resolves.toEqual(['0x1', '0x1']);
    expect(provider.chainId).toBe('0x2');
    expect(provider.isConnected()).toBe(true);
    expect(connect.mock.calls).toEqual([[{ chainId: '0x2' }]]);
    expect(chainChanged.mock.calls).toEqual([['0x2']]);
    await provider.request({ method: 'eth_blockNumber' });
    expect(
      postMessageMock.mock.calls.filter(
        ([message]) => message.data.method === 'wallet_getProviderState'
      )
    ).toHaveLength(2);
  });

  it('preserves a successful RPC result when recovery lookup fails and permits a later recovery', async () => {
    const { provider, connect } = await initialize();
    connect.mockClear();
    failNext = { code: 4900, message: 'All chains disconnected' };
    await expect(
      provider.request({ method: 'eth_blockNumber' })
    ).rejects.toMatchObject({ code: 4900 });
    connectedChainId = '0x2';
    connectedNetworkVersion = '2002';
    holdProviderStateReplies = true;
    const lookupStarted = new Promise<void>((resolve) => {
      onProviderStateRequest = resolve;
    });
    const pending = provider.request({ method: 'eth_blockNumber' });
    await lookupStarted;
    reply(pendingProviderStateReplies[0], {
      error: { code: -32603, message: 'Chain query failed' },
    });
    await expect(pending).resolves.toBe('0x1');
    expect(provider.isConnected()).toBe(false);
    expect(connect).not.toHaveBeenCalled();
    expect(provider.accounts).toEqual([ADDRESS]);

    holdProviderStateReplies = false;
    await expect(provider.request({ method: 'eth_blockNumber' })).resolves.toBe(
      '0x1'
    );
    expect(provider.isConnected()).toBe(true);
    expect(provider.chainId).toBe('0x2');
    expect(connect.mock.calls).toEqual([[{ chainId: '0x2' }]]);
    expect(
      postMessageMock.mock.calls.filter(
        ([message]) => message.data.method === 'wallet_getProviderState'
      )
    ).toHaveLength(3);
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

  it('recovers an initial EVM grant when the unconnected origin missed network notifications', async () => {
    approved = false;
    backgroundIsBitcoinBased = true;
    connectedChainId = '0x39';
    const { provider } = await initialize();
    const accountsChanged = jest.fn();
    provider.on('accountsChanged', accountsChanged);
    backgroundIsBitcoinBased = false;
    connectedChainId = '0x7a69';
    notifyOnGrant = true;
    await expect(provider.request({ method: 'eth_chainId' })).resolves.toBe(
      '0x7a69'
    );
    expect(provider.isBitcoinBased()).toBe(false);
    await expect(
      provider.request({ method: 'eth_requestAccounts' })
    ).resolves.toEqual([ADDRESS]);
    expect(provider.isBitcoinBased()).toBe(false);
    expect(provider.accounts).toEqual([ADDRESS]);
    expect(provider.selectedAddress).toBe(ADDRESS);
    expect(accountsChanged.mock.calls).toEqual([[[ADDRESS]]]);
    expect(
      postMessageMock.mock.calls.filter(
        ([message]) => message.data.method === 'wallet_getProviderState'
      )
    ).toHaveLength(2);
    await provider.request({ method: 'eth_accounts' });
    expect(
      postMessageMock.mock.calls.filter(
        ([message]) => message.data.method === 'wallet_getProviderState'
      )
    ).toHaveLength(2);
  });

  it.each(['lock', 'revocation'])(
    'uses the current snapshot disclosure after %s during a first grant',
    async (change) => {
      approved = false;
      backgroundIsBitcoinBased = true;
      const { provider } = await initialize();
      const accountsChanged = jest.fn();
      provider.on('accountsChanged', accountsChanged);
      backgroundIsBitcoinBased = false;
      holdProviderStateReplies = true;
      const snapshotStarted = new Promise<void>((resolve) => {
        onProviderStateRequest = resolve;
      });
      const pending = provider.request({ method: 'eth_requestAccounts' });
      await snapshotStarted;
      if (change === 'lock') unlocked = false;
      else approved = false;
      reply(pendingProviderStateReplies[0], providerState());
      await expect(pending).resolves.toEqual([]);
      expect(provider.isBitcoinBased()).toBe(false);
      expect(provider.accounts).toEqual([]);
      expect(provider.selectedAddress).toBeNull();
      expect(accountsChanged).not.toHaveBeenCalled();
      expect(await provider._metamask.isUnlocked()).toBe(change !== 'lock');
    }
  );

  it('does not let an old account snapshot replace newer network and account notifications', async () => {
    approved = false;
    backgroundIsBitcoinBased = true;
    const { provider } = await initialize();
    backgroundIsBitcoinBased = false;
    holdProviderStateReplies = true;
    const snapshotStarted = new Promise<void>((resolve) => {
      onProviderStateRequest = resolve;
    });
    const pending = provider.request({ method: 'eth_requestAccounts' });
    await snapshotStarted;
    const oldSnapshot = providerState();
    const newerAccount = `0x${'22'.repeat(20)}`;
    notify('pali_chainChanged', {
      chainId: '0x3',
      networkVersion: '3',
      isBitcoinBased: false,
    });
    notify('pali_accountsChanged', [newerAccount]);
    reply(pendingProviderStateReplies[0], oldSnapshot);
    await expect(pending).resolves.toEqual([newerAccount]);
    expect(provider.chainId).toBe('0x3');
    expect(provider.accounts).toEqual([newerAccount]);
    expect(provider.selectedAddress).toBe(newerAccount);
  });

  it.each(['lock', 'revocation'])(
    'rejects a captured old account snapshot after a %s notification',
    async (change) => {
      approved = false;
      backgroundIsBitcoinBased = true;
      const { provider } = await initialize();
      backgroundIsBitcoinBased = false;
      holdProviderStateReplies = true;
      const snapshotStarted = new Promise<void>((resolve) => {
        onProviderStateRequest = resolve;
      });
      const pending = provider.request({ method: 'eth_requestAccounts' });
      await snapshotStarted;
      const oldSnapshot = providerState();
      expect(oldSnapshot.accounts).toEqual([ADDRESS]);
      expect(oldSnapshot.isUnlocked).toBe(true);
      if (change === 'lock') {
        notify('pali_unlockStateChanged', { isUnlocked: false, accounts: [] });
      } else {
        notify('pali_accountsChanged', []);
      }
      reply(pendingProviderStateReplies[0], oldSnapshot);
      await expect(pending).resolves.toEqual([]);
      expect(provider.accounts).toEqual([]);
      expect(provider.selectedAddress).toBeNull();
      expect(provider.isBitcoinBased()).toBe(true);
      expect(await provider._metamask.isUnlocked()).toBe(change !== 'lock');
    }
  );

  it('rejects an old unlocked snapshot after a lock notification that matches the cached locked state', async () => {
    approved = false;
    unlocked = false;
    backgroundIsBitcoinBased = true;
    const { provider } = await initialize();
    expect(await provider._metamask.isUnlocked()).toBe(false);
    backgroundIsBitcoinBased = false;
    unlocked = true;
    holdProviderStateReplies = true;
    const snapshotStarted = new Promise<void>((resolve) => {
      onProviderStateRequest = resolve;
    });
    const pending = provider.request({ method: 'eth_requestAccounts' });
    await snapshotStarted;
    const oldSnapshot = providerState();
    notify('pali_unlockStateChanged', { isUnlocked: false, accounts: [] });
    reply(pendingProviderStateReplies[0], oldSnapshot);
    await expect(pending).resolves.toEqual([]);
    expect(await provider._metamask.isUnlocked()).toBe(false);
    expect(provider.accounts).toEqual([]);
    expect(provider.selectedAddress).toBeNull();
  });

  it.each([
    ['eth_accounts', 'lock'],
    ['eth_accounts', 'revocation'],
    ['eth_requestAccounts', 'lock'],
    ['eth_requestAccounts', 'revocation'],
  ])(
    'does not return or restore a delayed %s reply after %s',
    async (method, change) => {
      const { provider } = await initialize();
      holdAccountReplies = true;
      const accountRequestStarted = new Promise<void>((resolve) => {
        onAccountRequest = resolve;
      });
      const pending = provider.request({ method });
      await accountRequestStarted;
      const oldReply = pendingAccountReplies[0];
      expect(oldReply.result).toEqual([ADDRESS]);
      if (change === 'lock')
        notify('pali_unlockStateChanged', { isUnlocked: false, accounts: [] });
      else notify('pali_accountsChanged', []);
      reply(oldReply.id, oldReply.result);
      await expect(pending).resolves.toEqual([]);
      expect(provider.accounts).toEqual([]);
      expect(provider.selectedAddress).toBeNull();
      expect(provider.isConnected()).toBe(true);
    }
  );

  it('bounds first-grant metadata to two seconds and ignores a snapshot arriving after timeout', async () => {
    approved = false;
    backgroundIsBitcoinBased = true;
    const { provider } = await initialize();
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    backgroundIsBitcoinBased = false;
    holdProviderStateReplies = true;
    const snapshotStarted = new Promise<void>((resolve) => {
      onProviderStateRequest = resolve;
    });
    const pending = provider.request({ method: 'eth_requestAccounts' });
    let settled = false;
    pending.then(() => {
      settled = true;
    });
    await snapshotStarted;
    await jest.advanceTimersByTimeAsync(1999);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual([]);
    expect(provider.isBitcoinBased()).toBe(true);
    expect(provider.accounts).toEqual([]);
    reply(pendingProviderStateReplies[0], providerState());
    await jest.advanceTimersByTimeAsync(0);
    expect(provider.isBitcoinBased()).toBe(true);
    expect(provider.accounts).toEqual([]);
    holdProviderStateReplies = false;
    await expect(provider.request({ method: 'eth_accounts' })).resolves.toEqual(
      [ADDRESS]
    );
    expect(provider.isBitcoinBased()).toBe(false);
    expect(provider.accounts).toEqual([ADDRESS]);
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
  it('commits initial network metadata and disclosure before connect listeners run', async () => {
    connectedChainId = '0x2';
    connectedNetworkVersion = '9002';
    const provider = new PaliInpageProviderEth();
    const seen: unknown[] = [];
    provider.on('connect', () =>
      seen.push({
        chainId: provider.chainId,
        networkVersion: provider.networkVersion,
        syncVersion: (provider.send({ method: 'net_version' }) as any).result,
        accounts: [...provider.accounts],
        selectedAddress: provider.selectedAddress,
      })
    );
    await new Promise<void>((resolve) =>
      provider.once('_initialized', resolve)
    );
    expect(seen).toEqual([
      {
        chainId: '0x2',
        networkVersion: '9002',
        syncVersion: '9002',
        accounts: [ADDRESS],
        selectedAddress: ADDRESS,
      },
    ]);
  });

  it('confirms a changed scalar chain using full current metadata before chain events', async () => {
    const { provider } = await initialize();
    const seen: unknown[] = [];
    provider.on('chainChanged', (chainId) =>
      seen.push({
        chainId,
        publicChainId: provider.chainId,
        networkVersion: provider.networkVersion,
        syncVersion: (provider.send({ method: 'net_version' }) as any).result,
        accounts: [...provider.accounts],
        selectedAddress: provider.selectedAddress,
      })
    );
    holdProviderStateReplies = true;
    const started = new Promise<void>((resolve) => {
      onProviderStateRequest = resolve;
    });
    connectedChainId = '0x2';
    const pending = provider.request({ method: 'eth_chainId' });
    await started;
    expect(provider.chainId).toBe('0x1');
    expect(provider.networkVersion).toBe('1');
    expect(seen).toEqual([]);
    // The wallet can move again between the scalar response and the local snapshot.
    reply(pendingProviderStateReplies[0], {
      ...providerState(),
      chainId: '0x3',
      networkVersion: '9003',
      isUnlocked: false,
      accounts: [ADDRESS],
    });
    await expect(pending).resolves.toBe('0x2');
    expect(seen).toEqual([
      {
        chainId: '0x3',
        publicChainId: '0x3',
        networkVersion: '9003',
        syncVersion: '9003',
        accounts: [],
        selectedAddress: null,
      },
    ]);
    expect(await provider._metamask.isUnlocked()).toBe(false);
  });

  it('rejects delayed full metadata after a newer notification without restoring networkVersion or disclosure', async () => {
    const { provider } = await initialize();
    const changed = jest.fn();
    provider.on('chainChanged', changed);
    holdProviderStateReplies = true;
    const started = new Promise<void>((resolve) => {
      onProviderStateRequest = resolve;
    });
    connectedChainId = '0x2';
    connectedNetworkVersion = '9002';
    const pending = provider.request({ method: 'eth_chainId' });
    await started;
    const oldSnapshot = providerState();
    notify('pali_chainChanged', {
      chainId: '0x3',
      networkVersion: '9003',
      isBitcoinBased: false,
    });
    notify('pali_accountsChanged', []);
    await expect(pending).resolves.toBe('0x2');
    reply(pendingProviderStateReplies[0], oldSnapshot);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(provider.chainId).toBe('0x3');
    expect(provider.networkVersion).toBe('9003');
    expect((provider.send({ method: 'net_version' }) as any).result).toBe(
      '9003'
    );
    expect(provider.accounts).toEqual([]);
    expect(changed.mock.calls).toEqual([['0x3']]);
  });

  it('lets a newer unchanged scalar observation supersede an older pending full snapshot', async () => {
    const { provider } = await initialize();
    const changed = jest.fn();
    provider.on('chainChanged', changed);
    connectedChainId = '0x2';
    connectedNetworkVersion = '9002';
    holdProviderStateReplies = true;
    const started = new Promise<void>((resolve) => {
      onProviderStateRequest = resolve;
    });
    const older = provider.request({ method: 'eth_chainId' });
    await started;
    const oldSnapshot = providerState();
    connectedChainId = '0x1';
    connectedNetworkVersion = '1';
    await expect(provider.request({ method: 'eth_chainId' })).resolves.toBe(
      '0x1'
    );
    reply(pendingProviderStateReplies[0], oldSnapshot);
    await expect(older).resolves.toBe('0x2');
    expect(provider.chainId).toBe('0x1');
    expect(provider.networkVersion).toBe('1');
    expect(changed).not.toHaveBeenCalled();
  });

  it.each(['eth_chainId', 'eth_blockNumber', 'eth_accounts'])(
    'recovers both network identifiers after an outage through %s',
    async (method) => {
      const { provider, connect } = await initialize();
      connect.mockClear();
      failNext = { code: 4900, message: 'All chains disconnected' };
      await expect(
        provider.request({ method: 'eth_blockNumber' })
      ).rejects.toMatchObject({ code: 4900 });
      connectedChainId = '0x2';
      connectedNetworkVersion = '9002';
      const seen: unknown[] = [];
      const observe = () =>
        seen.push({
          chainId: provider.chainId,
          networkVersion: provider.networkVersion,
          syncVersion: (provider.send({ method: 'net_version' }) as any).result,
        });
      provider.on('connect', observe);
      provider.on('chainChanged', observe);
      await expect(provider.request({ method })).resolves.toEqual(
        method === 'eth_chainId'
          ? '0x2'
          : method === 'eth_accounts'
          ? [ADDRESS]
          : '0x1'
      );
      expect(seen).toEqual([
        { chainId: '0x2', networkVersion: '9002', syncVersion: '9002' },
        { chainId: '0x2', networkVersion: '9002', syncVersion: '9002' },
      ]);
      const count = () =>
        postMessageMock.mock.calls.filter(
          ([message]) => message.data.method === 'wallet_getProviderState'
        ).length;
      expect(count()).toBe(2);
      await provider.request({ method: 'eth_chainId' });
      await provider.request({ method: 'eth_accounts' });
      await provider.request({ method: 'eth_blockNumber' });
      expect(count()).toBe(2);
    }
  );

  it.each(['eth_accounts', 'eth_requestAccounts'])(
    'returns the latest authorized selection after a delayed %s reply',
    async (method) => {
      const { provider } = await initialize();
      holdAccountReplies = true;
      const started = new Promise<void>((resolve) => {
        onAccountRequest = resolve;
      });
      const pending = provider.request<string[]>({ method });
      await started;
      const newer = `0x${'22'.repeat(20)}`;
      notify('pali_accountsChanged', [newer]);
      reply(pendingAccountReplies[0].id, pendingAccountReplies[0].result);
      const returned = await pending;
      expect(returned).toEqual([newer]);
      expect(provider.accounts).toEqual([newer]);
      returned.length = 0;
      expect(provider.accounts).toEqual([newer]);
    }
  );

  it('preserves a legitimate first EVM grant notification while the cached unlock flag is false', async () => {
    approved = false;
    unlocked = false;
    const { provider } = await initialize();
    unlocked = true;
    notifyOnGrant = true;
    const changed = jest.fn();
    provider.on('accountsChanged', changed);
    await expect(
      provider.request({ method: 'eth_requestAccounts' })
    ).resolves.toEqual([ADDRESS]);
    expect(changed.mock.calls).toEqual([[[ADDRESS]]]);
    expect(provider.accounts).toEqual([ADDRESS]);
    expect(await provider._metamask.isUnlocked()).toBe(false);
    notify('pali_unlockStateChanged', {
      isUnlocked: false,
      accounts: [ADDRESS],
    });
    expect(provider.accounts).toEqual([]);
    expect(provider.selectedAddress).toBeNull();
    expect(changed.mock.calls).toEqual([[[ADDRESS]], [[]]]);
  });

  it.each(['send', 'sendAsync', 'send callback', 'sendAsync callback'])(
    'fences delayed account results delivered through %s',
    async (api) => {
      const { provider } = await initialize();
      holdAccountReplies = true;
      const started = new Promise<void>((resolve) => {
        onAccountRequest = resolve;
      });
      const payload = { id: 42, jsonrpc: '2.0', method: 'eth_accounts' };
      const pending =
        api === 'send'
          ? (provider.send('eth_accounts') as Promise<unknown>)
          : api === 'sendAsync'
          ? (provider.sendAsync(payload) as Promise<unknown>)
          : new Promise((resolve, reject) => {
              const cb = (err: Error | null, res: unknown) =>
                err ? reject(err) : resolve(res);
              if (api === 'send callback') provider.send(payload, cb);
              else provider.sendAsync(payload, cb);
            });
      await started;
      notify('pali_accountsChanged', []);
      reply(pendingAccountReplies[0].id, pendingAccountReplies[0].result);
      await expect(pending).resolves.toEqual(
        api === 'send' ? [] : { id: 42, jsonrpc: '2.0', result: [] }
      );
    }
  );

  it('refences batch account envelopes at delivery and preserves other IDs and RPC errors', async () => {
    const { provider } = await initialize();
    holdChainReplies = true;
    const started = new Promise<void>((resolve) => {
      onChainRequest = resolve;
    });
    const pending = provider.sendAsync([
      { id: 17, method: 'eth_accounts' },
      { id: 18, method: 'eth_chainId' },
      { id: 19, method: 'unknown' },
      null,
    ]) as Promise<any>;
    await started;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    notify('pali_accountsChanged', []);
    reply(pendingChainReplies[0], '0x1');
    await expect(pending).resolves.toEqual([
      { id: 17, jsonrpc: '2.0', result: [] },
      { id: 18, jsonrpc: '2.0', result: '0x1' },
      {
        id: 19,
        jsonrpc: '2.0',
        error: { code: 4200, message: 'Unsupported method' },
      },
      {
        id: 1,
        jsonrpc: '2.0',
        error: { code: 4200, message: 'Unsupported method' },
      },
    ]);
    expect(provider.accounts).toEqual([]);
  });

  it('allows a batched legitimate first grant while applying the account fence', async () => {
    approved = false;
    const { provider } = await initialize();
    notifyOnGrant = true;
    await expect(
      provider.sendAsync([
        { id: 7, method: 'eth_requestAccounts' },
        { id: 8, method: 'eth_blockNumber' },
      ])
    ).resolves.toEqual([
      { id: 7, jsonrpc: '2.0', result: [ADDRESS] },
      { id: 8, jsonrpc: '2.0', result: '0x1' },
    ]);
  });
  it('bounds a first grant during an outage to one shared metadata wait', async () => {
    approved = false;
    backgroundIsBitcoinBased = true;
    const { provider } = await initialize();
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    failNext = { code: 4900, message: 'All chains disconnected' };
    await expect(
      provider.request({ method: 'eth_blockNumber' })
    ).rejects.toMatchObject({ code: 4900 });
    backgroundIsBitcoinBased = false;
    holdProviderStateReplies = true;
    const started = new Promise<void>((resolve) => {
      onProviderStateRequest = resolve;
    });
    const pending = provider.request({ method: 'eth_requestAccounts' });
    await started;
    await jest.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toEqual([]);
    expect(pendingProviderStateReplies).toHaveLength(1);
    expect(provider.accounts).toEqual([]);
    expect(provider.isConnected()).toBe(false);
  });

  it.each(['missing kind', 'invalid network ID', 'read error'])(
    'fails closed when the first-grant snapshot has %s',
    async (invalid) => {
      approved = false;
      backgroundIsBitcoinBased = true;
      const { provider } = await initialize();
      backgroundIsBitcoinBased = false;
      holdProviderStateReplies = true;
      const started = new Promise<void>((resolve) => {
        onProviderStateRequest = resolve;
      });
      const pending = provider.request({ method: 'eth_requestAccounts' });
      await started;
      const snapshot: any = providerState();
      if (invalid === 'missing kind') delete snapshot.isBitcoinBased;
      else if (invalid === 'invalid network ID') snapshot.networkVersion = '';
      reply(
        pendingProviderStateReplies[0],
        invalid === 'read error'
          ? { error: { code: -32603, message: 'State read failed' } }
          : snapshot
      );
      await expect(pending).resolves.toEqual([]);
      expect(provider.accounts).toEqual([]);
      expect(provider.selectedAddress).toBeNull();
      expect(provider.isBitcoinBased()).toBe(true);
    }
  );
  it.each(['grant', 'lock', 'revocation'])(
    'handles a first-grant notification arriving during metadata, followed by %s',
    async (change) => {
      approved = false;
      backgroundIsBitcoinBased = true;
      const { provider } = await initialize();
      backgroundIsBitcoinBased = false;
      holdProviderStateReplies = true;
      const firstStarted = new Promise<void>((resolve) => {
        onProviderStateRequest = resolve;
      });
      const changed = jest.fn();
      provider.on('accountsChanged', changed);
      const pending = provider.request({ method: 'eth_requestAccounts' });
      await firstStarted;
      const oldSnapshot = providerState();
      const retryStarted = new Promise<void>((resolve) => {
        onProviderStateRequest = resolve;
      });
      notify('pali_accountsChanged', [ADDRESS]);
      await retryStarted;
      const freshSnapshot = providerState();
      expect(pendingProviderStateReplies).toHaveLength(2);
      reply(pendingProviderStateReplies[0], oldSnapshot);
      expect(provider.accounts).toEqual([]);
      if (change === 'lock')
        notify('pali_unlockStateChanged', { isUnlocked: false, accounts: [] });
      else if (change === 'revocation') notify('pali_accountsChanged', []);
      reply(pendingProviderStateReplies[1], freshSnapshot);
      await expect(pending).resolves.toEqual(
        change === 'grant' ? [ADDRESS] : []
      );
      expect(provider.accounts).toEqual(change === 'grant' ? [ADDRESS] : []);
      expect(changed.mock.calls).toEqual(
        change === 'grant' ? [[[ADDRESS]]] : []
      );
    }
  );

  it('keeps a metadata retry after a late grant inside the original two-second deadline', async () => {
    approved = false;
    backgroundIsBitcoinBased = true;
    const { provider } = await initialize();
    backgroundIsBitcoinBased = false;
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    holdProviderStateReplies = true;
    const firstStarted = new Promise<void>((resolve) => {
      onProviderStateRequest = resolve;
    });
    const pending = provider.request({ method: 'eth_requestAccounts' });
    await firstStarted;
    await jest.advanceTimersByTimeAsync(1999);
    const retryStarted = new Promise<void>((resolve) => {
      onProviderStateRequest = resolve;
    });
    notify('pali_accountsChanged', [ADDRESS]);
    await retryStarted;
    await jest.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual([]);
    expect(pendingProviderStateReplies).toHaveLength(2);
    reply(pendingProviderStateReplies[1], providerState());
    await jest.advanceTimersByTimeAsync(0);
    expect(provider.accounts).toEqual([]);
    expect(provider.isBitcoinBased()).toBe(true);
  });
  it.each(['lock', 'revocation', 'chain change'])(
    'preserves newer notifications when a constructor snapshot arrives after %s',
    async (change) => {
      const capturedSnapshot = providerState();
      expect(capturedSnapshot.accounts).toEqual([ADDRESS]);
      expect(capturedSnapshot.isUnlocked).toBe(true);
      holdProviderStateReplies = true;
      const started = new Promise<void>((resolve) => {
        onProviderStateRequest = resolve;
      });
      const provider = new PaliInpageProviderEth();
      const connect = jest.fn();
      provider.on('connect', connect);
      const initialized = new Promise<void>((resolve) =>
        provider.once('_initialized', resolve)
      );
      await started;
      if (change === 'lock')
        notify('pali_unlockStateChanged', { isUnlocked: false, accounts: [] });
      else if (change === 'revocation') notify('pali_accountsChanged', []);
      else
        notify('pali_chainChanged', {
          chainId: '0x2',
          networkVersion: '2002',
          isBitcoinBased: false,
        });
      reply(pendingProviderStateReplies[0], capturedSnapshot);
      await initialized;
      expect(provider.isInitialized()).toBe(true);
      expect(provider.accounts).toEqual([]);
      expect(provider.selectedAddress).toBeNull();
      expect(await provider._metamask.isUnlocked()).toBe(false);
      expect(provider.chainId).toBe(change === 'chain change' ? '0x2' : null);
      if (change === 'chain change') {
        expect(provider.networkVersion).toBe('2002');
        expect((provider.send({ method: 'net_version' }) as any).result).toBe(
          '2002'
        );
        expect(connect.mock.calls).toEqual([[{ chainId: '0x2' }]]);
      } else {
        expect(connect).not.toHaveBeenCalled();
      }
    }
  );
});
