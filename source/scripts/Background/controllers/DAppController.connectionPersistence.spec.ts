const mockStorageGet = jest.fn<Promise<any>, any[]>(async () => null);
const mockStorageSet = jest.fn();
const mockStorageGetItems = jest.fn<
  Promise<Record<string, unknown>>,
  [string[]]
>();
const mockApprovalController = jest.fn();
jest.mock('scripts/Background', () => ({
  getController: () => mockApprovalController(),
}));
jest.mock('utils/storageAPI', () => ({
  chromeStorage: {
    getItem: (...args: any[]) => mockStorageGet(...args),
    getItems: (keys: string[]) => mockStorageGetItems(keys),
    setItem: (...args: any[]) => mockStorageSet(...args),
  },
}));
jest.mock('../notification-manager', () => ({
  notificationManager: { notifyDappConnection: jest.fn() },
}));

import { smartAccountAddressFixture } from '../../../../tests/fixtures/smartAccountAddress';
import { handleMasterControllerResponses } from '../handlers/handleMasterControllerResponses';
import {
  getMessageSignGrantReplacement,
  watchConnectedMessageSignGrant,
} from '../handlers/messageSignApproval';
import { notificationManager } from '../notification-manager';
import { rehydrate } from 'state/dapp';
import { walletPersistenceGate } from 'state/paliStorage';
import store, { persistMainStateStrict } from 'state/store';
import { restoreVaultSnapshot, setActiveAccount } from 'state/vault';
import { INetworkType, KeyringAccountType } from 'types/network';
import { APPROVAL_CLIENT_READY, APPROVAL_REGISTER } from 'utils/approvalClient';
import { hashMessage } from 'utils/ethersV6Compat';
import {
  SLH_DSA_PARAMETER_SET,
  SLH_DSA_SIGNATURE_LENGTH,
  clearRuntimeSLHDSAStates,
  getSLHDSASessionGeneration,
  configureSLHDSASessionStateCrypto,
  createSLHDSAProvisionedState,
  getSLHDSAKeyId,
  getSLHDSAStateStorageKey,
  loadEncryptedSLHDSAState,
  putRuntimeSLHDSAState,
  saveEncryptedSLHDSAState,
} from 'utils/slhDsa';
import {
  buildPaliErc7739TypedDataRequest,
  getPaliErc7739PersonalSignHash,
  type PaliErc7739TypedData,
} from 'utils/smartAccount/erc7739';
import {
  getSmartAccountLocalOwnerContexts,
  signSmartAccountActionHash,
} from 'utils/smartAccount/execution';

import DAppController from './DAppController';
import MainController from './MainController';
import { EthMethodHandler } from './message-handler/method-handlers';
import { getMethodConfig } from './message-handler/method-registry';
import {
  accountSwitchingMiddleware,
  RequestPipeline,
} from './message-handler/request-pipeline';
import type { IEnhancedRequestContext } from './message-handler/types';

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
  mockStorageGetItems.mockResolvedValue({});
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
  controller = DAppController(
    () => true,
    () => 0
  );
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
  expect(mockStorageSet).toHaveBeenCalledTimes(2);
  expect(disk.dapp.dapps[host]).toEqual(details());
  expect(notificationManager.notifyDappConnection).toHaveBeenCalledWith(
    host,
    true
  );
  expect(chrome.tabs.query).toHaveBeenCalledTimes(1);
  store.dispatch(rehydrate(clone(disk.dapp)));
  expect(
    DAppController(
      () => true,
      () => 0
    ).getAccount(host).address
  ).toBe(address);
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
  expect(
    DAppController(
      () => true,
      () => 0
    ).getAccount(host).address
  ).toBe(store.getState().vault.accounts[type][1].address);
});

