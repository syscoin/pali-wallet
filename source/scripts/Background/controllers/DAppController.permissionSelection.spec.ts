let mockState: any;
let mockWalletStateGeneration: number;
const mockDispatch = jest.fn();
const mockWrite = jest.fn();
let mockPersistenceQueue: Promise<unknown> = Promise.resolve();
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockState,
    dispatch: (action: any) => mockDispatch(action),
  },
  saveMainState: jest.fn(async () => true),
  dappPermissionPort: {
    assertWritable: () => undefined,
    exclusive: (operation: () => Promise<unknown>) => {
      const result = mockPersistenceQueue.then(operation);
      mockPersistenceQueue = result.catch(() => undefined);
      return result;
    },
    read: () => ({
      dapps: mockState.dapp.dapps,
      pendingOrigins: mockState.dapp.pendingOrigins ?? [],
    }),
    write: (...args: any[]) => mockWrite(...args),
    publish: (frame: any) =>
      mockDispatch({ type: 'dapp/rehydrate', payload: frame }),
  },
}));
jest.mock('../notification-manager', () => ({
  notificationManager: { notifyDappConnection: jest.fn() },
}));
jest.mock('./message-handler/provider-cache', () => ({
  clearProviderCache: jest.fn(),
}));

import { smartAccountAddressFixture } from '../../../../tests/fixtures/smartAccountAddress';
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
  mockWalletStateGeneration = 0;
  mockWrite.mockReset().mockResolvedValue(undefined);
  mockPersistenceQueue = Promise.resolve();
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
  (chrome.runtime as any).id = 'pali';
  (chrome as any).tabs = { query: jest.fn((_query, reply) => reply([])) };
  (chrome as any).scripting = { executeScript: jest.fn(async () => []) };
  controller = DAppController(
    () => true,
    () => mockWalletStateGeneration
  );
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
      const { account } = smartAccountAddressFixture(2);
      mockState.vault.accounts.SmartAccount = { 1: { ...account, id: 1 } };
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
    expect(() =>
      controller.requestPermissions(host, 1, type, context())
    ).toThrow();
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(chrome.tabs.query).not.toHaveBeenCalled();
    expect(controller.get(host)).toEqual(previous);
  }
);

it('keeps the existing permission when a same-chain smart address cannot be verified', async () => {
  await grant();
  const previous = controller.get(host);
  const { account } = smartAccountAddressFixture();
  const invalid = { ...account, id: 1, address, xpub: address };
  mockState.vault.accounts.SmartAccount = { 1: invalid };
  mockDispatch.mockClear();
  (chrome.tabs.query as jest.Mock).mockClear();

  expect(() =>
    controller.requestPermissions(host, 1, KeyringAccountType.SmartAccount, {
      ...context(),
      xpub: invalid.xpub,
    })
  ).toThrow('Account is not available on the active network');
  expect(mockDispatch).not.toHaveBeenCalled();
  expect(chrome.tabs.query).not.toHaveBeenCalled();
  expect(controller.get(host)).toEqual(previous);
});

const holdGrant = () => {
  let finish!: () => void;
  let fail!: (error: Error) => void;
  const pending = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  mockWrite.mockImplementationOnce(() => pending);
  return { finish, fail };
};

const holdRevocation = () => {
  let finish!: () => void;
  mockWrite.mockImplementationOnce(
    () => new Promise<void>((resolve) => (finish = resolve))
  );
  return () => finish();
};

it('does not admit a pre-reset permission after the same account identity is restored', async () => {
  const held = holdGrant();
  const pending = grant();
  const rejected = expect(pending).rejects.toThrow('context changed');
  await new Promise(setImmediate);
  // A real reset invalidates this lifetime even if seed recovery or rollback
  // later restores the same address, xpub, network and empty permission set.
  mockWalletStateGeneration += 1;
  mockState = structuredClone(mockState);
  held.finish();
  await rejected;
  expect(controller.isConnected(host)).toBe(false);
  expect(chrome.tabs.query).not.toHaveBeenCalled();
  await expect(grant()).resolves.toEqual(expect.any(Array));
  expect(controller.isConnected(host)).toBe(true);
});

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
  await new Promise(setImmediate);
  held.fail(new Error('Storage unavailable'));
  await rejected;
  expect(controller.isConnected(host)).toBe(false);
  expect(chrome.tabs.query).not.toHaveBeenCalled();
  await expect(grant()).resolves.toEqual(expect.any(Array));
  expect(controller.isConnected(host)).toBe(true);
});

