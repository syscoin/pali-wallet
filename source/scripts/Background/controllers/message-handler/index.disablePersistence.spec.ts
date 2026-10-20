import { notificationManager } from '../../notification-manager';
import DAppController from '../DAppController';
import { rehydrate } from 'state/dapp';
import { loadState, walletPersistenceGate } from 'state/paliStorage';
import store, { persistMainStateStrict } from 'state/store';
import { restoreVaultSnapshot } from 'state/vault';
import { INetworkType, KeyringAccountType } from 'types/network';

import { onMessage } from './index';
import { getPipelineInstance } from './request-pipeline';

let mockController: any;
jest.mock('scripts/Background', () => ({
  getController: () => mockController,
}));
jest.mock('../../notification-manager', () => ({
  notificationManager: { notifyDappConnection: jest.fn() },
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({ PsbtUtils: {} }));

const HOST = 'https://legacy-disable.invalid';
const ACCOUNT = '0x1111111111111111111111111111111111111111';
const grant = {
  host: HOST,
  accountId: 0,
  accountType: KeyringAccountType.HDAccount,
  chain: INetworkType.Ethereum,
  chainId: 1,
  date: 1,
};
const sender = {
  url: `${HOST}/page`,
  tab: { id: 1 },
} as chrome.runtime.MessageSender;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const originalChrome = global.chrome;
let records: Record<string, any>;
let failNextStateWrite: boolean;
let controller: ReturnType<typeof DAppController>;
let stateWrites: any[];
const removedListeners = new Set<(...args: any[]) => void>();
const updatedListeners = new Set<(...args: any[]) => void>();

const disable = () => onMessage({ type: 'DISABLE' }, sender);
const revoke = () =>
  onMessage(
    {
      type: 'METHOD_REQUEST',
      data: {
        method: 'wallet_revokePermissions',
        // Standard provider permission name.
        // eslint-disable-next-line camelcase
        params: [{ eth_accounts: {} }],
      },
    },
    sender
  );
const restartFromStorage = async () => {
  const saved = await loadState();
  store.dispatch(rehydrate(saved.dapp));
  const restored = DAppController(() => true);
  restored.setup(sender);
  return restored;
};
const clearExistingPermission = async () => {
  store.dispatch(rehydrate({ dapps: {} }));
  await persistMainStateStrict();
  stateWrites = [];
  controller = DAppController(() => true);
  mockController.dapp = controller;
};
const approveConnection = () =>
  controller.connect(grant, {
    address: ACCOUNT,
    xpub: 'public-disable-account',
    network: store.getState().vault.activeNetwork,
  });
const holdNextStateWrite = () => {
  const original = chrome.storage.local.set;
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve));
  let held = false;
  jest
    .spyOn(chrome.storage.local, 'set')
    .mockImplementation((items: any, callback: any) => {
      if (items.state && !held) {
        held = true;
        const snapshot = clone(items);
        release = () => original(snapshot, callback);
        entered();
      } else original(items, callback);
    });
  return { started, release: () => release() };
};

beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  records = {};
  stateWrites = [];
  failNextStateWrite = false;
  removedListeners.clear();
  updatedListeners.clear();
  global.chrome = {
    runtime: { id: 'synthetic-disable' },
    tabs: {
      query: jest.fn((_query, callback) => callback([])),
      onRemoved: {
        addListener: (listener: (...args: any[]) => void) =>
          removedListeners.add(listener),
        removeListener: (listener: (...args: any[]) => void) =>
          removedListeners.delete(listener),
      },
      onUpdated: {
        addListener: (listener: (...args: any[]) => void) =>
          updatedListeners.add(listener),
        removeListener: (listener: (...args: any[]) => void) =>
          updatedListeners.delete(listener),
      },
    },
    scripting: { executeScript: jest.fn(async () => []) },
    storage: {
      local: {
        get: (keys: string[], callback: any) =>
          callback(
            Object.fromEntries(
              keys
                .filter((key) => key in records)
                .map((key) => [key, clone(records[key])])
            )
          ),
        set: (items: any, callback: any) => {
          if (items.state) stateWrites.push(clone(items.state));
          if (items.state && failNextStateWrite) {
            failNextStateWrite = false;
            (chrome.runtime as any).lastError = {
              message: 'Permission storage unavailable',
            };
            callback();
            delete (chrome.runtime as any).lastError;
            return;
          }
          Object.assign(records, clone(items));
          callback();
        },
      },
    },
  } as any;
  walletPersistenceGate.blocked = false;
  const vault = store.getState().vault;
  store.dispatch(
    restoreVaultSnapshot({
      ...vault,
      isBitcoinBased: false,
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      activeNetwork: {
        kind: INetworkType.Ethereum,
        chainId: 1,
        slip44: 60,
        url: 'https://synthetic-disable-rpc.invalid',
        label: 'Synthetic EVM',
        currency: 'eth',
      },
      accounts: {
        ...vault.accounts,
        [KeyringAccountType.HDAccount]: {
          0: { id: 0, address: ACCOUNT, xpub: 'public-disable-account' },
        },
      },
    } as any)
  );
  store.dispatch(rehydrate({ dapps: { [HOST]: grant } }));
  await persistMainStateStrict();
  stateWrites = [];
  controller = DAppController(() => true);
  controller.setup(sender);
  mockController = {
    dapp: controller,
    wallet: { isUnlocked: () => true },
  };
});

afterEach(() => {
  expect(removedListeners.size).toBe(0);
  expect(updatedListeners.size).toBe(0);
  expect(getPipelineInstance()?.getQueueLength()).toBe(0);
  expect(getPipelineInstance()?.isCurrentlyProcessing()).toBe(false);
  global.chrome = originalChrome;
  jest.restoreAllMocks();
});

