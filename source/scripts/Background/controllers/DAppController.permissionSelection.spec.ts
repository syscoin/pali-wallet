let mockState: any;
const mockDispatch = jest.fn();
const mockPersistGrant = jest.fn();
const mockPersistStrict = jest.fn();
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockState,
    dispatch: (action: any) => mockDispatch(action),
  },
  saveMainState: jest.fn(async () => true),
  persistMainStateStrict: (...args: any[]) => mockPersistStrict(...args),
  persistDappPermissionGrant: (...args: any[]) => mockPersistGrant(...args),
}));
jest.mock('../notification-manager', () => ({
  notificationManager: { notifyDappConnection: jest.fn() },
}));
jest.mock('./message-handler/provider-cache', () => ({
  clearProviderCache: jest.fn(),
}));

import dappReducer from 'state/dapp';
import { INetworkType, KeyringAccountType } from 'types/network';

import DAppController from './DAppController';
import { clearProviderCache } from './message-handler/provider-cache';

const host = 'https://selection.invalid';
const address = `0x${'1'.repeat(40)}`;
let controller: ReturnType<typeof DAppController>;
const context = () => ({
  address,
  xpub: 'public-account-identity',
  network: { ...mockState.vault.activeNetwork },
});
const grant = (expected = context()) =>
  controller.requestPermissions(
    host,
    1,
    KeyringAccountType.HDAccount,
    expected
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockPersistStrict.mockReset().mockResolvedValue(undefined);
  mockState = {
    dapp: { dapps: {} },
    vault: {
      activeNetwork: {
        kind: INetworkType.Ethereum,
        chainId: 1,
        url: 'https://rpc.invalid',
        slip44: 60,
      },
      isBitcoinBased: false,
      accounts: {
        HDAccount: {
          0: { id: 0, address: `0x${'2'.repeat(40)}` },
          1: { id: 1, address, xpub: 'public-account-identity' },
        },
      },
    },
  };
  mockDispatch.mockImplementation((action) => {
    mockState = { ...mockState, dapp: dappReducer(mockState.dapp, action) };
  });
  mockPersistGrant.mockImplementation(async (next, previous, isCurrent) => {
    if (!isCurrent() || mockState.dapp.dapps[next.host] !== previous)
      throw new Error('Permission grant context changed');
    mockDispatch({ type: 'dapp/addDApp', payload: next });
  });
  (chrome.runtime as any).id = 'pali';
  (chrome as any).tabs = { query: jest.fn((_query, reply) => reply([])) };
  (chrome as any).scripting = { executeScript: jest.fn(async () => []) };
  controller = DAppController(() => true);
});

it('grants a live selected identity and tolerates unrelated balance updates', async () => {
  const expected = context();
  mockState.vault.accounts.HDAccount[1].balances = { ethereum: 7 };
  expect((await grant(expected))[0].caveats[0].value).toEqual([address]);
  expect(controller.getAccount(host).address).toBe(address);
});

it.each(['missing', 'wrong-family', 'wrong-smart-chain', 'wrong-utxo-slip44'])(
  'refuses %s before changing an existing permission',
  async (change) => {
    await controller.connect(
      {
        host,
        accountId: 0,
        accountType: KeyringAccountType.HDAccount,
        chain: INetworkType.Ethereum,
        chainId: 1,
        date: 1,
      },
      {
        address: mockState.vault.accounts.HDAccount[0].address,
        network: mockState.vault.activeNetwork,
      }
    );
    const previous = controller.get(host);
    if (change === 'missing') delete mockState.vault.accounts.HDAccount[1];
    if (change === 'wrong-family')
      mockState.vault.accounts.HDAccount[1].address = 'sys1publicaddress';
    let type = KeyringAccountType.HDAccount;
    if (change === 'wrong-smart-chain') {
      type = KeyringAccountType.SmartAccount;
      mockState.vault.accounts.SmartAccount = {
        1: { id: 1, address, smartAccount: { chainId: 2 } },
      };
    }
    if (change === 'wrong-utxo-slip44') {
      mockState.vault.activeNetwork = {
        kind: INetworkType.Syscoin,
        chainId: 57,
        url: 'https://blockbook.invalid',
        slip44: 57,
      };
      mockState.vault.isBitcoinBased = true;
      mockState.vault.accounts.HDAccount[1] = {
        id: 1,
        address: 'bc1publicaddress',
        slip44: 0,
      };
    }
    mockDispatch.mockClear();
    (chrome.tabs.query as jest.Mock).mockClear();
    expect(() => controller.requestPermissions(host, 1, type)).toThrow();
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(chrome.tabs.query).not.toHaveBeenCalled();
    expect(controller.get(host)).toEqual(previous);
  }
);

