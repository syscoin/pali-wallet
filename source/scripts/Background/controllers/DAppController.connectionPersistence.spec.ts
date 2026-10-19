const mockStorageGet = jest.fn<Promise<any>, any[]>(async () => null);
const mockStorageSet = jest.fn();
jest.mock('utils/storageAPI', () => ({
  chromeStorage: {
    getItem: (...args: any[]) => mockStorageGet(...args),
    setItem: (...args: any[]) => mockStorageSet(...args),
  },
}));
jest.mock('../notification-manager', () => ({
  notificationManager: { notifyDappConnection: jest.fn() },
}));

import { notificationManager } from '../notification-manager';
import { rehydrate } from 'state/dapp';
import { walletPersistenceGate } from 'state/paliStorage';
import store, { persistMainStateStrict } from 'state/store';
import { restoreVaultSnapshot } from 'state/vault';
import { INetworkType, KeyringAccountType } from 'types/network';

import DAppController from './DAppController';

const host = 'https://connection.invalid';
const type = KeyringAccountType.HDAccount;
const address = `0x${'11'.repeat(20)}`;
const clone = (value: any) => JSON.parse(JSON.stringify(value));
let disk: any;
let controller: ReturnType<typeof DAppController>;
const context = (id = 0) => ({
  address: store.getState().vault.accounts[type][id].address,
  xpub: store.getState().vault.accounts[type][id].xpub,
  network: { ...store.getState().vault.activeNetwork },
});
const details = (id = 0) => ({
  host,
  accountId: id,
  accountType: type,
  chain: INetworkType.Ethereum,
  chainId: 1,
  date: 1,
});
const connect = (id = 0) => controller.connect(details(id), context(id));
const holdWrite = () => {
  let finish!: () => void;
  mockStorageSet.mockImplementationOnce(async (_key, value) => {
    const snapshot = clone(value);
    await new Promise<void>((resolve) => (finish = resolve));
    disk = snapshot;
  });
  return async () => {
    await new Promise(setImmediate);
    return finish;
  };
};

beforeEach(async () => {
  jest.clearAllMocks();
  walletPersistenceGate.blocked = false;
  store.dispatch(rehydrate({ dapps: {} }));
  const vault = store.getState().vault;
  store.dispatch(
    restoreVaultSnapshot({
      ...vault,
      isBitcoinBased: false,
      activeAccount: { id: 0, type },
      activeNetwork: {
        ...vault.activeNetwork,
        kind: INetworkType.Ethereum,
        chainId: 1,
        slip44: 60,
        url: 'https://rpc.invalid',
      },
      accounts: {
        ...vault.accounts,
        [type]: {
          0: { id: 0, address, xpub: 'public-identity-a' },
          1: {
            id: 1,
            address: `0x${'22'.repeat(20)}`,
            xpub: 'public-identity-b',
          },
        },
      },
    } as any)
  );
  (chrome.runtime as any).id = 'test-extension';
  (chrome as any).tabs = { query: jest.fn((_query, reply) => reply([])) };
  (chrome as any).scripting = { executeScript: jest.fn(async () => []) };
  controller = DAppController(() => true);
  mockStorageSet.mockImplementation(async (_key, value) => {
    disk = clone(value);
  });
  await persistMainStateStrict();
  mockStorageSet.mockClear();
});

it('publishes a normal connection only after durable storage and restores it after restart', async () => {
  const waitForWrite = holdWrite();
  let settled = false;
  const request = connect().then(() => (settled = true));
  const finish = await waitForWrite();
  expect(settled).toBe(false);
  expect(controller.isConnected(host)).toBe(false);
  expect(controller.getAccount(host)).toBeNull();
  expect(notificationManager.notifyDappConnection).not.toHaveBeenCalled();
  expect(chrome.tabs.query).not.toHaveBeenCalled();
  finish();
  await request;
  expect(mockStorageSet).toHaveBeenCalledTimes(1);
  expect(disk.dapp.dapps[host]).toEqual(details());
  expect(notificationManager.notifyDappConnection).toHaveBeenCalledWith(
    host,
    true
  );
  expect(chrome.tabs.query).toHaveBeenCalledTimes(1);
  store.dispatch(rehydrate(clone(disk.dapp)));
  expect(DAppController(() => true).getAccount(host).address).toBe(address);
});

it('publishes an existing account change only after its durable write', async () => {
  await connect();
  const previous = controller.get(host);
  const waitForWrite = holdWrite();
  const change = controller.changeAccount(host, 1, type, context(1));
  const finish = await waitForWrite();
  expect(controller.get(host)).toBe(previous);
  expect(controller.getAccount(host).address).toBe(address);
  expect(disk.dapp.dapps[host].accountId).toBe(0);
  finish();
  await change;
  expect(controller.get(host)?.accountId).toBe(1);
  store.dispatch(rehydrate(clone(disk.dapp)));
  expect(DAppController(() => true).getAccount(host).address).toBe(
    store.getState().vault.accounts[type][1].address
  );
});

it('keeps an account change unpublished on write failure and allows a durable retry', async () => {
  await connect();
  const previous = controller.get(host);
  mockStorageSet.mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(
    controller.changeAccount(host, 1, type, context(1))
  ).rejects.toThrow('Storage unavailable');
  expect(controller.get(host)).toBe(previous);
  expect(disk.dapp.dapps[host].accountId).toBe(0);
  await controller.changeAccount(host, 1, type, context(1));
  expect(disk.dapp.dapps[host].accountId).toBe(1);
});

