import { configureStore } from '@reduxjs/toolkit';

import { getController } from '..';
import vaultReducer, {
  setAccountPropertyByIdAndType,
  setNetworkChange,
} from 'state/vault';
import vaultGlobalReducer, {
  startSwitchNetwork,
  switchNetworkSuccess,
} from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';
import { getFreshNativeBalance } from 'utils/nativeBalanceCache';

import BalancesManager from './balances';
import { ReceiptBalanceRefresh } from './balances/ReceiptBalanceRefresh';
import MainController from './MainController';
import { CancellablePromises } from './promises/cancellablesPromises';
import { fetchBackendAccountCached } from './utils/fetchBackendAccountWrapper';

let mockStore: any;
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockStore.getState(),
    dispatch: (action: any) => mockStore.dispatch(action),
  },
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('./utils/fetchBackendAccountWrapper', () => ({
  fetchBackendAccountCached: jest.fn(),
}));

const { CustomJsonRpcProvider } = jest.requireMock('@sidhujag/sysweb3-keyring');
const type = KeyringAccountType.HDAccount;
const A = `0x${'11'.repeat(20)}`;
const B = `0x${'22'.repeat(20)}`;
const network = {
  chainId: 5700,
  kind: INetworkType.Ethereum,
  url: 'https://balance-a.invalid',
  slip44: 60,
  currency: 'sys',
  label: 'Synthetic EVM',
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
let controller: any;
let provider: { getBalance: jest.Mock; send: jest.Mock };
let receiptProvider: {
  destroy: jest.Mock;
  getBalance: jest.Mock;
  send: jest.Mock;
};

const account = (id = 0) => mockStore.getState().vault.accounts[type][id];
const cardRead = (id = 0) =>
  controller.getBalanceForAccount(
    account(id),
    type,
    mockStore.getState().vault.activeNetwork
  );
const poll = () =>
  controller.updateUserNativeBalance({
    activeAccount: mockStore.getState().vault.activeAccount,
    activeNetwork: mockStore.getState().vault.activeNetwork,
    isBitcoinBased: false,
    isPolling: true,
  });
const expectBalance = (value: string, id = 0) => {
  expect(String(account(id).balances.ethereum)).toBe(value);
  expect(String(getFreshNativeBalance(account(id), network)?.balance)).toBe(
    value
  );
};

beforeEach(() => {
  jest.useFakeTimers({ now: 1_000_000 });
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation();
  const vault = vaultReducer(undefined, { type: 'test/init' });
  const global = vaultGlobalReducer(undefined, { type: 'test/init' });
  mockStore = configureStore({
    reducer: { vault: vaultReducer, vaultGlobal: vaultGlobalReducer },
    preloadedState: {
      vault: {
        ...vault,
        isBitcoinBased: false,
        activeAccount: { type, id: 0 },
        activeNetwork: network,
        accounts: {
          ...vault.accounts,
          [type]: {
            0: {
              id: 0,
              address: A,
              xpub: 'synthetic-public-account-a',
              balances: { ethereum: -1, syscoin: -1 },
            },
            1: {
              id: 1,
              address: B,
              xpub: 'synthetic-public-account-b',
              balances: { ethereum: -1, syscoin: -1 },
            },
          },
        },
        accountAssets: {
          [type]: {
            0: { ethereum: [], syscoin: [] },
            1: { ethereum: [], syscoin: [] },
          },
        },
      } as any,
      vaultGlobal: { ...global, activeSlip44: 60 },
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ serializableCheck: false }),
  });
  provider = {
    getBalance: jest.fn().mockResolvedValue(BigInt('2000000000000000000')),
    send: jest.fn(),
  };
  receiptProvider = {
    getBalance: jest.fn().mockResolvedValue(BigInt('3000000000000000000')),
    send: jest.fn().mockResolvedValue('0xb'),
    destroy: jest.fn(),
  };
  CustomJsonRpcProvider.mockImplementation(() => receiptProvider);
  controller = Object.create(MainController.prototype);
  Object.assign(controller, {
    nativeBalanceRevision: 0,
    networkRequestGeneration: 0,
    balanceLoadingRequestId: 0,
    assetUpdateRequestId: 0,
    targetedBalanceVersions: new Map(),
    targetedBalanceEvictions: 0,
    receiptBalanceRefresh: new ReceiptBalanceRefresh(),
    activeRapidPolls: new Map(),
    cancellablePromises: new CancellablePromises(),
    getActiveKeyring: () => ({
      ethereumTransaction: { web3Provider: provider },
      isUnlocked: () => true,
    }),
    setActiveNetworkLogic: (next: any, resolve: () => void) => {
      mockStore.dispatch(startSwitchNetwork(next));
      resolve();
    },
    handleNetworkChangeSuccess: async (next: any) => {
      mockStore.dispatch(setNetworkChange({ activeNetwork: next }));
      mockStore.dispatch(switchNetworkSuccess());
    },
  });
  jest.mocked(getController).mockReturnValue({ wallet: controller } as any);
  controller.balancesManager = BalancesManager();
});