const holdGrant = () => {
  let finish!: () => void;
  let fail!: (error: Error) => void;
  const pending = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const persist = mockPersistGrant.getMockImplementation()!;
  mockPersistGrant.mockImplementationOnce(async (...args) => {
    await pending;
    return persist(...args);
  });
  return { finish, fail };
};

const holdRevocation = () => {
  let finish!: () => void;
  mockPersistStrict.mockImplementationOnce(
    () => new Promise<void>((resolve) => (finish = resolve))
  );
  return () => finish();
};

it('publishes no permission, session event, or success before persistence', async () => {
  const held = holdGrant();
  let settled = false;
  const result = grant().then((value) => {
    settled = true;
    return value;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(controller.isConnected(host)).toBe(false);
  expect(controller.getAccount(host)).toBeNull();
  expect(chrome.tabs.query).not.toHaveBeenCalled();
  expect(() => grant()).toThrow('already pending');
  held.finish();
  expect((await result)[0].caveats[0].value).toEqual([address]);
  expect(clearProviderCache).toHaveBeenCalledTimes(1);
  expect(chrome.tabs.query).toHaveBeenCalledTimes(1);
});

it('leaves no grant on storage failure and permits a fresh retry', async () => {
  const held = holdGrant();
  const result = grant();
  const rejected = expect(result).rejects.toThrow('Storage unavailable');
  held.fail(new Error('Storage unavailable'));
  await rejected;
  expect(controller.isConnected(host)).toBe(false);
  expect(chrome.tabs.query).not.toHaveBeenCalled();
  await expect(grant()).resolves.toEqual(expect.any(Array));
  expect(controller.isConnected(host)).toBe(true);
});

it('waits for strict persistence when revoking an unpublished grant', async () => {
  const held = holdGrant();
  const rejected = expect(grant()).rejects.toThrow('context changed');
  const finishRevocation = holdRevocation();
  let settled = false;
  const revocation = controller
    .disconnect(host, true, {
      allowAlreadyDisconnected: true,
      propagateErrors: true,
    })
    .then(() => (settled = true));
  await new Promise(setImmediate);
  try {
    expect(mockPersistStrict).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
  } finally {
    held.finish();
    if (mockPersistStrict.mock.calls.length) finishRevocation();
    await Promise.all([rejected, revocation]);
  }
});

it('queues canceled-grant revocation after an older revocation in flight', async () => {
  await controller.connect(
    {
      host,
      accountId: 0,
      accountType: KeyringAccountType.HDAccount,
      chain: INetworkType.Ethereum,
      chainId: 1,
      date: 1,
    },
    {
      address: mockState.vault.accounts.HDAccount[0].address,
      network: mockState.vault.activeNetwork,
    }
  );
  const options = { allowAlreadyDisconnected: true, propagateErrors: true };
  const finishFirst = holdRevocation();
  const first = controller.disconnect(host, true, options);
  await new Promise(setImmediate);
  const held = holdGrant();
  const rejected = expect(grant()).rejects.toThrow('context changed');
  const finishSecond = holdRevocation();
  let settled = false;
  const second = controller
    .disconnect(host, true, options)
    .then(() => (settled = true));
  finishFirst();
  await first;
  await new Promise(setImmediate);
  try {
    expect(mockPersistStrict).toHaveBeenCalledTimes(2);
    expect(settled).toBe(false);
  } finally {
    held.finish();
    if (mockPersistStrict.mock.calls.length === 2) finishSecond();
    await Promise.all([rejected, second]);
  }
});

it('retries a failed strict revocation of an unpublished grant', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation();
  const held = holdGrant();
  const rejected = expect(grant()).rejects.toThrow('context changed');
  const options = { allowAlreadyDisconnected: true, propagateErrors: true };
  mockPersistStrict.mockRejectedValueOnce(new Error('Storage unavailable'));
  try {
    await expect(controller.disconnect(host, true, options)).rejects.toThrow(
      'Storage unavailable'
    );
  } finally {
    held.finish();
    await rejected;
    errorSpy.mockRestore();
  }
  await expect(
    controller.disconnect(host, true, options)
  ).resolves.toBeUndefined();
  expect(mockPersistStrict).toHaveBeenCalledTimes(2);
});

it('preserves a distinct later grant while canceled-grant revocation is pending', async () => {
  const held = holdGrant();
  const rejected = expect(grant()).rejects.toThrow('context changed');
  const finishRevocation = holdRevocation();
  const revocation = controller.disconnect(host, true, {
    allowAlreadyDisconnected: true,
    propagateErrors: true,
  });
  await new Promise(setImmediate);
  await expect(grant()).resolves.toEqual(expect.any(Array));
  held.finish();
  finishRevocation();
  await Promise.all([rejected, revocation]);
  expect(controller.getAccount(host).address).toBe(address);
});

it.each(['revoke', 'replace-address', 'replace-xpub', 'incompatible-network'])(
  'does not publish after %s while persistence is pending',
  async (change) => {
    const held = holdGrant();
    const result = grant();
    const rejected = expect(result).rejects.toThrow('context changed');
    if (change === 'revoke')
      await controller.disconnect(host, false, {
        allowAlreadyDisconnected: true,
      });
    if (change === 'replace-address')
      mockState.vault.accounts.HDAccount[1].address = `0x${'3'.repeat(40)}`;
    if (change === 'replace-xpub')
      mockState.vault.accounts.HDAccount[1].xpub = 'replacement';
    if (change === 'incompatible-network')
      mockState.vault.activeNetwork.kind = INetworkType.Syscoin;
    held.finish();
    await rejected;
    expect(controller.isConnected(host)).toBe(false);
  }
);

it('persists an admitted identity after a compatible EVM network switch', async () => {
  const held = holdGrant();
  const result = grant();
  mockState.vault.activeNetwork = {
    ...mockState.vault.activeNetwork,
    chainId: 2,
    url: 'https://other.invalid',
  };
  held.finish();
  await expect(result).resolves.toEqual(expect.any(Array));
  expect(controller.getAccount(host).address).toBe(address);
});

it('does not report success or emit after revocation immediately following publication', async () => {
  mockPersistGrant.mockImplementationOnce(async (next) => {
    mockDispatch({ type: 'dapp/addDApp', payload: next });
    await controller.disconnect(host, false, {
      allowAlreadyDisconnected: true,
    });
  });
  await expect(grant()).rejects.toThrow('context changed');
  expect(controller.isConnected(host)).toBe(false);
});

it.each(['address', 'xpub', 'kind', 'chainId', 'url', 'slip44'])(
  'refuses stale %s sent from the approval before any mutation',
  (field) => {
    const expected = context();
    if (field === 'address' || field === 'xpub')
      mockState.vault.accounts.HDAccount[1][field] =
        field === 'address' ? `0x${'3'.repeat(40)}` : 'changed-xpub';
    else mockState.vault.activeNetwork[field] = `changed-${field}`;
    expect(() => grant(expected)).toThrow();
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(controller.isConnected(host)).toBe(false);
    expect(chrome.tabs.query).not.toHaveBeenCalled();
  }
);

it.each(['missing', 'identity', 'network'])(
  'refuses a %s account-change approval before session or grant mutation',
  async (change) => {
    const expected = context();
    if (change === 'missing') delete mockState.vault.accounts.HDAccount[1];
    if (change === 'identity')
      mockState.vault.accounts.HDAccount[1].xpub = 'replacement-xpub';
    if (change === 'network')
      mockState.vault.activeNetwork.url = 'https://other.invalid';
    await expect(
      controller.changeAccount(host, 1, KeyringAccountType.HDAccount, expected)
    ).rejects.toThrow();
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(controller.isConnected(host)).toBe(false);
    expect(chrome.tabs.query).not.toHaveBeenCalled();
  }
);
