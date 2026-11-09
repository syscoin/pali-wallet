const mockCreatePopup = jest.fn();
const mockSdk = {
  getEncryptedPubKey: jest.fn(() => 'public-key'),
  decryptMessage: jest.fn(() => ' plaintext\n'),
};
let mockCurrentSdk = mockSdk,
  mockState: any,
  mockSession = 1,
  mockSiteLive = true;
let mockDocumentWait: Promise<void> = Promise.resolve();
const mockSubscriptions = new Set<() => void>();
const mockWallet = {
  getWalletSessionGeneration: () => mockSession,
  get ethereumTransaction() {
    return mockCurrentSdk;
  },
};
jest.mock('scripts/Background', () => ({
  getController: () => ({ createPopup: mockCreatePopup, wallet: mockWallet }),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockState,
    subscribe: (fn: () => void) => {
      mockSubscriptions.add(fn);
      return () => mockSubscriptions.delete(fn);
    },
  },
}));
jest.mock('./request-lifetime', () => ({
  ...jest.requireActual('./request-lifetime'),
  isRequestDocumentLive: async () => {
    await mockDocumentWait;
    return mockSiteLive;
  },
}));

import {
  runBoundEncryptionApproval,
  requireMessageSignApproval,
} from '../../handlers/messageSignApproval';
import { APPROVAL_CLIENT_READY, APPROVAL_REGISTER } from 'utils/approvalClient';

import { popupPromise } from './popup-promise';
import { MethodRoute } from './types';

const ADDRESS = '0x' + '11'.repeat(20),
  HOST = 'https://site.invalid';
const sourceSender = {
  tab: { id: 4 },
  documentId: 'site-document',
  url: `${HOST}/request`,
  origin: HOST,
} as chrome.runtime.MessageSender;
let message: (event: any) => void, register: any, close: (id: number) => void;
let clientUrl: string | undefined;
const approver = () =>
  ({
    id: 'pali',
    frameId: 0,
    documentId: 'approval-document',
    tab: { id: 19, windowId: 9 },
    url: clientUrl,
  } as chrome.runtime.MessageSender);

beforeEach(() => {
  jest.clearAllMocks();
  mockSubscriptions.clear();
  mockDocumentWait = Promise.resolve();
  mockSession = 1;
  mockSiteLive = true;
  mockCurrentSdk = mockSdk;
  mockState = {
    vault: {
      activeAccount: { id: 0, type: 'HDAccount' },
      accounts: { HDAccount: { 0: { address: ADDRESS, xpub: 'public' } } },
      isBitcoinBased: false,
      activeNetwork: {
        kind: 'ethereum',
        chainId: 99,
        url: 'https://rpc.invalid',
        slip44: 60,
        apiUrl: 'https://api.invalid',
      },
    },
    dapp: {
      dapps: {
        [HOST]: {
          accountId: 0,
          accountType: 'HDAccount',
          chain: 'ethereum',
          chainId: 99,
          host: HOST,
          date: 1,
        },
      },
    },
  };
  mockCreatePopup.mockResolvedValue({ id: 9 });
  (crypto as any).randomUUID = jest
    .fn()
    .mockReturnValueOnce('approval-id')
    .mockReturnValue('challenge');
  Object.assign(chrome.runtime, {
    id: 'pali',
    getURL: (path: string) => `chrome-extension://pali/${path}`,
    onMessage: {
      addListener: (fn: any) => {
        register = fn;
      },
      removeListener: jest.fn(),
    },
  });
  Object.assign(chrome, {
    tabs: { onUpdated: { addListener: jest.fn(), removeListener: jest.fn() } },
    windows: {
      remove: jest.fn((_id, done) => done()),
      onRemoved: {
        addListener: (fn: any) => {
          close = fn;
        },
        removeListener: jest.fn(),
      },
    },
  });
  Object.assign(self, {
    addEventListener: (_name: string, fn: any) => {
      message = fn;
    },
    removeEventListener: jest.fn(),
    clients: { get: async () => (clientUrl ? { url: clientUrl } : undefined) },
  });
  (chrome.storage.local.remove as jest.Mock).mockImplementation((_key, done) =>
    done?.()
  );
});

async function begin(
  method: 'eth_decrypt' | 'eth_getEncryptionPublicKey' = 'eth_decrypt'
) {
  const pending = popupPromise({
    host: HOST,
    method,
    eventName: method,
    data: method === 'eth_decrypt' ? ['0xab', ADDRESS] : [ADDRESS],
    route:
      method === 'eth_decrypt'
        ? MethodRoute.DecryptKey
        : MethodRoute.EncryptKey,
    sender: sourceSender,
  } as Parameters<typeof popupPromise>[0]);
  await new Promise(setImmediate);
  clientUrl = `chrome-extension://pali/external.html?data=${encodeURIComponent(
    JSON.stringify(mockCreatePopup.mock.calls[0][1])
  )}`;
  const reply = jest.fn();
  register(
    { type: APPROVAL_REGISTER, approvalId: 'approval-id' },
    approver(),
    reply
  );
  expect(reply).toHaveBeenCalledWith({
    status: 'registered',
    approvalId: 'approval-id',
    challenge: 'challenge',
  });
  const port = { postMessage: jest.fn(), close: jest.fn() };
  message({
    data: {
      eventName: APPROVAL_CLIENT_READY,
      approvalId: 'approval-id',
      challenge: 'challenge',
    },
    source: { id: 'client', url: clientUrl },
    ports: [port],
  });
  expect(port.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'ready' })
  );
  return { pending };
}

