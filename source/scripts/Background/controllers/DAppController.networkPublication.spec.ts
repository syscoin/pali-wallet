/**
 * @jest-environment jsdom
 * @jest-environment-options {"url":"https://publication-a.synthetic.invalid/page"}
 */
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock(
  'scripts/Background/controllers/providers/patchFetchWithPaliHeaders',
  () => ({ patchFetchWithPaliHeaders: jest.fn() })
);
jest.mock('utils/syscoinPsbtValues', () => ({}));
jest.mock('scripts/Background', () => ({
  getController: jest.fn(),
  notificationManager: {
    cleanup: jest.fn(),
    notifyNetworkChange: jest.fn(),
    notifyAccountChange: jest.fn(),
  },
}));
jest.mock('scripts/Background/notification-manager', () => ({
  notificationManager: { notifyDappConnection: jest.fn() },
}));
// These tests cover in-memory publication after a successfully admitted switch,
// not storage durability or network discovery, which are separate boundaries.
jest.mock('state/store', () => ({
  ...jest.requireActual('state/store'),
  __esModule: true,
  persistCommittedWalletState: jest.fn().mockResolvedValue(undefined),
  persistMainStateStrict: jest.fn().mockResolvedValue(undefined),
  saveMainState: jest.fn().mockResolvedValue(undefined),
}));

import { getController } from 'scripts/Background';
import DAppController from 'scripts/Background/controllers/DAppController';
import MainController from 'scripts/Background/controllers/MainController';
import {
  PaliEvents,
  PaliSyscoinEvents,
} from 'scripts/Background/controllers/message-handler/types';
import { CancellablePromises } from 'scripts/Background/controllers/promises/cancellablesPromises';
import { PaliInpageProviderEth } from 'scripts/ContentScript/inject/paliProviderEthereum';
import { PaliInpageProviderSys } from 'scripts/ContentScript/inject/paliProviderSyscoin';
import { rehydrate as rehydrateDapps } from 'state/dapp';
import store from 'state/store';
import { restoreVaultSnapshot } from 'state/vault';
import { setActiveSlip44 } from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';

const HOST = 'https://publication-a.synthetic.invalid';
const OTHER = 'https://publication-b.synthetic.invalid';
const A = `0x${'11'.repeat(20)}`;
const B = `0x${'22'.repeat(20)}`;
const TYPE = KeyringAccountType.HDAccount;
const networkEvents = [
  PaliEvents.chainChanged,
  PaliEvents.isBitcoinBased,
  PaliSyscoinEvents.blockExplorerChanged,
];
// Chromium's extension ANY argument converter strips null object members,
// unlike JSON.stringify; null array elements remain present. Model that
// boundary before executing the real injected function.
const chromeAnyArgument = (value: any): any =>
  Array.isArray(value)
    ? value.map(chromeAnyArgument)
    : value && typeof value === 'object'
    ? Object.fromEntries(
        Object.entries(value)
          .filter(([, item]) => item !== null)
          .map(([key, item]) => [key, chromeAnyArgument(item)])
      )
    : value;