afterEach(() => {
  controller.stopAllRapidPolling();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('loads an isolated card through the real balance adapter and reuses its fresh cache', async () => {
  await expect(cardRead()).resolves.toBe('2.0');
  expectBalance('2.0');
  await expect(cardRead()).resolves.toBe('2.0');
  expect(provider.getBalance).toHaveBeenCalledTimes(1);
  expect(provider.getBalance).toHaveBeenCalledWith(A);
});

it('does not let a different account refresh invalidate an in-flight card', async () => {
  const old = deferred<bigint>();
  provider.getBalance.mockReturnValueOnce(old.promise);
  const pending = cardRead(1);
  await poll();
  old.resolve(BigInt('7000000000000000000'));
  await expect(pending).resolves.toBe('7.0');
  expectBalance('7.0', 1);
  expectBalance('2.0');
});

it('does not overwrite a newer normal poll or stamp an old card result as fresh', async () => {
  const old = deferred<bigint>();
  provider.getBalance.mockReturnValueOnce(old.promise);
  const pending = cardRead();
  await poll();
  expectBalance('2.0');
  const fresh = getFreshNativeBalance(account(), network);
  jest.setSystemTime(1_000_500);
  old.resolve(BigInt('1000000000000000000'));
  await expect(pending).resolves.toBe('2.0');
  expectBalance('2.0');
  expect(getFreshNativeBalance(account(), network)).toEqual(fresh);
});

it('does not overwrite a newer receipt-targeted native balance', async () => {
  const old = deferred<bigint>();
  provider.getBalance.mockReturnValueOnce(old.promise);
  const pending = cardRead();
  controller.refreshBalancesAfterReceipt({
    from: A,
    to: `0x${'33'.repeat(20)}`,
    blockNumber: 10,
    chainId: network.chainId,
    value: '0',
  });
  await jest.advanceTimersByTimeAsync(100);
  expect(receiptProvider.send).toHaveBeenCalledWith('eth_blockNumber', []);
  expect(receiptProvider.getBalance).toHaveBeenCalledWith(A, 11);
  expectBalance('3');
  const fresh = getFreshNativeBalance(account(), network);
  jest.setSystemTime(1_000_500);
  old.resolve(BigInt('1000000000000000000'));
  await expect(pending).resolves.toBe('3');
  expectBalance('3');
  expect(getFreshNativeBalance(account(), network)).toEqual(fresh);
});

it('makes a successful card read supersede an older normal poll of the same account', async () => {
  const old = deferred<bigint>();
  provider.getBalance.mockReturnValueOnce(old.promise);
  const pending = poll();
  await expect(cardRead()).resolves.toBe('2.0');
  expectBalance('2.0');
  old.resolve(BigInt('1000000000000000000'));
  await pending;
  expectBalance('2.0');
});

it.each([false, true])(
  'keeps a newer card authoritative when an older poll completes first=%s',
  async (olderFirst) => {
    const old = deferred<bigint>();
    const latest = deferred<bigint>();
    provider.getBalance
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(latest.promise);
    const oldPoll = poll();
    const currentCard = cardRead();
    if (olderFirst) {
      old.resolve(BigInt('1000000000000000000'));
      await oldPoll;
      latest.resolve(BigInt('2000000000000000000'));
    } else {
      latest.resolve(BigInt('2000000000000000000'));
      await currentCard;
      old.resolve(BigInt('1000000000000000000'));
    }
    await oldPoll;
    await expect(currentCard).resolves.toBe('2.0');
    expectBalance('2.0');
  }
);

it.each([false, true])(
  'keeps a newer poll authoritative when an older card completes first=%s',
  async (olderFirst) => {
    const old = deferred<bigint>();
    const latest = deferred<bigint>();
    provider.getBalance
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(latest.promise);
    const oldCard = cardRead();
    const currentPoll = poll();
    if (olderFirst) {
      old.resolve(BigInt('1000000000000000000'));
      await oldCard;
      latest.resolve(BigInt('2000000000000000000'));
    } else {
      latest.resolve(BigInt('2000000000000000000'));
      await currentPoll;
      old.resolve(BigInt('1000000000000000000'));
    }
    await oldCard;
    await currentPoll;
    expectBalance('2.0');
  }
);

it.each([false, true])(
  'keeps a newer card authoritative when an older card completes first=%s',
  async (olderFirst) => {
    const old = deferred<bigint>();
    const latest = deferred<bigint>();
    provider.getBalance
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(latest.promise);
    const oldOutcome = cardRead().then(
      (value: string) => ({ value, error: null as Error | null }),
      (error: Error) => ({ value: undefined, error })
    );
    const currentCard = cardRead();
    if (olderFirst) {
      old.resolve(BigInt('1000000000000000000'));
      await oldOutcome;
      latest.resolve(BigInt('2000000000000000000'));
    } else {
      latest.resolve(BigInt('2000000000000000000'));
      await currentCard;
      old.resolve(BigInt('1000000000000000000'));
    }
    await expect(currentCard).resolves.toBe('2.0');
    const previous = await oldOutcome;
    if (olderFirst)
      expect(previous.error?.message).toBe('Balance request was superseded');
    else expect(previous.value).toBe('2.0');
    expectBalance('2.0');
  }
);

it('refuses a superseded card when the newer receipt read has no result yet', async () => {
  const old = deferred<bigint>();
  const receipt = deferred<bigint>();
  provider.getBalance.mockReturnValueOnce(old.promise);
  receiptProvider.getBalance.mockReturnValueOnce(receipt.promise);
  const pending = cardRead();
  const rejected = expect(pending).rejects.toThrow(
    'Balance request was superseded'
  );
  controller.refreshBalancesAfterReceipt({
    from: A,
    blockNumber: 10,
    chainId: network.chainId,
    value: '0',
  });
  await jest.advanceTimersByTimeAsync(100);
  expect(receiptProvider.getBalance).toHaveBeenCalledWith(A, 11);
  old.resolve(BigInt('1000000000000000000'));
  await rejected;
  expect(account().balances.ethereum).toBe(-1);
  expect(getFreshNativeBalance(account(), network)).toBeNull();
  receipt.resolve(BigInt('3000000000000000000'));
  await jest.advanceTimersByTimeAsync(0);
  expectBalance('3');
});

it.each([false, true])(
  'rejects a retired card across a real same-chain RPC switch (round trip=%s)',
  async (roundTrip) => {
    const old = deferred<bigint>();
    provider.getBalance.mockReturnValueOnce(old.promise);
    const pending = cardRead();
    const rejected = expect(pending).rejects.toThrow();
    await controller.setActiveNetwork({
      ...network,
      url: 'https://balance-b.invalid',
    });
    if (roundTrip) await controller.setActiveNetwork(network);
    old.resolve(BigInt('1000000000000000000'));
    await rejected;
    expect(account().balances.ethereum).toBe(-1);
    expect(getFreshNativeBalance(account(), network)).toBeNull();
  }
);

it('keeps a UTXO card bound to its stable xpub while the receiving address advances', async () => {
  const utxoNetwork = {
    ...network,
    kind: INetworkType.Syscoin,
    chainId: 57,
    slip44: 57,
    url: 'https://blockbook.invalid',
  };
  mockStore.dispatch(setNetworkChange({ activeNetwork: utxoNetwork }));
  const summary = deferred<any>();
  jest.mocked(fetchBackendAccountCached).mockReturnValue(summary.promise);
  const pending = cardRead();
  mockStore.dispatch(
    setAccountPropertyByIdAndType({
      id: 0,
      type,
      property: 'address',
      value: 'synthetic-new-receiving-address',
    })
  );
  summary.resolve({ balance: '500000000', unconfirmedBalance: '0' });
  await expect(pending).resolves.toBe('5');
  expect(account().balances.syscoin).toBe('5');
  expect(getFreshNativeBalance(account(), utxoNetwork)?.balance).toBe('5');
  expect(fetchBackendAccountCached).toHaveBeenCalledWith(
    utxoNetwork.url,
    'synthetic-public-account-a',
    'details=tokenBalances&tokens=nonzero',
    true
  );
});

it('shares the stable UTXO xpub version with a newer native poll after address rotation', async () => {
  const utxoNetwork = {
    ...network,
    kind: INetworkType.Syscoin,
    chainId: 57,
    slip44: 57,
    url: 'https://blockbook.invalid',
  };
  mockStore.dispatch(setNetworkChange({ activeNetwork: utxoNetwork }));
  const old = deferred<any>();
  jest
    .mocked(fetchBackendAccountCached)
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce({ balance: '600000000', unconfirmedBalance: '0' });
  const pending = cardRead();
  mockStore.dispatch(
    setAccountPropertyByIdAndType({
      id: 0,
      type,
      property: 'address',
      value: 'synthetic-new-receiving-address',
    })
  );
  await controller.updateUserNativeBalance({
    activeAccount: mockStore.getState().vault.activeAccount,
    activeNetwork: utxoNetwork,
    isBitcoinBased: true,
    isPolling: true,
  });
  old.resolve({ balance: '100000000', unconfirmedBalance: '0' });
  await expect(pending).resolves.toBe('6');
  expect(account().balances.syscoin).toBe('6');
  expect(getFreshNativeBalance(account(), utxoNetwork)?.balance).toBe('6');
});