it('does not turn a disconnected account-change request into a new grant', async () => {
  await expect(
    controller.changeAccount(host, 1, type, context(1))
  ).rejects.toThrow('DApp does not exist');
  expect(controller.isConnected(host)).toBe(false);
  expect(mockStorageSet).not.toHaveBeenCalled();
});

it('shares pending ownership between account changes and permission grants', async () => {
  await connect();
  const waitForWrite = holdWrite();
  const change = controller.changeAccount(host, 1, type, context(1));
  const finish = await waitForWrite();
  await expect(
    Promise.resolve().then(() =>
      controller.requestPermissions(host, 0, type, context())
    )
  ).rejects.toThrow('already pending');
  finish();
  await change;
  expect(disk.dapp.dapps[host].accountId).toBe(1);
});

it('does not republish an account change revoked while its storage write is pending', async () => {
  await connect();
  const waitForWrite = holdWrite();
  const change = controller.changeAccount(host, 1, type, context(1));
  const rejected = expect(change).rejects.toThrow('context changed');
  const finish = await waitForWrite();
  const revoke = controller.disconnect(host, true, {
    allowAlreadyDisconnected: true,
    propagateErrors: true,
  });
  finish();
  await Promise.all([rejected, revoke]);
  expect(controller.isConnected(host)).toBe(false);
  expect(disk.dapp.dapps[host]).toBeUndefined();
});

it.each([false, true])(
  'preserves the previous grant and allows retry after storage failure (existing=%s)',
  async (existing) => {
    if (existing) await connect(1);
    const previous = controller.get(host);
    const previousDisk = clone(disk.dapp);
    jest.mocked(notificationManager.notifyDappConnection).mockClear();
    jest.mocked(chrome.tabs.query).mockClear();
    mockStorageSet.mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(connect()).rejects.toThrow('Storage unavailable');
    expect(controller.get(host)).toBe(previous);
    expect(disk.dapp).toEqual(previousDisk);
    expect(notificationManager.notifyDappConnection).not.toHaveBeenCalled();
    expect(chrome.tabs.query).not.toHaveBeenCalled();
    await connect();
    expect(disk.dapp.dapps[host]).toEqual(details());
  }
);

it.each(['address', 'xpub', 'chainId', 'url', 'slip44', 'family'])(
  'repairs a staged write after %s changes and preserves an existing connection',
  async (change) => {
    await connect(1);
    const previous = controller.get(host);
    const previousDisk = clone(disk.dapp);
    jest.mocked(notificationManager.notifyDappConnection).mockClear();
    jest.mocked(chrome.tabs.query).mockClear();
    const waitForWrite = holdWrite();
    const request = connect();
    const rejected = expect(request).rejects.toThrow('context changed');
    const finish = await waitForWrite();
    const vault = store.getState().vault;
    const changed = clone(vault);
    if (change === 'address')
      changed.accounts[type][0].address = `0x${'33'.repeat(20)}`;
    if (change === 'xpub')
      changed.accounts[type][0].xpub = 'replacement-public-identity';
    if (change === 'chainId') changed.activeNetwork.chainId = 2;
    if (change === 'url')
      changed.activeNetwork.url = 'https://replacement.invalid';
    if (change === 'slip44') changed.activeNetwork.slip44 = 61;
    if (change === 'family') {
      changed.activeNetwork.kind = INetworkType.Syscoin;
      changed.isBitcoinBased = true;
    }
    store.dispatch(restoreVaultSnapshot(changed));
    finish();
    await rejected;
    expect(controller.get(host)).toBe(previous);
    expect(disk.dapp).toEqual(previousDisk);
    expect(notificationManager.notifyDappConnection).not.toHaveBeenCalled();
    expect(chrome.tabs.query).not.toHaveBeenCalled();
  }
);

it('refuses absent or stale reviewed context before publishing or saving', async () => {
  await expect(controller.connect(details(), undefined as any)).rejects.toThrow(
    'context is required'
  );
  const reviewed = context();
  reviewed.address = `0x${'44'.repeat(20)}`;
  await expect(controller.connect(details(), reviewed)).rejects.toThrow(
    'Account context changed'
  );
  await expect(
    controller.connect({ ...details(), chainId: 2 }, context())
  ).rejects.toThrow('Connection network context changed');
  expect(mockStorageSet).not.toHaveBeenCalled();
  expect(controller.isConnected(host)).toBe(false);
});

it.each(['connect', 'requestPermissions'])(
  'serializes %s against the other pending grant path',
  async (firstMethod) => {
    const waitForWrite = holdWrite();
    const first =
      firstMethod === 'connect'
        ? connect()
        : controller.requestPermissions(host, 0, type, context());
    const finish = await waitForWrite();
    if (firstMethod === 'connect')
      expect(() =>
        controller.requestPermissions(host, 0, type, context())
      ).toThrow('already pending');
    else await expect(connect()).rejects.toThrow('already pending');
    expect(mockStorageSet).toHaveBeenCalledTimes(1);
    finish();
    await first;
    expect(disk.dapp.dapps[host].accountId).toBe(0);
  }
);

it('does not publish a pending connection revoked before its write completes', async () => {
  const waitForWrite = holdWrite();
  const pending = connect();
  const rejected = expect(pending).rejects.toThrow('context changed');
  const finish = await waitForWrite();
  const revocation = controller.disconnect(host, true, {
    allowAlreadyDisconnected: true,
    propagateErrors: true,
  });
  finish();
  await Promise.all([rejected, revocation]);
  expect(controller.isConnected(host)).toBe(false);
  expect(disk.dapp.dapps[host]).toBeUndefined();
  expect(notificationManager.notifyDappConnection).not.toHaveBeenCalledWith(
    host,
    true
  );
});