const notice = (options: any) => JSON.parse(options.args[0]);
const network = (chainId: number) => ({
  chainId,
  kind: INetworkType.Ethereum,
  slip44: 60,
  currency: 'eth',
  label: `Synthetic chain ${chainId}`,
  url: `https://rpc-${chainId}.synthetic.invalid`,
});
type Query = {
  callback: (tabs: any[]) => void;
  chain: number;
  origin: string;
  rpcUrl: string;
};
let wallet: any;
let dapp: ReturnType<typeof DAppController>;
let queries: Query[];
let injected: any[];
let listeners: EventListener[] = [];
const originalFetch = globalThis.fetch;
const flush = async () => {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
};
const deliver = async (chain: number, rpcUrl?: string) => {
  const selected = queries.filter(
    (query) => query.chain === chain && (!rpcUrl || query.rpcUrl === rpcUrl)
  );
  queries = queries.filter((query) => !selected.includes(query));
  for (const query of selected)
    query.callback([
      { id: query.origin === HOST ? 1 : 2, url: query.origin + '/page' },
    ]);
  await flush();
};
const initializeProvider = async () => {
  const provider = new PaliInpageProviderEth();
  await new Promise<void>((resolve) => provider.once('_initialized', resolve));
  expect(provider.chainId).toBe('0x1');
  return provider;
};
const initializeSysFixture = async () => {
  const initial = store.getState().vault;
  store.dispatch(
    restoreVaultSnapshot({
      ...initial,
      activeNetwork: { ...network(1), kind: INetworkType.Syscoin, slip44: 1 },
      isBitcoinBased: true,
      accounts: {
        ...initial.accounts,
        [TYPE]: {
          0: { id: 0, address: 'sys1synthetic-a', xpub: 'public-a', slip44: 1 },
          1: { id: 1, address: 'sys1synthetic-b', xpub: 'public-b', slip44: 1 },
        },
      },
    } as any)
  );
  store.dispatch(setActiveSlip44(1));
  store.dispatch(
    rehydrateDapps({
      dapps: {
        [HOST]: {
          host: HOST,
          accountId: 0,
          accountType: TYPE,
          chain: INetworkType.Syscoin,
        },
        [OTHER]: {
          host: OTHER,
          accountId: 1,
          accountType: TYPE,
          chain: INetworkType.Syscoin,
        },
      },
    } as any)
  );
  dapp.setup({ url: HOST + '/page' });
  dapp.setup({ url: OTHER + '/page' });
  const provider = new PaliInpageProviderSys();
  await new Promise<void>((resolve) =>
    provider.once('_sysInitialized', resolve)
  );
  expect(provider.isBitcoinBased()).toBe(true);
  return provider;
};