it('uses the enrolled document for optional preview and direct guarded response, ignoring renderer-authored results', async () => {
  const { pending } = await begin();
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  message({
    data: {
      eventName: `eth_decrypt.${HOST}`,
      detail: JSON.stringify('forged'),
    },
    source: { id: 'client', url: clientUrl },
  });
  await new Promise(setImmediate);
  expect(settled).toBe(false);
  expect(await runBoundEncryptionApproval(approver(), 'preview')).toBe(
    ' plaintext\n'
  );
  expect(settled).toBe(false);
  expect(() =>
    runBoundEncryptionApproval(
      { ...approver(), documentId: 'replacement-document' },
      'approve'
    )
  ).toThrow('no longer current');
  await runBoundEncryptionApproval(approver(), 'approve');
  expect(await pending).toBe(' plaintext\n');
  expect(mockSdk.decryptMessage).toHaveBeenCalledTimes(2);
  expect(mockSdk.decryptMessage).toHaveBeenLastCalledWith(['0xab', ADDRESS]);
  expect(() => runBoundEncryptionApproval(approver(), 'approve')).toThrow(
    'no longer current'
  );
});

it.each(['sdk', 'network', 'address', 'xpub', 'grant', 'session'] as const)(
  'retires a captured %s source before private access',
  async (change) => {
    const { pending } = await begin();
    const rejected = expect(pending).rejects.toThrow();
    if (change === 'sdk') mockCurrentSdk = { ...mockSdk };
    else if (change === 'session') mockSession++;
    else if (change === 'network')
      mockState.vault.activeNetwork = {
        ...mockState.vault.activeNetwork,
        apiUrl: 'https://changed.invalid',
      };
    else if (change === 'address' || change === 'xpub')
      mockState.vault.accounts.HDAccount[0] = {
        ...mockState.vault.accounts.HDAccount[0],
        [change]:
          change === 'address' ? '0x' + '22'.repeat(20) : 'changed-owner',
      };
    else mockState.dapp.dapps[HOST] = { ...mockState.dapp.dapps[HOST] };
    mockSubscriptions.forEach((fn) => fn());
    await expect(
      Promise.resolve().then(async () => {
        await runBoundEncryptionApproval(approver(), 'approve');
      })
    ).rejects.toThrow();
    await rejected;
    expect(mockSdk.decryptMessage).not.toHaveBeenCalled();
  }
);

it('retires actual requesting/approval documents and close without treating React departure as authority', async () => {
  const { pending } = await begin();
  const rejected = expect(pending).rejects.toThrow();
  clientUrl = undefined;
  await expect(
    runBoundEncryptionApproval(approver(), 'preview')
  ).rejects.toThrow();
  await rejected;
  expect(mockSdk.decryptMessage).not.toHaveBeenCalled();
});

it('rejects window close and removes its prepared capability', async () => {
  const { pending } = await begin('eth_getEncryptionPublicKey');
  const rejected = expect(pending).rejects.toThrow();
  close(9);
  await rejected;
  expect(() => runBoundEncryptionApproval(approver(), 'approve')).toThrow();
  expect(mockSdk.getEncryptedPubKey).not.toHaveBeenCalled();
});

it('confirms the public key without preview and does not expose it to the renderer command', async () => {
  const { pending } = await begin('eth_getEncryptionPublicKey');
  expect(await runBoundEncryptionApproval(approver(), 'approve')).toBe(true);
  expect(await pending).toBe('public-key');
  expect(mockSdk.getEncryptedPubKey).toHaveBeenCalledTimes(1);
  expect(mockSdk.decryptMessage).not.toHaveBeenCalled();
});

it('refuses a requesting document that retires before private access', async () => {
  const { pending } = await begin();
  const rejected = expect(pending).rejects.toThrow();
  mockSiteLive = false;
  await expect(
    runBoundEncryptionApproval(approver(), 'approve')
  ).rejects.toThrow();
  await rejected;
  expect(mockSdk.decryptMessage).not.toHaveBeenCalled();
});

it('retires raw renderer encryption shortcuts while retaining the SDK primitive', () => {
  expect(() =>
    requireMessageSignApproval(
      approver(),
      ['wallet', 'getEncryptionPublicKeyForAccount'],
      [ADDRESS]
    )
  ).toThrow();
  expect(() =>
    requireMessageSignApproval(
      approver(),
      ['wallet', 'ethereumTransaction', 'decryptMessage'],
      [['0xab', ADDRESS]]
    )
  ).toThrow();
});

it('captures the SDK before the first requesting-document await', async () => {
  let release!: () => void;
  mockDocumentWait = new Promise((resolve) => {
    release = resolve;
  });
  const pending = popupPromise({
    host: HOST,
    eventName: 'eth_decrypt',
    data: ['0xab', ADDRESS],
    route: MethodRoute.DecryptKey,
    sender: sourceSender,
  });
  const rejected = expect(pending).rejects.toThrow();
  mockCurrentSdk = { ...mockSdk };
  release();
  await rejected;
  expect(mockCreatePopup).not.toHaveBeenCalled();
  expect(mockSdk.decryptMessage).not.toHaveBeenCalled();
});

it('retains the same public account and captured SDK through an immutable metadata refresh', async () => {
  const { pending } = await begin();
  mockState.vault.accounts.HDAccount[0] = {
    ...mockState.vault.accounts.HDAccount[0],
    label: 'Refreshed label',
    balances: { ethereum: 123 },
  };
  mockSubscriptions.forEach((fn) => fn());
  await runBoundEncryptionApproval(approver(), 'approve');
  expect(await pending).toBe(' plaintext\n');
  expect(mockSdk.decryptMessage).toHaveBeenCalledTimes(1);
});