it('keeps legacy disable success undefined and removes the grant across storage reload', async () => {
  await expect(disable()).resolves.toBeUndefined();
  expect(controller.isConnected(HOST)).toBe(false);
  expect(records.state.dapp.dapps[HOST]).toBeUndefined();
  expect(stateWrites).toHaveLength(1);
  expect((await restartFromStorage()).isConnected(HOST)).toBe(false);
});

it('keeps the legacy missing-connection error rather than making it an idempotent success', async () => {
  await disable();
  stateWrites = [];
  await expect(disable()).resolves.toEqual({
    error: { message: 'DApp not connected', code: -32603 },
  });
  expect(stateWrites).toHaveLength(0);
});

it('disables a stored permission before the first runtime session is established', async () => {
  controller = DAppController(() => true);
  mockController.dapp = controller;
  await expect(disable()).resolves.toBeUndefined();
  expect(controller.isConnected(HOST)).toBe(false);
  expect((await restartFromStorage()).isConnected(HOST)).toBe(false);
});

it.each([false, true])(
  'reports legacy disable storage failure and preserves the retryable grant (session=%s)',
  async (hasSession) => {
    if (!hasSession) {
      controller = DAppController(() => true);
      mockController.dapp = controller;
    }
    failNextStateWrite = true;
    const result = await disable();
    const liveConnected = controller.isConnected(HOST);
    const notifications = jest.mocked(notificationManager.notifyDappConnection)
      .mock.calls.length;
    expect(records.state.dapp.dapps[HOST]).toEqual(grant);
    const restored = await restartFromStorage();
    expect({
      result,
      liveConnected,
      coldConnected: restored.isConnected(HOST),
      notifications,
    }).toEqual({
      result: {
        error: { message: 'Permission storage unavailable', code: -32603 },
      },
      liveConnected: true,
      coldConnected: true,
      notifications: 0,
    });
    mockController.dapp = restored;
    await expect(disable()).resolves.toBeUndefined();
    expect(stateWrites).toHaveLength(2);
    expect((await restartFromStorage()).isConnected(HOST)).toBe(false);
  }
);

it('returns the modern revoke error through the same handler and preserves its durable retry', async () => {
  failNextStateWrite = true;
  await expect(revoke()).resolves.toEqual({
    error: { message: 'Permission storage unavailable', code: -32603 },
  });
  expect(controller.isConnected(HOST)).toBe(true);
  expect((await restartFromStorage()).isConnected(HOST)).toBe(true);
  await expect(revoke()).resolves.toBeNull();
  expect(records.state.dapp.dapps[HOST]).toBeUndefined();
});

it('keeps modern revoke success idempotent while legacy disable still rejects an absent grant', async () => {
  await expect(revoke()).resolves.toBeNull();
  stateWrites = [];
  await expect(revoke()).resolves.toBeNull();
  expect(stateWrites).toHaveLength(0);
  await expect(disable()).resolves.toEqual({
    error: { message: 'DApp not connected', code: -32603 },
  });
});

it('publishes a healthy pending approval only after its real write completes', async () => {
  await clearExistingPermission();
  const held = holdNextStateWrite();
  const approval = approveConnection();
  await held.started;
  expect(controller.isConnected(HOST)).toBe(false);
  expect(records.state.dapp.dapps[HOST]).toBeUndefined();
  held.release();
  await approval;
  expect(controller.isConnected(HOST)).toBe(true);
  expect(records.state.dapp.dapps[HOST]).toEqual(grant);
  expect((await restartFromStorage()).isConnected(HOST)).toBe(true);
});

it('successfully cancels an unpublished approval and repairs its already-started write before replying', async () => {
  await clearExistingPermission();
  const held = holdNextStateWrite();
  const approval = approveConnection();
  const rejectedApproval = expect(approval).rejects.toThrow(
    'Permission grant context changed'
  );
  await held.started;
  const cancellation = disable();
  held.release();
  await rejectedApproval;
  await expect(cancellation).resolves.toBeUndefined();
  expect(controller.isConnected(HOST)).toBe(false);
  expect(records.state.dapp.dapps[HOST]).toBeUndefined();
  expect((await restartFromStorage()).isConnected(HOST)).toBe(false);
  expect(notificationManager.notifyDappConnection).not.toHaveBeenCalledWith(
    HOST,
    true
  );
});

it.each([false, true])(
  'cancels an approval queued before its first write and reports cancellation persistence failure=%s',
  async (failCancellation) => {
    await clearExistingPermission();
    const held = holdNextStateWrite();
    // A real unrelated state write occupies the shared writer while consent
    // registers its pending attempt. No grant result or mutex is substituted.
    const earlierWrite = persistMainStateStrict();
    await held.started;
    const approval = approveConnection();
    const rejectedApproval = expect(approval).rejects.toThrow(
      'Permission grant context changed'
    );
    const cancellation = disable();
    held.release();
    failNextStateWrite = failCancellation;
    await earlierWrite;
    await rejectedApproval;
    if (failCancellation) {
      await expect(cancellation).resolves.toEqual({
        error: { message: 'Permission storage unavailable', code: -32603 },
      });
      await expect(disable()).resolves.toBeUndefined();
    } else {
      await expect(cancellation).resolves.toBeUndefined();
    }
    expect(controller.isConnected(HOST)).toBe(false);
    expect(records.state.dapp.dapps[HOST]).toBeUndefined();
    expect((await restartFromStorage()).isConnected(HOST)).toBe(false);
    expect(notificationManager.notifyDappConnection).not.toHaveBeenCalledWith(
      HOST,
      true
    );
  }
);