beforeEach(() => {
  jest.clearAllMocks();
  globalThis.fetch = jest.fn(() => {
    throw new Error('No public I/O allowed');
  });
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  jest.spyOn(console, 'debug').mockImplementation();
  const initial = store.getState().vault;
  store.dispatch(
    restoreVaultSnapshot({
      ...initial,
      activeNetwork: network(1),
      activeAccount: { id: 0, type: TYPE },
      isBitcoinBased: false,
      accounts: {
        ...initial.accounts,
        [TYPE]: {
          0: { id: 0, address: A, xpub: 'public-a', label: 'A' },
          1: { id: 1, address: B, xpub: 'public-b', label: 'B' },
        },
      },
    } as any)
  );
  store.dispatch(setActiveSlip44(60));
  store.dispatch(
    rehydrateDapps({
      dapps: {
        [HOST]: {
          host: HOST,
          accountId: 0,
          accountType: TYPE,
          chain: INetworkType.Ethereum,
        },
        [OTHER]: {
          host: OTHER,
          accountId: 1,
          accountType: TYPE,
          chain: INetworkType.Ethereum,
        },
      },
    } as any)
  );
  queries = [];
  injected = [];
  (chrome.runtime as any).id = 'synthetic-provider-publication';
  (chrome as any).tabs = {
    query: jest.fn(({ url }, callback) => {
      const origin = url.slice(0, -2);
      queries.push({
        chain: store.getState().vault.activeNetwork.chainId,
        rpcUrl: store.getState().vault.activeNetwork.url,
        origin,
        callback,
      });
    }),
  };
  (chrome as any).scripting = {
    executeScript: jest.fn(async (options) => {
      injected.push(options);
      if (options.target.tabId === 1)
        options.func(...options.args.map(chromeAnyArgument));
      return [];
    }),
  };
  wallet = Object.create(MainController.prototype);
  Object.assign(wallet, {
    networkRequestGeneration: 0,
    walletSessionGeneration: 0,
    walletStateGeneration: 0,
    assetUpdateRequestId: 0,
    isStartingUp: false,
    cancellablePromises: new CancellablePromises(),
    stopAllRapidPolling: jest.fn(),
    cancelActiveBalanceUpdate: jest.fn(),
    resetAutoLockTimer: jest.fn(),
    setFiat: jest.fn().mockResolvedValue(undefined),
    getLatestUpdateForCurrentAccount: jest.fn().mockResolvedValue(true),
    saveWalletState: jest.fn().mockResolvedValue(undefined),
    performPostAccountSwitchOperations: jest.fn().mockResolvedValue(undefined),
    // Substitute only successful SDK network setup. The actual public method,
    // success handler, Redux publication, compatibility checks and events run.
    setActiveNetworkLogic: jest.fn((target, resolve) =>
      resolve({
        chainId: `0x${target.chainId.toString(16)}`,
        networkVersion: target.chainId,
        isBitcoinBased: target.kind === INetworkType.Syscoin,
        network: target,
      })
    ),
  });
  dapp = DAppController(
    () => true,
    () => wallet.walletStateGeneration
  );
  jest.mocked(getController).mockReturnValue({ wallet, dapp } as any);
  dapp.setup({ url: HOST + '/page' });
  dapp.setup({ url: OTHER + '/page' });
  listeners = [];
  const add = window.addEventListener.bind(window);
  jest
    .spyOn(window, 'addEventListener')
    .mockImplementation((type, listener, options) => {
      if (type === 'paliNotification')
        listeners.push(listener as EventListener);
      add(type, listener, options);
    });
  jest.spyOn(window, 'postMessage').mockImplementation((message) => {
    queueMicrotask(() => {
      const current = store.getState().vault;
      const account = dapp.getAccount(HOST);
      const state = {
        accounts: account ? [account.address] : [],
        chainId: `0x${current.activeNetwork.chainId.toString(16)}`,
        networkVersion: String(current.activeNetwork.chainId),
        isBitcoinBased: current.isBitcoinBased,
        isUnlocked: true,
        xpub: account?.xpub ?? null,
        blockExplorerURL: current.isBitcoinBased
          ? current.activeNetwork.url
          : null,
      };
      const result =
        message.data.method === 'wallet_getProviderState' ||
        message.data.method === 'wallet_getSysProviderState'
          ? state
          : message.data.method === 'eth_accounts'
          ? state.accounts
          : message.data.method === 'eth_chainId'
          ? state.chainId
          : message.data.method === 'net_version'
          ? state.networkVersion
          : { error: { code: 4200, message: 'Synthetic read not allowed' } };
      window.dispatchEvent(
        new CustomEvent(message.id, { detail: JSON.stringify(result) })
      );
    });
  });
});

afterEach(() => {
  listeners.forEach((listener) =>
    window.removeEventListener('paliNotification', listener)
  );
  jest.restoreAllMocks();
  globalThis.fetch = originalFetch;
});

it('preserves an explicit null EVM explorer through Chromium argument conversion', async () => {
  const provider = new PaliInpageProviderSys();
  await new Promise<void>((resolve) =>
    provider.once('_sysInitialized', resolve)
  );
  expect(await provider.activeExplorer()).toBeNull();
  await wallet.setActiveNetwork(network(2));
  await deliver(2);
  expect(provider.chainId).toBe('0x2');
  expect(provider.isBitcoinBased()).toBe(false);
  expect(await provider.activeExplorer()).toBeNull();
});

it.each([
  [PaliSyscoinEvents.xpubChanged, null, null],
  [
    PaliEvents.lockStateChanged,
    { isUnlocked: false },
    { isUnlocked: false, accounts: [], xpub: null },
  ],
])(
  'preserves nullable %s fields through Chromium argument conversion',
  async (method, params, expected) => {
    const received: any[] = [];
    window.addEventListener('paliNotification', (event: any) => {
      const data = JSON.parse(event.detail).data;
      if (data.method === method) received.push(data);
    });
    await dapp.handleStateChange(method as PaliEvents, { method, params });
    await deliver(1);
    expect(received).toEqual([{ method, params: expected }]);
  }
);

