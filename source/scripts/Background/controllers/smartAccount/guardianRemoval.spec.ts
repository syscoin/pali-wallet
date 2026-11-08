jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('utils/security/blacklistService', () => ({ blacklistService: {} }));
jest.mock('utils/smartAccount/guardianStatus', () => ({
  readGuardianRecoveryObservation: jest.fn(async (params) => {
    const epoch = mockEpoch;
    await mockWait();
    params.assertCurrent();
    return {
      exists: mockExists,
      moduleAddress: mockModule,
      policyEpoch: epoch,
      active: null,
    };
  }),
}));

import { smartAccountAddressFixture } from 'tests/fixtures/smartAccountAddress';

import { getAddress } from 'utils/ethersV6Compat';
import { getPaliModuleAddress } from 'utils/smartAccount/contracts';

import SmartAccountController from './index';

let mockState: any;
let mockWait: () => Promise<void>;
let mockExists: boolean;
let mockEpoch: string;
let mockModule: string;
const payer = `0x${'22'.repeat(20)}`;
const hash = `0x${'33'.repeat(32)}`;
function fixture() {
  let generation = 1;
  const identity = smartAccountAddressFixture(1);
  mockModule = getAddress(getPaliModuleAddress(1, 'guardian-recovery'));
  mockWait = async () => undefined;
  mockExists = true;
  mockEpoch = '1';
  mockState = {
    vault: {
      activeAccount: { id: 0, type: 'SmartAccount' },
      activeNetwork: {
        chainId: 1,
        kind: 'ethereum',
        url: 'https://fixture.invalid',
      },
      accounts: {
        SmartAccount: {
          0: { ...identity.account, id: 0, isSmartAccount: true },
        },
      },
      isBitcoinBased: false,
    },
    vaultGlobal: { activeSlip44: 60 },
  };
  const read = jest.fn(async () => [] as any[]);
  const send = jest.fn(async (method: string) => {
    if (method === 'eth_chainId') return '0x1';
    if (method === 'eth_getTransactionReceipt') return null;
    if (method === 'eth_getTransactionCount') return '0x0';
    throw new Error(`Unexpected RPC ${method}`);
  });
  const controller = new SmartAccountController({
    captureSmartAccountPendingRecords: async () => ({
      profileId: 'ab'.repeat(32),
      read,
    }),
    getEthereumTransaction: () => ({ web3Provider: { send } }),
    getWalletSessionGeneration: () => generation,
    getWalletStateGeneration: () => generation,
  } as any);
  // Keep the provider and transaction identity stable across guard checks.
  const transaction = { web3Provider: { send } };
  (controller as any).deps.getEthereumTransaction = () => transaction;
  return {
    controller,
    read,
    send,
    identity,
    retire() {
      generation++;
    },
  };
}

test('the extension controller uses a complete authenticated empty scan to allow a fresh review', async () => {
  const f = fixture();
  await expect(
    f.controller.getSmartAccountGuardianRemovalStatus(0)
  ).resolves.toEqual({
    status: 'retry-ready',
    transactions: [],
    totalPending: 0,
  });
  expect(f.read.mock.calls).toEqual([[true], [true]]);
  expect(f.send).not.toHaveBeenCalled();
});

test('the extension controller blocks a retained pending removal through the canonical observer', async () => {
  const f = fixture();
  const entry = {
    account: f.identity.account.address,
    chainId: '1',
    payer,
    payerNonce: 0,
    hash,
    operationHash: `0x${'44'.repeat(32)}`,
    operationNonce: '1',
    guardianRemoval: { moduleAddress: mockModule },
  };
  f.read.mockResolvedValue([entry]);
  const result = await f.controller.getSmartAccountGuardianRemovalStatus(0);
  expect(result.status).toBe('pending');
  expect(result.transactions).toEqual([entry]);
  expect(f.send).toHaveBeenCalledWith('eth_getTransactionReceipt', [hash]);
});

test.each(['generation', 'network', 'account'])(
  'the extension removal read retires after %s changes',
  async (kind) => {
    const f = fixture();
    let release!: () => void;
    mockWait = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const pending = f.controller.getSmartAccountGuardianRemovalStatus(0);
    const rejected = expect(pending).rejects.toThrow();
    if (kind === 'generation') f.retire();
    else if (kind === 'network')
      mockState.vault.activeNetwork.url = 'https://other.invalid';
    else mockState.vault.activeAccount.id = 1;
    release();
    await rejected;
    expect(f.read).not.toHaveBeenCalled();
  }
);

test('the extension removal read reports canonical absence without inventing a pending transaction', async () => {
  const f = fixture();
  mockExists = false;
  await expect(
    f.controller.getSmartAccountGuardianRemovalStatus(0)
  ).resolves.toEqual({ status: 'removed', transactions: [], totalPending: 0 });
  expect(f.read).not.toHaveBeenCalled();
});

test('the extension refuses retry when its policy changes during the retained-record scan', async () => {
  const f = fixture();
  f.read.mockImplementation(async () => {
    mockEpoch = '2';
    return [];
  });
  await expect(
    f.controller.getSmartAccountGuardianRemovalStatus(0)
  ).rejects.toThrow('GUARDIAN_POLICY_CHANGED');
});

test('the final checkpoint cannot join a status read anchored before the scan completed', async () => {
  const f = fixture();
  let enter!: () => void, releaseScan!: () => void, releaseOld!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const scan = new Promise<void>((resolve) => {
    releaseScan = resolve;
  });
  f.read.mockImplementationOnce(async () => {
    enter();
    await scan;
    return [];
  });
  const checking = f.controller.getSmartAccountGuardianRemovalStatus(0);
  await entered;
  mockWait = () =>
    new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
  const old = f.controller.getSmartAccountGuardianRecoveryStatus({
    account: f.identity.account.address,
  });
  mockEpoch = '2';
  mockWait = async () => undefined;
  releaseScan();
  const release = setTimeout(() => releaseOld(), 20);
  try {
    await expect(checking).rejects.toThrow('GUARDIAN_POLICY_CHANGED');
  } finally {
    clearTimeout(release);
    releaseOld();
    await old;
  }
});