it('continues a connected request through its exact durable account-selection successor only', async () => {
  await connect();
  const scope = watchConnectedMessageSignGrant({
    host,
    method: 'personal_sign',
    sender: { documentId: 'site-document', url: host, origin: host },
    type: 'METHOD_REQUEST',
  })!;
  try {
    const waitForWrite = holdWrite();
    const change = controller.changeAccount(
      host,
      1,
      type,
      context(1),
      getMessageSignGrantReplacement(scope.signal)
    );
    const finish = await waitForWrite();
    expect(scope.signal.aborted).toBe(false);
    expect(controller.get(host)?.accountId).toBe(0);
    finish();
    await change;
    expect(controller.get(host)?.accountId).toBe(1);
    expect(scope.signal.aborted).toBe(false);

    await controller.changeAccount(host, 0, type, context());
    expect(scope.signal.aborted).toBe(true);
  } finally {
    scope.dispose();
  }
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
  const revoke = controller.revoke(host, { allowAlreadyDisconnected: true });
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
    expect(disk.dapp).toEqual({ ...previousDisk, pendingOrigins: [] });
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
  const revocation = controller.revoke(host, {
    allowAlreadyDisconnected: true,
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

describe('connected personal-sign approval authority', () => {
  const message = 'Read this message';
  const createPopup = jest.fn();
  const signPersonalMessage = jest.fn(async () => 'synthetic-signature');
  const signTypedData = jest.fn(async () => 'synthetic-typed-signature');
  const signSmartAccountActionDigestInternal = jest.fn(
    async () => 'synthetic-owner-signature'
  );
  const slhSigningHost = Object.assign(
    Object.create(MainController.prototype),
    {
      assertWalletReadyForSigning: jest.fn(),
      assertCurrentWalletSession: jest.fn(),
      configureSLHDSASessionStateCrypto: jest.fn(),
      getSLHDSASessionStateCrypto: jest.fn(),
      walletSessionGeneration: 1,
    }
  );
  const wallet = {
    signSLHDSAActionHash:
      MainController.prototype.signSLHDSAActionHash.bind(slhSigningHost),
    signSmartAccountActionDigestInternal,
    getWalletSessionGeneration: () => sessionGeneration,
    ethereumTransaction: { signPersonalMessage, signTypedData },
  };
  const getURL = (path = '') => `chrome-extension://test-extension/${path}`;
  const sendMessage = jest.fn(async () => ({ documentActive: true }));
  const getClient = jest.fn<Promise<{ url: string } | undefined>, [string]>();
  const popupNavigation = new Set<
    (tabId: number, change: chrome.tabs.TabChangeInfo) => void
  >();
  let workerMessage: (event: any) => void;
  let sessionGeneration: number;

  beforeEach(() => {
    sessionGeneration = 1;
    popupNavigation.clear();
    jest.spyOn(console, 'error').mockImplementation();
    Object.assign(crypto, {
      randomUUID: jest.fn(() => 'synthetic-approval-id'),
    });
    Object.assign(chrome.runtime, { getURL });
    Object.assign(chrome.tabs, {
      sendMessage,
      onUpdated: {
        addListener: (listener: Parameters<typeof popupNavigation.add>[0]) =>
          popupNavigation.add(listener),
        removeListener: (
          listener: Parameters<typeof popupNavigation.delete>[0]
        ) => popupNavigation.delete(listener),
      },
    });
    Object.assign(chrome, {
      windows: {
        onRemoved: { addListener: jest.fn(), removeListener: jest.fn() },
        remove: jest.fn((_id, callback) => callback?.()),
      },
    });
    Object.assign(self, {
      clients: { get: getClient },
      addEventListener: jest.fn(
        (_type, listener) => (workerMessage = listener)
      ),
      removeEventListener: jest.fn(),
    });
    mockApprovalController.mockReturnValue({
      createPopup,
      dapp: controller,
      wallet,
    });
    handleMasterControllerResponses({ wallet } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  const openApproval = async (
    start = (request: IEnhancedRequestContext) =>
      new EthMethodHandler().handle(request),
    method = 'personal_sign',
    params: unknown[] = [message, address],
    frameId = 0
  ) => {
    let opened!: (data: object) => void;
    const created = new Promise<object>((resolve) => (opened = resolve));
    createPopup.mockImplementation(async (_route, data) => {
      opened(data);
      return { id: 9 };
    });
    const actionListener = (chrome.runtime.onMessage.addListener as jest.Mock)
      .mock.lastCall[0];
    const outcome = start({
      methodConfig: getMethodConfig(method)!,
      originalRequest: {
        host,
        method,
        params,
        sender: {
          documentId: 'site-document',
          frameId,
          tab: { id: 7 },
          url: `${host}/page`,
          origin: host,
        } as chrome.runtime.MessageSender,
        type: 'METHOD_REQUEST',
      },
    }).then(
      (value) => ({ value }),
      (error) => ({ code: error.code ?? error.message })
    );
    const data: any = await Promise.race([
      created,
      outcome.then((result) => {
        throw Error(`Approval did not open: ${JSON.stringify(result)}`);
      }),
    ]);
    const registrationListener = (
      chrome.runtime.onMessage.addListener as jest.Mock
    ).mock.lastCall[0];
    const sender = {
      id: chrome.runtime.id,
      documentId: 'approval-document',
      frameId: 0,
      tab: { id: 19, windowId: 9 },
      url: `${getURL('external.html')}?data=${encodeURIComponent(
        JSON.stringify(data)
      )}`,
    };
    const reply = jest.fn();
    registrationListener(
      { type: APPROVAL_REGISTER, approvalId: data.approvalId },
      sender,
      reply
    );
    await new Promise(setImmediate);
    const registration = reply.mock.lastCall[0];
    expect(registration.status).toBe('registered');
    const source = { id: 'approval-client', url: sender.url };
    getClient.mockResolvedValue({ url: source.url });
    const port = { postMessage: jest.fn(), close: jest.fn() };
    workerMessage({
      source,
      data: {
        eventName: APPROVAL_CLIENT_READY,
        approvalId: data.approvalId,
        challenge: registration.challenge,
      },
      ports: [port],
    });
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ready' })
    );
    const invoke = (
      methods: string[],
      args: unknown[],
      documentId = sender.documentId
    ) =>
      new Promise((resolve) => {
        actionListener(
          { type: 'CONTROLLER_ACTION', data: { methods, params: args } },
          { ...sender, documentId },
          resolve
        );
      });
    return {
      data,
      source,
      outcome,
      invoke,
      approve: (payload = message, documentId = sender.documentId) =>
        invoke(
          ['wallet', 'ethereumTransaction', 'signPersonalMessage'],
          [{ ...data, 0: address, 1: payload }],
          documentId
        ),
      reply: (value: unknown) =>
        workerMessage({
          source,
          data: {
            eventName: `${data.eventName}.${host}`,
            detail: JSON.stringify(value),
          },
        }),
    };
  };

  const typedMethods = [
    'eth_signTypedData',
    'eth_signTypedData_v3',
    'eth_signTypedData_v4',
  ] as const;
  const typedRequest = (method: (typeof typedMethods)[number]) =>
    method === 'eth_signTypedData'
      ? [{ name: 'text', type: 'string', value: 'Approved typed message' }]
      : {
          types: {
            EIP712Domain: [],
            Message: [{ name: 'text', type: 'string' }],
          },
          domain: {},
          primaryType: 'Message',
          message: { text: 'Approved typed message' },
        };
  const typedVersion = (method: (typeof typedMethods)[number]) =>
    method === 'eth_signTypedData'
      ? 'V1'
      : method === 'eth_signTypedData_v3'
      ? 'V3'
      : 'V4';

  it.each(
    typedMethods.flatMap((method) =>
      ['revoke', 'account', 'network', 'lock'].map(
        (change) => [method, change] as const
      )
    )
  )('does not release delayed %s signing after %s', async (method, change) => {
    await connect();
    const typedData = typedRequest(method);
    const approval = await openApproval(undefined, method, [
      address,
      typedData,
    ]);
    let finishSigning!: (value: string) => void;
    signTypedData.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishSigning = resolve;
        })
    );
    const signing = approval.invoke(
      ['wallet', 'ethereumTransaction', 'signTypedData'],
      [address, typedData, typedVersion(method)]
    );
    await new Promise(setImmediate);
    expect(signTypedData).toHaveBeenCalledTimes(1);
    if (change === 'revoke') {
      await controller.revoke(host, { allowAlreadyDisconnected: false });
    } else if (change === 'account') {
      sessionGeneration += 1;
      store.dispatch(setActiveAccount({ id: 1, type }));
    } else if (change === 'network') {
      sessionGeneration += 1;
      const vault = store.getState().vault;
      store.dispatch(
        restoreVaultSnapshot({
          ...vault,
          activeNetwork: {
            ...vault.activeNetwork,
            chainId: 2,
            url: 'https://next-network.invalid',
          },
        })
      );
    } else {
      // MainController.lock advances this authority before device teardown.
      sessionGeneration += 1;
    }
    finishSigning('synthetic-typed-signature');
    const response = await signing;
    approval.reply(response);
    await approval.outcome;
    expect(response).toMatchObject({ success: false });
    expect(response).not.toBe('synthetic-typed-signature');
  });

  it.each(typedMethods)(
    'signs the exact live %s request through its SDK version',
    async (method) => {
      await connect();
      const typedData = typedRequest(method);
      const approval = await openApproval(undefined, method, [
        address,
        JSON.stringify(typedData),
      ]);
      const response = await approval.invoke(
        ['wallet', 'ethereumTransaction', 'signTypedData'],
        [address, typedData, typedVersion(method)]
      );
      approval.reply(response);
      expect(response).toBe('synthetic-typed-signature');
      expect(signTypedData).toHaveBeenCalledWith(
        address,
        typedData,
        typedVersion(method)
      );
      await expect(approval.outcome).resolves.toEqual({
        value: 'synthetic-typed-signature',
      });
    }
  );

  it.each(['payload', 'version', 'signer', 'method'])(
    'rejects a changed typed-data %s before SDK invocation',
    async (change) => {
      await connect();
      const typedData = typedRequest('eth_signTypedData_v4');
      const approval = await openApproval(undefined, 'eth_signTypedData_v4', [
        address,
        typedData,
      ]);
      const args = [
        change === 'signer' ? `0x${'22'.repeat(20)}` : address,
        change === 'payload'
          ? { ...typedData, message: { text: 'Different message' } }
          : typedData,
        change === 'version' ? 'V3' : 'V4',
      ];
      const response = await approval.invoke(
        [
          'wallet',
          'ethereumTransaction',
          change === 'method' ? 'signPersonalMessage' : 'signTypedData',
        ],
        args
      );
      approval.reply(response);
      await approval.outcome;
      expect(response).toMatchObject({ success: false });
      expect(signTypedData).not.toHaveBeenCalled();
      expect(signPersonalMessage).not.toHaveBeenCalled();
    }
  );

  it.each(['bound', 'unbound'] as const)(
    'rejects raw digest calls from a %s message document',
    async (binding) => {
      await connect();
      const approval = await openApproval(undefined, 'eth_signTypedData_v4', [
        address,
        typedRequest('eth_signTypedData_v4'),
      ]);
      const documentId =
        binding === 'bound' ? undefined : 'not-enrolled-document';
      for (const [methods, args] of [
        [
          ['wallet', 'signSmartAccountActionDigestInternal'],
          [[address, `0x${'77'.repeat(32)}`], { id: 0, type }],
        ],
        [
          ['wallet', 'signSLHDSAActionHash'],
          [{ actionHash: `0x${'77'.repeat(32)}` }],
        ],
        [
          ['wallet', 'ethereumTransaction', 'ethSign'],
          [[address, `0x${'77'.repeat(32)}`]],
        ],
      ] as const) {
        const response = await approval.invoke(
          [...methods],
          [...args],
          documentId
        );
        expect(response).toMatchObject({ success: false });
      }
      expect(signSmartAccountActionDigestInternal).not.toHaveBeenCalled();
      expect(signTypedData).not.toHaveBeenCalled();
      approval.reply(null);
      await approval.outcome;
    }
  );

  describe.each(['personal_sign', 'eth_sendTransaction'])(
    '%s account-switch consent',
    (method) => {
      it.each([true, false])(
        'checks the reviewed Imported slot after popup approval, replaced=%s',
        async (replaced) => {
          const imported = KeyringAccountType.Imported;
          const selected = {
            id: 7,
            address: `0x${'33'.repeat(20)}`,
            xpub: 'reviewed-import',
          };
          const putImported = (account: typeof selected) => {
            const vault = store.getState().vault;
            store.dispatch(
              restoreVaultSnapshot({
                ...vault,
                accounts: {
                  ...vault.accounts,
                  [imported]: { [account.id]: account },
                },
              } as any)
            );
          };
          putImported(selected);
          (chrome.tabs.query as jest.Mock).mockImplementation((_query, reply) =>
            reply([{ id: 7, url: `${host}/page` }])
          );
          await connect();
          await new Promise(setImmediate);
          mockStorageSet.mockClear();
          const notifyTab = chrome.scripting.executeScript as jest.Mock;
          notifyTab.mockClear();

          const pipeline = new RequestPipeline()
            .use(accountSwitchingMiddleware)
            .use(async () => 'continued');
          const approval = await openApproval(
            (request) => pipeline.execute(request),
            method,
            method === 'personal_sign'
              ? [message, selected.address]
              : [{ from: selected.address }]
          );
          expect(approval.data.connectedAccount.address).toBe(selected.address);
          store.dispatch(setActiveAccount({ id: selected.id, type: imported }));

          let started!: () => void;
          let finishSite!: () => void;
          const checking = new Promise<void>((resolve) => (started = resolve));
          sendMessage.mockImplementationOnce(async () => {
            started();
            await new Promise<void>((resolve) => (finishSite = resolve));
            return { documentActive: true };
          });
          approval.reply(null);
          await checking;
          if (replaced)
            putImported({
              ...selected,
              address: `0x${'44'.repeat(20)}`,
              xpub: 'replacement-import',
            });
          const waitForWrite = replaced ? undefined : holdWrite();
          finishSite();
          if (waitForWrite) {
            const finishWrite = await waitForWrite();
            expect(controller.get(host)?.accountId).toBe(0);
            expect(disk.dapp.dapps[host].accountId).toBe(0);
            expect(notifyTab).not.toHaveBeenCalled();
            finishWrite();
          }
          const outcome = await approval.outcome;
          await new Promise(setImmediate);
          expect({
            outcome,
            diskAccount: disk.dapp.dapps[host].accountId,
            publicAddress: controller.getAccount(host)?.address,
            writes: mockStorageSet.mock.calls.length,
            published: notifyTab.mock.calls.map(
              ([call]) => JSON.parse(call.args[0]).data.params
            ),
          }).toEqual(
            replaced
              ? {
                  outcome: {
                    code: 'Account context changed. Please select an account again.',
                  },
                  diskAccount: 0,
                  publicAddress: address,
                  writes: 0,
                  published: [],
                }
              : {
                  outcome: { value: 'continued' },
                  diskAccount: selected.id,
                  publicAddress: selected.address,
                  writes: 2,
                  published: [[selected.address]],
                }
          );
        }
      );
    }
  );

  it('does not call the signer or return a signature after same-document grant revocation', async () => {
    await connect();
    const approval = await openApproval();
    await controller.revoke(host, { allowAlreadyDisconnected: false });
    expect(controller.isConnected(host)).toBe(false);
    expect(disk.dapp.dapps[host]).toBeUndefined();
    const value = await approval.approve();
    approval.reply(value);
    expect({
      calls: signPersonalMessage.mock.calls.length,
      result: await approval.outcome,
    }).toEqual({
      calls: 0,
      result: { code: 4001 },
    });
  });

  type SmartAccountEcdsaTestParams = {
    actionHash: string;
    owner: { address: string; id: number; type: KeyringAccountType };
    validator: string;
  };

  const openSmartApproval = async (composite = false, typed = false) => {
    const smartType = KeyringAccountType.SmartAccount;
    const { account: smart } = smartAccountAddressFixture(1, address);
    const smartAddress = smart.address;
    const validator = `0x${'44'.repeat(20)}`;
    const activeValidator = composite ? `0x${'55'.repeat(20)}` : validator;
    const owner = { address, id: 0, type };
    const vault = store.getState().vault;
    store.dispatch(
      restoreVaultSnapshot({
        ...vault,
        activeAccount: { id: 0, type: smartType },
        accounts: {
          ...vault.accounts,
          [smartType]: {
            0: {
              ...smart,
              id: 0,
              isSmartAccount: true,
              smartAccount: {
                ...smart.smartAccount,
                auth: {
                  module: composite ? 'composite' : 'ecdsa',
                  validator: activeValidator,
                },
                chainId: 1,
                installedModules: [
                  {
                    address: validator,
                    config: { owners: [address], threshold: 1 },
                    id: 'ecdsa',
                    type: 'validator',
                  },
                  ...(composite
                    ? [
                        {
                          address: activeValidator,
                          config: {
                            childValidators: [validator],
                            threshold: 1,
                          },
                          id: 'composite',
                          type: 'validator',
                        },
                      ]
                    : []),
                ],
              },
              type: smartType,
            },
          },
        },
      } as any)
    );
    await controller.connect(
      { ...details(), accountType: smartType },
      {
        address: smartAddress,
        xpub: smart.xpub,
        network: { ...vault.activeNetwork },
      }
    );
    const typedData = typedRequest(
      'eth_signTypedData_v4'
    ) as PaliErc7739TypedData;
    const approval = typed
      ? await openApproval(undefined, 'eth_signTypedData_v4', [
          smartAddress,
          typedData,
        ])
      : await openApproval(undefined, 'personal_sign', [message, smartAddress]);
    const runtime = getSmartAccountLocalOwnerContexts({
      accounts: store.getState().vault.accounts,
      controllerEmitter: (methods: string[], params?: unknown[]) =>
        approval.invoke(methods, params ?? []),
      messageSignValidator: activeValidator,
    }).ecdsa as {
      signActionHash: (params: SmartAccountEcdsaTestParams) => Promise<string>;
    };
    const actionHash = typed
      ? buildPaliErc7739TypedDataRequest({
          accountAddress: smartAddress,
          chainId: 1,
          typedData,
        }).actionHash
      : getPaliErc7739PersonalSignHash({
          accountAddress: smartAddress,
          chainId: 1,
          hash: hashMessage(message),
        });
    return { approval, runtime, args: { actionHash, owner, validator } };
  };

  it.each([false, true])(
    'derives the reviewed smart typed-data digest with composite=%s',
    async (composite) => {
      const { approval, runtime, args } = await openSmartApproval(
        composite,
        true
      );
      const result = await runtime.signActionHash({
        ...args,
        actionHash: `0x${'99'.repeat(32)}`,
      });
      expect(signSmartAccountActionDigestInternal).toHaveBeenCalledWith(
        [address, args.actionHash],
        { id: 0, type },
        undefined,
        expect.any(Function)
      );
      approval.reply(result);
      await expect(approval.outcome).resolves.toEqual({
        value: 'synthetic-owner-signature',
      });
    }
  );

  it.each([true, false])(
    'admits a connected smart-account local ECDSA signer only while its grant is current, revoked=%s',
    async (revoked) => {
      const { approval, runtime, args } = await openSmartApproval();
      if (revoked) {
        await controller.revoke(host, { allowAlreadyDisconnected: false });
        expect(disk.dapp.dapps[host]).toBeUndefined();
      }
      const result = await runtime.signActionHash(args);
      approval.reply(result);
      if (revoked) {
        expect(await approval.outcome).toEqual({ code: 4001 });
        expect(signSmartAccountActionDigestInternal).not.toHaveBeenCalled();
        expect(result).toMatchObject({ success: false });
      } else {
        expect(await approval.outcome).toEqual({
          value: 'synthetic-owner-signature',
        });
        expect(signSmartAccountActionDigestInternal).toHaveBeenCalledTimes(1);
      }
    }
  );

  it.each(['active validator', 'owner slot', 'validator', 'document'])(
    'rejects a smart-account ECDSA bridge request for the wrong %s before calling the signer',
    async (target) => {
      const { approval, runtime, args } = await openSmartApproval();
      let result: unknown;
      switch (target) {
        case 'active validator':
          result = await approval.invoke(
            ['wallet', 'signSmartAccountMessageDigest'],
            [args.owner, `0x${'ab'.repeat(20)}`, args.validator]
          );
          break;
        case 'owner slot':
          result = await runtime.signActionHash({
            ...args,
            owner: { ...args.owner, id: 1 },
          });
          break;
        case 'validator':
          result = await runtime.signActionHash({
            ...args,
            validator: `0x${'ab'.repeat(20)}`,
          });
          break;
        default:
          result = await approval.invoke(
            ['wallet', 'signSmartAccountMessageDigest'],
            [args.owner, args.validator, args.validator],
            'different-document'
          );
      }
      expect(result).toMatchObject({ success: false });
      expect(signSmartAccountActionDigestInternal).not.toHaveBeenCalled();
      const fresh = await runtime.signActionHash(args);
      expect(fresh).toBe('synthetic-owner-signature');
      approval.reply(fresh);
      expect(await approval.outcome).toEqual({ value: fresh });
    }
  );

  it('derives the exact approved ERC-7739 digest without accepting a renderer digest', async () => {
    const { approval, runtime, args } = await openSmartApproval();
    const result = await runtime.signActionHash({
      ...args,
      actionHash: `0x${'ab'.repeat(32)}`,
    });
    expect(signSmartAccountActionDigestInternal).toHaveBeenCalledWith(
      [args.owner.address, args.actionHash],
      { id: args.owner.id, type: args.owner.type },
      undefined,
      expect.any(Function)
    );
    approval.reply(result);
    expect(await approval.outcome).toEqual({ value: result });
  });

  it('admits the exact selected ECDSA child of the active composite validator', async () => {
    const { approval, runtime, args } = await openSmartApproval(true);
    const result = await runtime.signActionHash(args);
    expect(result).toBe('synthetic-owner-signature');
    expect(signSmartAccountActionDigestInternal).toHaveBeenCalledTimes(1);
    approval.reply(result);
    expect(await approval.outcome).toEqual({ value: result });
  });

  it.each(['owner', 'validator'])(
    'permanently retires local ECDSA approval when the %s changes during the real site check',
    async (target) => {
      const { approval, runtime, args } = await openSmartApproval();
      let startCheck!: () => void;
      let finishCheck!: () => void;
      const started = new Promise<void>((resolve) => (startCheck = resolve));
      const held = new Promise<void>((resolve) => (finishCheck = resolve));
      sendMessage.mockImplementationOnce(async () => {
        startCheck();
        await held;
        return { documentActive: true };
      });
      const response = runtime.signActionHash(args);
      await started;
      const vault = store.getState().vault;
      const accountType =
        target === 'owner' ? type : KeyringAccountType.SmartAccount;
      const account = vault.accounts[accountType][0];
      store.dispatch(
        restoreVaultSnapshot({
          ...vault,
          accounts: {
            ...vault.accounts,
            [accountType]: {
              ...vault.accounts[accountType],
              0:
                target === 'owner'
                  ? { ...account, xpub: 'replacement-owner-identity' }
                  : { ...account, smartAccount: { ...account.smartAccount } },
            },
          },
        } as any)
      );
      store.dispatch(restoreVaultSnapshot(vault));
      finishCheck();
      const result = await response;
      expect(result).toMatchObject({ success: false });
      expect(signSmartAccountActionDigestInternal).not.toHaveBeenCalled();
      approval.reply(result);
      expect(await approval.outcome).toEqual({ code: 4001 });
    }
  );

  it('allows a live local owner retry without relaxing retirement', async () => {
    const { approval, runtime, args } = await openSmartApproval();
    await expect(runtime.signActionHash(args)).resolves.toBe(
      'synthetic-owner-signature'
    );
    await expect(runtime.signActionHash(args)).resolves.toBe(
      'synthetic-owner-signature'
    );
    await controller.revoke(host, { allowAlreadyDisconnected: false });
    await expect(runtime.signActionHash(args)).resolves.toMatchObject({
      success: false,
    });
    expect(signSmartAccountActionDigestInternal).toHaveBeenCalledTimes(2);
    expect(await approval.outcome).toEqual({ code: 4001 });
  });

  it('discards a local ECDSA result after the bound grant is revoked', async () => {
    const { approval, runtime, args } = await openSmartApproval();
    let signerStarted!: () => void;
    let finishSigner!: () => void;
    const signing = new Promise<void>((resolve) => (signerStarted = resolve));
    const held = new Promise<void>((resolve) => (finishSigner = resolve));
    signSmartAccountActionDigestInternal.mockImplementationOnce(async () => {
      signerStarted();
      await held;
      return 'signature completed after revocation';
    });
    const response = runtime.signActionHash(args);
    await signing;
    await controller.revoke(host, { allowAlreadyDisconnected: false });
    finishSigner();
    const result = await response;
    expect(result).toMatchObject({ success: false });
    expect(await approval.outcome).toEqual({ code: 4001 });
    expect(signSmartAccountActionDigestInternal).toHaveBeenCalledTimes(1);
  });

  const openSlhApproval = async ({
    composite = false,
    cold = false,
    frameId = 0,
  } = {}) => {
    const smartType = KeyringAccountType.SmartAccount;
    const { account: smart } = smartAccountAddressFixture(1, address);
    const smartAddress = smart.address;
    const slhAddress = `0x${'44'.repeat(20)}`;
    const activeValidator = composite ? `0x${'55'.repeat(20)}` : slhAddress;
    const keys = {
      pkRoot: `0x${'11'.repeat(16)}${'00'.repeat(16)}`,
      pkSeed: `0x${'22'.repeat(16)}${'00'.repeat(16)}`,
    };
    const keyId = getSLHDSAKeyId(keys);
    const storageKey = getSLHDSAStateStorageKey(keyId);
    const stateCrypto = {
      decrypt: (value: string) => value,
      encrypt: (value: string) => value,
    };
    let persisted: unknown;
    mockStorageGetItems.mockImplementation(async (requested) =>
      requested.includes(storageKey) && persisted
        ? { [storageKey]: persisted }
        : {}
    );
    mockStorageSet.mockImplementation(async (key, value) => {
      if (key === storageKey) persisted = clone(value);
      else disk = clone(value);
    });
    clearRuntimeSLHDSAStates();
    configureSLHDSASessionStateCrypto(stateCrypto);
    slhSigningHost.getSLHDSASessionStateCrypto.mockReturnValue(stateCrypto);
    const provisioned = createSLHDSAProvisionedState({
      ...keys,
      accountIndex: 0,
      derivationLabel: 'account/0',
      keyId,
      secretKeyHex: `0x${'66'.repeat(64)}`,
    });
    await saveEncryptedSLHDSAState(provisioned, stateCrypto, () => undefined);
    if (!cold) putRuntimeSLHDSAState(provisioned, getSLHDSASessionGeneration());

    const metadata = {
      ...smart.smartAccount,
      auth: {
        module: composite ? 'composite' : 'slh-dsa',
        validator: activeValidator,
      },
      chainId: 1,
      installedModules: [
        {
          address: slhAddress,
          config: {
            ...keys,
            keyId,
            parameterSet: SLH_DSA_PARAMETER_SET,
            signatureLimit: provisioned.signatureLimit,
          },
          id: 'slh-dsa',
          type: 'validator',
        },
        ...(composite
          ? [
              {
                address: activeValidator,
                config: { childValidators: [slhAddress], threshold: 1 },
                id: 'composite',
                type: 'validator',
              },
            ]
          : []),
      ],
    } as any;
    const vault = store.getState().vault;
    store.dispatch(
      restoreVaultSnapshot({
        ...vault,
        activeAccount: { id: 0, type: smartType },
        accounts: {
          ...vault.accounts,
          [smartType]: {
            0: {
              ...smart,
              id: 0,
              isSmartAccount: true,
              smartAccount: metadata,
              type: smartType,
            },
          },
        },
      } as any)
    );
    await controller.connect(
      { ...details(), accountType: smartType },
      {
        address: smartAddress,
        xpub: smart.xpub,
        network: { ...vault.activeNetwork },
      }
    );
    const approval = await openApproval(
      undefined,
      'personal_sign',
      [message, smartAddress],
      frameId
    );
    const actionHash = getPaliErc7739PersonalSignHash({
      accountAddress: smartAddress,
      chainId: 1,
      hash: hashMessage(message),
    });
    const sign = (signingMetadata = metadata, rendererDigest = actionHash) =>
      signSmartAccountActionHash({
        assertBeforeAuthentication: async () => undefined,
        actionHash: rendererDigest,
        authenticatorContexts: getSmartAccountLocalOwnerContexts({
          accounts: store.getState().vault.accounts,
          controllerEmitter: async (methods, params) => {
            const response = await approval.invoke(methods, params ?? []);
            if (response && typeof response === 'object' && 'error' in response)
              throw new Error(String(response.error));
            return response;
          },
          messageSignValidator: signingMetadata.auth.validator,
        }),
        smartAccount: signingMetadata,
      });
    const {
      getContexts: originalGetContexts,
      sendMessage: originalSendMessage,
    } = chrome.runtime;
    return {
      actionHash,
      activeValidator,
      approval,
      keyId,
      keys,
      metadata,
      sign,
      slhAddress,
      dispose() {
        Object.assign(chrome.runtime, {
          getContexts: originalGetContexts,
          sendMessage: originalSendMessage,
        });
        clearRuntimeSLHDSAStates();
      },
      readCount: async () =>
        (
          await loadEncryptedSLHDSAState({
            crypto: stateCrypto,
            keyId,
            assertOwner: () => undefined,
          })
        )?.signatureCount,
    };
  };

  it.each(['before offscreen dispatch', 'after offscreen dispatch'])(
    'retires a connected SLH-DSA personal-sign approval revoked %s without losing usage accounting',
    async (phase) => {
      const fixture = await openSlhApproval();
      const signature = `0x${'77'.repeat(SLH_DSA_SIGNATURE_LENGTH)}`;
      const response = { success: true, result: { signature } };
      let beginHold!: () => void;
      let endHold!: () => void;
      const started = new Promise<void>((resolve) => (beginHold = resolve));
      const held = new Promise<void>((resolve) => (endHold = resolve));
      const getContexts = jest.fn(async () => {
        if (phase === 'before offscreen dispatch') {
          beginHold();
          await held;
        }
        return [{}];
      });
      const sendOffscreen = jest.fn(async () => {
        if (phase === 'after offscreen dispatch') {
          beginHold();
          await held;
        }
        return response;
      });
      Object.assign(chrome.runtime, {
        getContexts,
        sendMessage: sendOffscreen,
      });
      try {
        const signing = fixture.sign().then(
          () => true,
          () => false
        );
        await started;
        await controller.revoke(host, { allowAlreadyDisconnected: false });
        expect(await fixture.approval.outcome).toEqual({ code: 4001 });
        expect(disk.dapp.dapps[host]).toBeUndefined();
        endHold();
        const afterDispatch = phase === 'after offscreen dispatch';
        expect({
          dispatches: sendOffscreen.mock.calls.length,
          returnedSignature: await signing,
          persistedCount: await fixture.readCount(),
        }).toEqual({
          dispatches: Number(afterDispatch),
          returnedSignature: false,
          persistedCount: Number(afterDispatch),
        });
      } finally {
        fixture.dispose();
      }
    }
  );

  it('rechecks the approved popup after the offscreen context lookup', async () => {
    const fixture = await openSlhApproval();
    let beginHold!: () => void;
    let endHold!: () => void;
    const started = new Promise<void>((resolve) => (beginHold = resolve));
    const held = new Promise<void>((resolve) => (endHold = resolve));
    const sendOffscreen = jest.fn();
    Object.assign(chrome.runtime, {
      getContexts: jest.fn(async () => {
        beginHold();
        await held;
        return [{}];
      }),
      sendMessage: sendOffscreen,
    });
    try {
      const outcome = expect(fixture.sign()).rejects.toThrow(
        'approval is no longer current'
      );
      await started;
      getClient.mockResolvedValue(undefined);
      endHold();
      await outcome;
      expect(controller.isConnected(host)).toBe(true);
      expect(await fixture.approval.outcome).toEqual({ code: 4001 });
      expect(sendOffscreen).not.toHaveBeenCalled();
      expect(await fixture.readCount()).toBe(0);
    } finally {
      fixture.dispose();
    }
  });

  it('rechecks a removed requesting iframe after the held offscreen approver probe', async () => {
    // Keep the popup's periodic site check from masking the dispatch race.
    jest.useFakeTimers({
      doNotFake: ['setImmediate', 'setTimeout', 'clearTimeout'],
    });
    try {
      const fixture = await openSlhApproval({ frameId: 4 });
      const sendOffscreen = jest.fn(async () => ({
        success: true,
        result: { signature: `0x${'77'.repeat(SLH_DSA_SIGNATURE_LENGTH)}` },
      }));
      let beginHold!: () => void;
      let endHold!: () => void;
      const started = new Promise<void>((resolve) => (beginHold = resolve));
      const held = new Promise<void>((resolve) => (endHold = resolve));
      let checkingDispatch = false;
      let siteProbedForDispatch = false;
      let sitePresent = true;
      Object.assign(chrome.runtime, {
        getContexts: jest.fn(async () => {
          checkingDispatch = true;
          return [{}];
        }),
        sendMessage: sendOffscreen,
      });
      sendMessage.mockImplementation(async () => {
        if (!sitePresent) throw new Error('Receiving end does not exist');
        if (checkingDispatch) siteProbedForDispatch = true;
        return { documentActive: true };
      });
      getClient.mockImplementation(async () => {
        if (checkingDispatch) {
          beginHold();
          await held;
        }
        return { url: fixture.approval.source.url };
      });
      try {
        const signing = fixture.sign().then(
          () => '',
          (error: Error) => error.message
        );
        await started;
        expect(siteProbedForDispatch).toBe(true);
        expect(sendMessage).toHaveBeenLastCalledWith(
          7,
          { type: 'PALI_PROVIDER_DOCUMENT_CHECK' },
          { documentId: 'site-document', frameId: 4 }
        );
        sitePresent = false;
        endHold();
        expect(await signing).toContain('approval is no longer current');
        expect(controller.isConnected(host)).toBe(true);
        expect(await fixture.approval.outcome).toEqual({ code: 4001 });
        expect({
          dispatches: sendOffscreen.mock.calls.length,
          count: await fixture.readCount(),
        }).toEqual({ dispatches: 0, count: 0 });
      } finally {
        endHold();
        sendMessage.mockResolvedValue({ documentActive: true });
        getClient.mockResolvedValue({ url: fixture.approval.source.url });
        fixture.dispose();
      }
    } finally {
      jest.useRealTimers();
    }
  });

  it('hydrates and signs only the selected composite SLH-DSA child using worker-owned inputs', async () => {
    const fixture = await openSlhApproval({ composite: true, cold: true });
    const signature = `0x${'77'.repeat(SLH_DSA_SIGNATURE_LENGTH)}`;
    const offscreenReply = { success: true, result: { signature } };
    const sendOffscreen = jest
      .fn<Promise<typeof offscreenReply>, [unknown]>()
      .mockResolvedValue(offscreenReply);
    Object.assign(chrome.runtime, {
      getContexts: jest.fn(async () => [{}]),
      sendMessage: sendOffscreen,
    });
    try {
      for (const [key, child] of [
        ['different-key', fixture.slhAddress],
        [fixture.keyId, fixture.activeValidator],
      ]) {
        await expect(
          fixture.approval.invoke(
            ['wallet', 'signSmartAccountMessageDigest'],
            [key, fixture.activeValidator, child]
          )
        ).resolves.toMatchObject({ success: false });
      }
      expect(sendOffscreen).not.toHaveBeenCalled();
      const rendererMetadata = clone(fixture.metadata);
      rendererMetadata.installedModules[0].config.pkRoot = `0x${'99'.repeat(
        16
      )}${'00'.repeat(16)}`;
      const signed = await fixture.sign(
        rendererMetadata,
        `0x${'ab'.repeat(32)}`
      );
      expect(sendOffscreen).toHaveBeenCalledTimes(1);
      expect(sendOffscreen).toHaveBeenCalledWith({
        type: 'PALI_SLH_DSA_SIGN',
        payload: expect.objectContaining({
          accountId: 0,
          actionHash: fixture.actionHash,
          keyId: fixture.keyId,
          ...fixture.keys,
        }),
      });
      expect(sendOffscreen.mock.calls[0][0]).not.toHaveProperty(
        'payload.allowReservedSignature'
      );
      expect(slhSigningHost.getSLHDSASessionStateCrypto).toHaveBeenCalledTimes(
        1
      );
      expect(await fixture.readCount()).toBe(1);
      expect(signed.validator).toBe(fixture.activeValidator);
      fixture.approval.reply(signed.signature);
      expect(await fixture.approval.outcome).toEqual({
        value: signed.signature,
      });
    } finally {
      fixture.dispose();
    }
  });

  it('binds the registered popup and original payload without affecting another origin', async () => {
    const other = 'https://connection.invalid:8443';
    await connect();
    await controller.connect({ ...details(), host: other }, context());
    const approval = await openApproval();
    await controller.revoke(other, { allowAlreadyDisconnected: false });
    expect(controller.isConnected(host)).toBe(true);
    await expect(
      approval.approve(message, 'another-popup')
    ).resolves.toMatchObject({ success: false });
    await expect(approval.approve('Different payload')).resolves.toMatchObject({
      success: false,
    });
    expect(signPersonalMessage).not.toHaveBeenCalled();
    const value = await approval.approve();
    expect(value).toBe('synthetic-signature');
    expect(signPersonalMessage).toHaveBeenCalledTimes(1);
    approval.reply(value);
    expect(await approval.outcome).toEqual({ value: 'synthetic-signature' });
  });

  it.each(['reconnect', 'durable rollback'])(
    'never restores the old approval on %s',
    async (restore) => {
      await connect();
      const grant = controller.get(host);
      const approval = await openApproval();
      if (restore === 'durable rollback') {
        mockStorageSet.mockRejectedValueOnce(Error('Storage unavailable'));
        await expect(
          controller.revoke(host, { allowAlreadyDisconnected: false })
        ).rejects.toThrow('Storage unavailable');
        expect(controller.get(host)).toBe(grant);
      } else {
        await controller.revoke(host, { allowAlreadyDisconnected: false });
        await connect();
      }
      expect(controller.isConnected(host)).toBe(true);
      await expect(approval.approve()).resolves.toMatchObject({
        success: false,
      });
      expect(await approval.outcome).toEqual({ code: 4001 });
      expect(signPersonalMessage).not.toHaveBeenCalled();
    }
  );

  it.each(['account', 'network', 'wallet session'])(
    'retires the approval after a change in %s',
    async (field) => {
      await connect();
      const approval = await openApproval();
      const vault = store.getState().vault;
      if (field === 'wallet session') sessionGeneration += 1;
      else {
        store.dispatch(
          restoreVaultSnapshot({
            ...vault,
            ...(field === 'account'
              ? { activeAccount: { id: 1, type } }
              : { activeNetwork: { ...vault.activeNetwork, chainId: 10 } }),
          })
        );
        store.dispatch(restoreVaultSnapshot(vault));
      }
      await expect(approval.approve()).resolves.toMatchObject({
        success: false,
      });
      expect(await approval.outcome).toEqual({ code: 4001 });
      expect(signPersonalMessage).not.toHaveBeenCalled();
    }
  );

  it('rechecks the initiating document at signing, even with the grant still present', async () => {
    await connect();
    const approval = await openApproval();
    sendMessage.mockResolvedValueOnce({ documentActive: false });
    await expect(approval.approve()).resolves.toMatchObject({ success: false });
    expect(sendMessage).toHaveBeenLastCalledWith(
      7,
      { type: 'PALI_PROVIDER_DOCUMENT_CHECK' },
      { documentId: 'site-document', frameId: 0 }
    );
    expect(controller.isConnected(host)).toBe(true);
    await expect(approval.approve()).resolves.toMatchObject({ success: false });
    expect(await approval.outcome).toEqual({ code: 4001 });
    expect(signPersonalMessage).not.toHaveBeenCalled();
  });

  it('rechecks the grant after an admitted document check finishes', async () => {
    await connect();
    const approval = await openApproval();
    let started!: () => void;
    let finish!: () => void;
    const checking = new Promise<void>((resolve) => (started = resolve));
    sendMessage.mockImplementationOnce(async () => {
      started();
      await new Promise<void>((resolve) => (finish = resolve));
      return { documentActive: true };
    });
    const response = approval.approve();
    await checking;
    await controller.revoke(host, { allowAlreadyDisconnected: false });
    finish();
    await expect(response).resolves.toMatchObject({ success: false });
    expect(await approval.outcome).toEqual({ code: 4001 });
    expect(signPersonalMessage).not.toHaveBeenCalled();
  });

  it('discards a signature that completes after a durable revoke', async () => {
    let started!: () => void;
    let finish!: (value: string) => void;
    const invoked = new Promise<void>((resolve) => (started = resolve));
    const held = new Promise<string>((resolve) => (finish = resolve));
    signPersonalMessage.mockImplementationOnce(() => {
      started();
      return held;
    });
    await connect();
    const approval = await openApproval();
    const response = approval.approve();
    await invoked;
    await controller.revoke(host, { allowAlreadyDisconnected: false });
    finish('signature completed after revocation');
    await expect(response).resolves.toMatchObject({ success: false });
    expect(await approval.outcome).toEqual({ code: 4001 });
    expect(signPersonalMessage).toHaveBeenCalledTimes(1);
  });

  it('rechecks the session before delivering an already signed popup response', async () => {
    await connect();
    const approval = await openApproval();
    const value = await approval.approve();
    expect(value).toBe('synthetic-signature');
    sessionGeneration += 1;
    approval.reply(value);
    expect(await approval.outcome).toEqual({ code: 4001 });
  });

  it('checks the bound popup client before invoking the signer', async () => {
    await connect();
    const approval = await openApproval();
    getClient.mockResolvedValue(undefined);
    const response = await approval.approve();
    approval.reply(response);
    expect(response).toMatchObject({ success: false });
    expect(getClient).toHaveBeenCalledWith(approval.source.id);
    expect(await approval.outcome).toEqual({ code: 4001 });
    expect(controller.isConnected(host)).toBe(true);
    expect(signPersonalMessage).not.toHaveBeenCalled();
    expect(popupNavigation.size).toBe(0);
  });

  it('preserves approved SPA routing and retires on reload during signer admission', async () => {
    await connect();
    const approval = await openApproval();
    const route = approval.source.url.replace(
      '/external.html',
      '/external/tx/ethSign'
    );
    for (const listener of popupNavigation)
      listener(19, { url: route, status: 'loading' });
    let started!: () => void;
    let finish!: () => void;
    const checking = new Promise<void>((resolve) => (started = resolve));
    getClient.mockImplementationOnce(async () => {
      started();
      await new Promise<void>((resolve) => (finish = resolve));
      return { url: route };
    });
    const response = approval.approve();
    await checking;
    getClient.mockResolvedValue(undefined);
    for (const listener of popupNavigation) listener(19, { status: 'loading' });
    expect(await approval.outcome).toEqual({ code: 4001 });
    finish();
    await expect(response).resolves.toMatchObject({ success: false });
    expect(signPersonalMessage).not.toHaveBeenCalled();
    expect(popupNavigation.size).toBe(0);
  });

  it('does not sign when a same-URL popup reload wins during a held site probe', async () => {
    await connect();
    const approval = await openApproval();
    let started!: () => void;
    let finishSite!: (value: { documentActive: boolean }) => void;
    const checking = new Promise<void>((resolve) => (started = resolve));
    const site = new Promise<{ documentActive: boolean }>(
      (resolve) => (finishSite = resolve)
    );
    sendMessage.mockImplementationOnce(() => {
      started();
      return site;
    });
    const pending = approval.approve();
    await checking;
    // The same-URL loading notification can still see the departing client.
    for (const listener of popupNavigation) listener(19, { status: 'loading' });
    await new Promise(setImmediate);
    expect(getClient).toHaveBeenCalledWith(approval.source.id);
    getClient.mockResolvedValue(undefined);
    finishSite({ documentActive: true });
    const response = await pending;
    approval.reply(response);
    expect(response).toMatchObject({ success: false });
    expect(await approval.outcome).toEqual({ code: 4001 });
    expect(signPersonalMessage).not.toHaveBeenCalled();
  });
});