it('retains strings, false values and null array elements through the event transport', async () => {
  const received: any[] = [];
  window.addEventListener('paliNotification', (event: any) =>
    received.push(JSON.parse(event.detail).data)
  );
  // Opaque JSON fields exercise transport fidelity, not new provider behavior.
  const params = {
    chainId: '0x1',
    networkVersion: 1,
    isBitcoinBased: false,
    values: [null, false, 'text'],
  };
  await dapp.handleStateChange(PaliEvents.chainChanged, {
    method: PaliEvents.chainChanged,
    params,
  });
  await deliver(1);
  expect(received).toEqual([{ method: PaliEvents.chainChanged, params }]);
});

it('healthy ordered network publications track the latest completed switch', async () => {
  const provider = await initializeProvider();
  const changes: string[] = [];
  provider.on('chainChanged', (chain) => changes.push(chain));
  await wallet.setActiveNetwork(network(2));
  await deliver(2);
  await wallet.setActiveNetwork(network(3));
  await deliver(3);
  expect(changes).toEqual(['0x2', '0x3']);
  expect(provider.chainId).toBe('0x3');
  expect(provider.selectedAddress).toBe(A);
});

it('must not publish an old chain after a newer normal switch completes', async () => {
  const provider = await initializeProvider();
  const changes: string[] = [];
  provider.on('chainChanged', (chain) => changes.push(chain));
  await wallet.setActiveNetwork(network(2));
  expect(queries.some((query) => query.chain === 2)).toBe(true);
  await wallet.setActiveNetwork(network(3));
  await deliver(3);
  expect(provider.chainId).toBe('0x3');
  await deliver(2);
  expect(store.getState().vault.activeNetwork.chainId).toBe(3);
  expect(provider.chainId).toBe('0x3');
  expect(changes).toEqual(['0x3']);
});

it('publishes a healthy synchronous switch only after its save completes', async () => {
  const provider = await initializeProvider();
  let releaseSave!: () => void;
  let enteredSave!: () => void;
  const saveEntered = new Promise<void>((resolve) => {
    enteredSave = resolve;
  });
  const saved = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  wallet.saveWalletState.mockImplementationOnce(() => {
    enteredSave();
    return saved;
  });
  const switching = wallet.setActiveNetwork(network(2), true);
  await saveEntered;
  expect(queries).toEqual([]);
  expect(provider.chainId).toBe('0x1');
  releaseSave();
  await switching;
  await deliver(2);
  expect(provider.chainId).toBe('0x2');
  expect(store.getState().vault.activeNetwork.chainId).toBe(2);
});

it('does not publish a retired synchronous switch after its save completes', async () => {
  const provider = await initializeProvider();
  const changes: string[] = [];
  provider.on('chainChanged', (chain) => changes.push(chain));
  let releaseSave!: () => void;
  let enteredSave!: () => void;
  const saveEntered = new Promise<void>((resolve) => {
    enteredSave = resolve;
  });
  const saved = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  wallet.saveWalletState.mockImplementationOnce(() => {
    enteredSave();
    return saved;
  });
  const oldSwitch = wallet.setActiveNetwork(network(2), true);
  const oldResult = oldSwitch.then(
    () => null,
    (error: Error) => error
  );
  await saveEntered;
  await wallet.setActiveNetwork(network(3), false);
  await deliver(3);
  expect(provider.chainId).toBe('0x3');
  releaseSave();
  expect((await oldResult)?.message).toBe('Network change cancelled');
  // A retired producer must not stamp its old payload with the new chain's
  // publication scope when the storage operation resumes.
  await deliver(3);
  expect(store.getState().vault.activeNetwork.chainId).toBe(3);
  expect(provider.chainId).toBe('0x3');
  expect(changes).toEqual(['0x3']);
});

