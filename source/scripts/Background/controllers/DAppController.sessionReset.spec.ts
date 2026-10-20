let mockState: any;
let mockGeneration = 0;
const mockPersistGrant = jest.fn();
const mockSave = jest.fn();
const mockDispatch = jest.fn();
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockState,
    dispatch: (action: any) => mockDispatch(action),
  },
  persistDappPermissionGrant: (...args: any[]) => mockPersistGrant(...args),
  persistMainStateStrict: (...args: any[]) => mockSave(...args),
  saveMainState: (...args: any[]) => mockSave(...args),
}));
jest.mock('../notification-manager', () => ({
  notificationManager: { notifyDappConnection: jest.fn() },
}));

import { PaliInpageProviderSys } from '../../ContentScript/inject/paliProviderSyscoin';
import { INetworkType, KeyringAccountType } from 'types/network';

import DAppController from './DAppController';
import { PaliEvents, PaliSyscoinEvents } from './message-handler/types';

const HOST = 'https://reset-session.example';
const ADDRESS = `0x${'11'.repeat(20)}`;
const grant = {
  accountId: 0,
  accountType: KeyringAccountType.HDAccount,
  chain: INetworkType.Ethereum,
};
const notices = () =>
  (chrome.scripting.executeScript as jest.Mock).mock.calls.map(
    ([options]) => options.args[0]
  );
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGeneration = 0;
  mockState = {
    dapp: { dapps: { [HOST]: grant } },
    vault: {
      activeNetwork: { chainId: 1, kind: INetworkType.Ethereum, slip44: 60 },
      accounts: { HDAccount: { 0: { id: 0, address: ADDRESS } } },
      isBitcoinBased: false,
    },
  };
  (chrome.runtime as any).id = 'session-reset-test';
  (chrome as any).tabs = {
    query: jest.fn((_query, reply) => reply([{ id: 7, url: `${HOST}/page` }])),
  };
  (chrome as any).scripting = {
    executeScript: jest.fn().mockResolvedValue([]),
  };
});

it.each([
  [false, true],
  [true, false],
  [true, true],
])(
  'notifies the old origin without writes with runtime=%s and persisted origin=%s',
  async (hasRuntimeSession, hasPersistedOrigin) => {
    const dapp = DAppController(
      () => true,
      () => mockGeneration
    );
    if (hasRuntimeSession) dapp.setup({ url: `${HOST}/page` });
    const origins = Object.keys(dapp.getAll());
    mockState.dapp.dapps = {};
    await dapp.resetSessions(hasPersistedOrigin ? origins : []);
    expect(notices()).toEqual([
      {
        id: PaliEvents.lockStateChanged,
        data: {
          method: PaliEvents.lockStateChanged,
          params: { isUnlocked: false, accounts: [], xpub: null },
        },
      },
      {
        id: PaliEvents.accountsChanged,
        data: { method: PaliEvents.accountsChanged, params: [] },
      },
      {
        id: PaliSyscoinEvents.xpubChanged,
        data: { method: PaliSyscoinEvents.xpubChanged, params: null },
      },
    ]);
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(dapp.getAll()).toEqual({});
    expect(() => dapp.hasWindow(HOST)).toThrow();
    (chrome.scripting.executeScript as jest.Mock).mockClear();
    await dapp.handleStateChange(PaliEvents.accountsChanged, {
      method: PaliEvents.accountsChanged,
      params: [],
    });
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  }
);

it.each(['generation', 'new grant'])(
  'does not deliver a stale reset notice after a %s changes during tab lookup',
  async (change) => {
    let reply!: (tabs: any[]) => void;
    let firstQuery = true;
    (chrome.tabs.query as jest.Mock).mockImplementation((_query, callback) => {
      if (firstQuery) {
        firstQuery = false;
        reply = callback;
      } else callback([{ id: 7, url: `${HOST}/page` }]);
    });
    const dapp = DAppController(
      () => true,
      () => mockGeneration
    );
    dapp.setup({ url: `${HOST}/page` });
    mockState.dapp.dapps = {};
    const resetting = dapp.resetSessions([HOST]);
    if (change === 'generation') mockGeneration += 1;
    else mockState.dapp.dapps[HOST] = { ...grant };
    reply([{ id: 7, url: `${HOST}/page` }]);
    await resetting;
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  }
);

it('awaits targeted notification delivery before completing the reset', async () => {
  const held = deferred();
  (chrome.scripting.executeScript as jest.Mock).mockReturnValue(held.promise);
  const dapp = DAppController(
    () => true,
    () => mockGeneration
  );
  mockState.dapp.dapps = {};
  let completed = false;
  const resetting = dapp.resetSessions([HOST]).then(() => {
    completed = true;
  });
  await new Promise(setImmediate);
  expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
  expect(completed).toBe(false);
  held.resolve();
  await resetting;
  expect(completed).toBe(true);
});

it.each([false, true])(
  'clears the real Sys provider receiver even when its cached unlocked state is %s',
  async (isUnlocked) => {
    const provider: any = Object.create(PaliInpageProviderSys.prototype);
    provider.emit = jest.fn();
    provider._sysState = {
      accounts: ['sys1previous'],
      xpub: 'public-previous-xpub',
      isBitcoinBased: true,
      initialized: true,
      isUnlocked,
    };
    mockState.dapp.dapps = {};
    await DAppController().resetSessions([HOST]);
    for (const { data } of notices()) {
      if (data.method === PaliEvents.lockStateChanged)
        provider._handleUnlockStateChanged(data.params);
      else if (data.method === PaliEvents.accountsChanged)
        provider._handleAccountsChanged(data.params);
      else if (data.method === PaliSyscoinEvents.xpubChanged)
        provider._handleConnectedXpub(data.params);
    }
    expect(provider._sysState).toMatchObject({
      accounts: [],
      xpub: null,
      isUnlocked: false,
    });
    expect(provider.emit).toHaveBeenCalledTimes(1);
    expect(provider.emit).toHaveBeenCalledWith('accountsChanged', []);
  }
);

it('treats unavailable notification delivery as best effort after commit', async () => {
  jest.spyOn(console, 'debug').mockImplementation();
  (chrome.scripting.executeScript as jest.Mock).mockRejectedValue(
    new Error('Tab closed')
  );
  mockState.dapp.dapps = {};
  await expect(DAppController().resetSessions([HOST])).resolves.toBeUndefined();
  expect(mockSave).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});

it('invalidates a pending grant without writing or reviving its old runtime session', async () => {
  const held = deferred();
  mockPersistGrant.mockImplementation(async (_next, _previous, isCurrent) => {
    await held.promise;
    if (!isCurrent()) throw new Error('Permission grant context changed');
    throw new Error('Unexpected grant admission');
  });
  const dapp = DAppController(
    () => true,
    () => mockGeneration
  );
  const pending = dapp.requestPermissions(
    HOST,
    0,
    KeyringAccountType.HDAccount
  );
  const rejected = expect(pending).rejects.toThrow(
    'Permission grant context changed'
  );
  mockState.dapp.dapps = {};
  await dapp.resetSessions([HOST]);
  held.resolve();
  await rejected;
  expect(dapp.getAll()).toEqual({});
  expect(mockDispatch).not.toHaveBeenCalled();
  expect(mockSave).not.toHaveBeenCalled();
});
