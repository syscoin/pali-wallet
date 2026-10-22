jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('utils/smartAccount/guardianStatus', () => ({
  readGuardianRecoveryObservation: jest.fn(async (params) => {
    await mockWait();
    params.assertCurrent();
    return { pending: null };
  }),
}));

import { readGuardianRecoveryObservation } from 'utils/smartAccount/guardianStatus';

import SmartAccountController from './index';

let mockState: any;
let mockWait: () => Promise<void>;
const ACCOUNT = `0x${'11'.repeat(20)}`;
beforeEach(() => jest.clearAllMocks());

test.each(['account', 'chain', 'url', 'family', 'session', 'provider'])(
  'retires a guardian status response after %s changes',
  async (field) => {
    mockState = {
      vault: {
        activeAccount: { id: 1, type: 'SmartAccount' },
        activeNetwork: {
          kind: 'ethereum',
          chainId: 57057,
          url: 'https://fixture.invalid',
        },
        accounts: { SmartAccount: { 1: { address: ACCOUNT } } },
        isBitcoinBased: false,
      },
      vaultGlobal: { activeSlip44: 60 },
    };
    let session = 1;
    let transaction = { web3Provider: {} };
    let release!: () => void;
    mockWait = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const controller = new SmartAccountController({
      getEthereumTransaction: () => transaction,
      getWalletSessionGeneration: () => session,
    } as any);
    const response = controller.getSmartAccountGuardianRecoveryStatus({
      account: ACCOUNT,
    });
    if (field === 'account') mockState.vault.activeAccount.id = 2;
    if (field === 'chain') mockState.vault.activeNetwork.chainId = 1;
    if (field === 'url')
      mockState.vault.activeNetwork.url = 'https://other.invalid';
    if (field === 'family') mockState.vault.activeNetwork.kind = 'syscoin';
    if (field === 'session') session++;
    if (field === 'provider') transaction = { web3Provider: {} };
    release();
    await expect(response).rejects.toThrow();
  }
);

test('passes only the explicit read-only target and optional known operation into the reader', async () => {
  mockState = {
    vault: {
      activeAccount: { id: 1, type: 'SmartAccount' },
      activeNetwork: {
        kind: 'ethereum',
        chainId: 57057,
        url: 'https://fixture.invalid',
      },
      accounts: { SmartAccount: { 1: { address: ACCOUNT } } },
      isBitcoinBased: false,
    },
    vaultGlobal: { activeSlip44: 60 },
  };
  mockWait = async () => undefined;
  const transaction = { web3Provider: {} };
  const controller = new SmartAccountController({
    getEthereumTransaction: () => transaction,
    getWalletSessionGeneration: () => 1,
  } as any);
  const id = `0x${'33'.repeat(32)}`;
  await controller.getSmartAccountGuardianRecoveryStatus({
    account: ACCOUNT,
    knownOperationId: id,
  });
  expect(readGuardianRecoveryObservation).toHaveBeenLastCalledWith(
    expect.objectContaining({
      account: ACCOUNT,
      knownOperationId: id,
      provider: expect.objectContaining({ send: expect.any(Function) }),
      chainId: 57057,
    })
  );
});

test('coalesces identical pending reads, normalizes IDs and does not cache completed results', async () => {
  mockState = {
    vault: {
      activeAccount: { id: 1, type: 'SmartAccount' },
      activeNetwork: {
        kind: 'ethereum',
        chainId: 57057,
        url: 'https://fixture.invalid',
      },
      accounts: { SmartAccount: { 1: { address: ACCOUNT } } },
      isBitcoinBased: false,
    },
    vaultGlobal: { activeSlip44: 60 },
  };
  let release!: () => void;
  mockWait = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const transaction = { web3Provider: {} };
  const controller = new SmartAccountController({
    getEthereumTransaction: () => transaction,
    getWalletSessionGeneration: () => 1,
  } as any);
  const id = `0x${'ab'.repeat(32)}`;
  const first = controller.getSmartAccountGuardianRecoveryStatus({
    account: ACCOUNT,
    knownOperationId: id,
  });
  const second = controller.getSmartAccountGuardianRecoveryStatus({
    account: ACCOUNT,
    knownOperationId: `0x${'AB'.repeat(32)}`,
  });
  expect(readGuardianRecoveryObservation).toHaveBeenCalledTimes(1);
  release();
  await Promise.all([first, second]);
  mockWait = async () => undefined;
  await controller.getSmartAccountGuardianRecoveryStatus({
    account: ACCOUNT,
    knownOperationId: id,
  });
  expect(readGuardianRecoveryObservation).toHaveBeenCalledTimes(2);
});

test('retired read cleanup cannot remove the replacement session pending read', async () => {
  mockState = {
    vault: {
      activeAccount: { id: 1, type: 'SmartAccount' },
      activeNetwork: {
        kind: 'ethereum',
        chainId: 57057,
        url: 'https://fixture.invalid',
      },
      accounts: { SmartAccount: { 1: { address: ACCOUNT } } },
      isBitcoinBased: false,
    },
    vaultGlobal: { activeSlip44: 60 },
  };
  const releases: Array<() => void> = [];
  mockWait = () => new Promise((resolve) => releases.push(resolve));
  let session = 1;
  const transaction = { web3Provider: {} };
  const controller = new SmartAccountController({
    getEthereumTransaction: () => transaction,
    getWalletSessionGeneration: () => session,
  } as any);
  const old = controller.getSmartAccountGuardianRecoveryStatus({
    account: ACCOUNT,
  });
  const rejected = expect(old).rejects.toThrow();
  session++;
  const current = controller.getSmartAccountGuardianRecoveryStatus({
    account: ACCOUNT,
  });
  releases[0]();
  await rejected;
  const joined = controller.getSmartAccountGuardianRecoveryStatus({
    account: ACCOUNT,
  });
  expect(readGuardianRecoveryObservation).toHaveBeenCalledTimes(2);
  releases[1]();
  await Promise.all([current, joined]);
});