it('normal account selection and network publication retain each origin account', async () => {
  const provider = await initializeProvider();
  await wallet.setAccount(1, TYPE);
  await wallet.setActiveNetwork(network(2));
  await deliver(2);
  expect(provider.selectedAddress).toBe(A);
  const accountMessages = injected.filter(
    (entry) => notice(entry).data.method === PaliEvents.accountsChanged
  );
  expect(
    accountMessages
      .filter((entry) => entry.target.tabId === 1)
      .map((entry) => notice(entry).data.params)
  ).toEqual([[A]]);
  expect(
    accountMessages
      .filter((entry) => entry.target.tabId === 2)
      .map((entry) => notice(entry).data.params)
  ).toEqual([[B]]);
});

it('revocation during pending publication clears only that origin account, not RPC connectivity', async () => {
  const provider = await initializeProvider();
  const disconnected = jest.fn();
  provider.on('disconnect', disconnected);
  await wallet.setActiveNetwork(network(2));
  await dapp.disconnect(HOST, true, {
    propagateErrors: true,
    allowAlreadyDisconnected: true,
  });
  await deliver(2);
  expect(provider.selectedAddress).toBe(null);
  expect(provider.isConnected()).toBe(true);
  expect(disconnected).not.toHaveBeenCalled();
  expect(dapp.isConnected(HOST)).toBe(false);
  expect(dapp.isConnected(OTHER)).toBe(true);
});

it('drops superseded same-chain endpoint publications without dropping the current snapshot', async () => {
  const provider = await initializeProvider();
  const first = network(2);
  const latest = { ...first, url: 'https://alternate-2.synthetic.invalid' };
  await wallet.setActiveNetwork(first);
  await wallet.setActiveNetwork(latest);
  await deliver(2, latest.url);
  const networkMessages = () =>
    injected.filter((entry) =>
      networkEvents.includes(notice(entry).data.method)
    );
  const count = networkMessages().length;
  expect(provider.chainId).toBe('0x2');
  await deliver(2, first.url);
  expect(networkMessages()).toHaveLength(count);
  expect(provider.selectedAddress).toBe(A);
});

it('drops an old EVM network snapshot after a normal same-chain family transition', async () => {
  await initializeProvider();
  const first = network(2);
  await wallet.setActiveNetwork(first);
  const utxo = {
    ...first,
    kind: INetworkType.Syscoin,
    slip44: 1,
    url: 'https://utxo-2.synthetic.invalid',
  };
  await wallet.setActiveNetwork(utxo);
  await deliver(2, first.url);
  const oldNetworkMessages = injected.filter((entry) =>
    networkEvents.includes(notice(entry).data.method)
  );
  expect(oldNetworkMessages).toEqual([]);
  await deliver(2, utxo.url);
  expect(dapp.isConnected(HOST)).toBe(false);
});

it('drops a pending network snapshot after the supplied wallet generation retires', async () => {
  await initializeProvider();
  await wallet.setActiveNetwork(network(2));
  wallet.walletStateGeneration += 1;
  await deliver(2);
  const networkMessages = injected.filter((entry) =>
    networkEvents.includes(notice(entry).data.method)
  );
  expect(networkMessages).toEqual([]);
});