it('waits for the staged grant repair before persisting revocation', async () => {
  const held = holdGrant();
  const rejected = expect(grant()).rejects.toThrow('context changed');
  await new Promise(setImmediate);
  const finishRepair = holdRevocation();
  let settled = false;
  const revocation = controller
    .revoke(host, { allowAlreadyDisconnected: true })
    .then(() => (settled = true));
  expect(mockWrite).toHaveBeenCalledTimes(1);
  held.finish();
  await new Promise(setImmediate);
  expect(mockWrite).toHaveBeenCalledTimes(2);
  expect(settled).toBe(false);
  finishRepair();
  await Promise.all([rejected, revocation]);
  expect(mockWrite).toHaveBeenCalledTimes(3);
  expect(controller.isConnected(host)).toBe(false);
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
  mockWrite.mockClear();
  const finishFirst = holdRevocation();
  const first = controller.revoke(host, { allowAlreadyDisconnected: true });
  await new Promise(setImmediate);
  const rejected = expect(grant()).rejects.toThrow('context changed');
  const finishSecond = holdRevocation();
  let settled = false;
  const second = controller
    .revoke(host, { allowAlreadyDisconnected: true })
    .then(() => (settled = true));
  finishFirst();
  await first;
  await rejected;
  await new Promise(setImmediate);
  expect(mockWrite).toHaveBeenCalledTimes(2);
  expect(settled).toBe(false);
  finishSecond();
  await second;
  expect(controller.isConnected(host)).toBe(false);
});

it('retries a failed strict revocation of an unpublished grant', async () => {
  const held = holdGrant();
  const rejected = expect(grant()).rejects.toThrow('context changed');
  await new Promise(setImmediate);
  mockWrite.mockResolvedValueOnce(undefined); // Repair the canceled stage.
  mockWrite.mockRejectedValueOnce(new Error('Storage unavailable'));
  const revocation = controller.revoke(host, {
    allowAlreadyDisconnected: true,
  });
  const failed = expect(revocation).rejects.toThrow('Storage unavailable');
  held.finish();
  await Promise.all([rejected, failed]);
  await expect(
    controller.revoke(host, { allowAlreadyDisconnected: true })
  ).resolves.toBeUndefined();
  expect(mockWrite).toHaveBeenCalledTimes(4);
  expect(controller.isConnected(host)).toBe(false);
});

it('preserves a distinct later grant queued behind canceled-grant revocation', async () => {
  const held = holdGrant();
  const rejected = expect(grant()).rejects.toThrow('context changed');
  await new Promise(setImmediate);
  mockWrite.mockResolvedValueOnce(undefined); // Repair the canceled stage.
  const finishRevocation = holdRevocation();
  const revocation = controller.revoke(host, {
    allowAlreadyDisconnected: true,
  });
  const later = grant();
  held.finish();
  await rejected;
  await new Promise(setImmediate);
  expect(controller.isConnected(host)).toBe(false);
  finishRevocation();
  await revocation;
  await expect(later).resolves.toEqual(expect.any(Array));
  expect(controller.getAccount(host).address).toBe(address);
});

it.each(['revoke', 'replace-address', 'replace-xpub', 'incompatible-network'])(
  'does not publish after %s while persistence is pending',
  async (change) => {
    const held = holdGrant();
    const result = grant();
    const rejected = expect(result).rejects.toThrow('context changed');
    await new Promise(setImmediate);
    const revocation =
      change === 'revoke'
        ? controller.revoke(host, { allowAlreadyDisconnected: true })
        : undefined;
    if (change === 'replace-address')
      mockState.vault.accounts.HDAccount[1].address = `0x${'3'.repeat(40)}`;
    if (change === 'replace-xpub')
      mockState.vault.accounts.HDAccount[1].xpub = 'replacement';
    if (change === 'incompatible-network')
      mockState.vault.activeNetwork.kind = INetworkType.Syscoin;
    held.finish();
    await rejected;
    await revocation;
    expect(controller.isConnected(host)).toBe(false);
  }
);

it('persists an admitted identity after a compatible EVM network switch', async () => {
  const held = holdGrant();
  const result = grant();
  await new Promise(setImmediate);
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
  const dispatch = mockDispatch.getMockImplementation()!;
  mockDispatch.mockImplementation((action) => {
    dispatch(action);
    if (action.type === 'dapp/rehydrate' && action.payload.dapps[host])
      controller.retireForTransaction(host);
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