it.each(['chain', 'endpoint', 'UTXO endpoint'] as const)(
  'serializes accepted network scripts across a %s switch and publishes a coherent latest snapshot',
  async (transition) => {
    const isBitcoinBased = transition === 'UTXO endpoint';
    const provider = isBitcoinBased
      ? await initializeSysFixture()
      : await initializeProvider();
    const pending: { complete: () => void; options: any }[] = [];
    const executed: any[] = [];
    const run = (options: any) => {
      if (options.target.tabId === 1) {
        if (networkEvents.includes(notice(options).data.method))
          executed.push(notice(options).data);
        options.func(...options.args);
      }
    };
    (chrome.scripting.executeScript as jest.Mock).mockImplementation(
      (options) => {
        if (!networkEvents.includes(notice(options).data.method)) {
          run(options);
          return Promise.resolve([]);
        }
        return new Promise((resolve) => {
          pending.push({
            options,
            complete: () => {
              run(options);
              resolve([]);
            },
          });
        });
      }
    );
    const first = {
      ...network(2),
      ...(isBitcoinBased ? { kind: INetworkType.Syscoin, slip44: 1 } : {}),
    };
    await wallet.setActiveNetwork(first);
    await deliver(2);
    const old = pending.splice(0);
    const latest =
      transition === 'chain'
        ? network(3)
        : { ...first, url: 'https://latest.synthetic.invalid' };
    await wallet.setActiveNetwork(latest);
    await deliver(latest.chainId, latest.url);
    // executeScript settles only after its function executes. New scripts must
    // not overtake an already accepted script for the same origin.
    const overtaking = pending.splice(0);
    overtaking.forEach((script) => script.complete());
    await flush();
    old.forEach((script) => script.complete());
    for (let batch = 0; batch < 4; batch += 1) {
      await flush();
      pending.splice(0).forEach((script) => script.complete());
    }
    await flush();
    expect(store.getState().vault.activeNetwork).toMatchObject(latest);
    expect(provider.chainId).toBe(`0x${latest.chainId.toString(16)}`);
    expect(provider.isBitcoinBased()).toBe(isBitcoinBased);
    if (provider instanceof PaliInpageProviderSys)
      expect(await provider.activeExplorer()).toBe(latest.url);
    expect(executed.slice(1)).toEqual([
      {
        method: PaliEvents.chainChanged,
        params: {
          chainId: `0x${latest.chainId.toString(16)}`,
          networkVersion: latest.chainId,
          isBitcoinBased,
        },
      },
      { method: PaliEvents.isBitcoinBased, params: { isBitcoinBased } },
      {
        method: PaliSyscoinEvents.blockExplorerChanged,
        params: isBitcoinBased ? latest.url : null,
      },
    ]);
    expect(old).toHaveLength(2);
    expect(
      old.every(
        (script) =>
          notice(script.options).data.method === PaliEvents.chainChanged
      )
    ).toBe(true);
    expect(overtaking).toHaveLength(0);
    expect(pending).toHaveLength(0);
  }
);

it.each(['reject', 'generation'] as const)(
  'releases a held origin after %s without blocking other origins or future publications',
  async (completion) => {
    const provider = await initializeProvider();
    let release!: () => void;
    const attempts: any[] = [];
    (chrome.scripting.executeScript as jest.Mock).mockImplementation(
      (options) => {
        attempts.push(options);
        if (
          options.target.tabId === 1 &&
          notice(options).data.method === PaliEvents.chainChanged &&
          notice(options).data.params.chainId === '0x2'
        ) {
          return new Promise((resolve, reject) => {
            release = () => {
              if (completion === 'reject') reject(new Error('Tab closed'));
              else {
                options.func(...options.args);
                resolve([]);
              }
            };
          });
        }
        if (options.target.tabId === 1) options.func(...options.args);
        return Promise.resolve([]);
      }
    );
    await wallet.setActiveNetwork(network(2));
    await deliver(2);
    await wallet.setActiveNetwork(network(3));
    await deliver(3);
    expect(
      attempts.some(
        (entry) =>
          entry.target.tabId === 2 &&
          notice(entry).data.params?.chainId === '0x3'
      )
    ).toBe(true);
    if (completion === 'generation') wallet.walletStateGeneration += 1;
    release();
    for (let step = 0; step < 4; step += 1) await flush();
    const hostChains = () =>
      attempts
        .filter(
          (entry) =>
            entry.target.tabId === 1 &&
            notice(entry).data.method === PaliEvents.chainChanged
        )
        .map((entry) => notice(entry).data.params.chainId);
    expect(hostChains()).toEqual(
      completion === 'generation' ? ['0x2'] : ['0x2', '0x3']
    );
    if (completion === 'reject') expect(provider.chainId).toBe('0x3');
    await wallet.setActiveNetwork(network(4));
    await deliver(4);
    expect(provider.chainId).toBe('0x4');
    expect(hostChains().at(-1)).toBe('0x4');
  }
);
