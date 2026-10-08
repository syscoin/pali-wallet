let state: any;
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringAccountType: {
    HDAccount: 'HDAccount',
    Imported: 'Imported',
    Ledger: 'Ledger',
    Trezor: 'Trezor',
    SmartAccount: 'SmartAccount',
  },
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => state,
    dispatch: (action: any) => {
      const { payload } = action;
      if (action.type === 'assets')
        state.vault.accountAssets[payload.accountType][
          payload.accountId
        ].ethereum = payload.value || payload.assets.ethereum;
      if (action.type === 'balance')
        state.vault.accounts[payload.type][payload.id].nativeBalance =
          payload.balance;
      if (action.type === 'transaction') {
        const rows =
          state.vault.accountTransactions[payload.accountType][
            payload.accountId
          ].ethereum[payload.chainId];
        const index = rows.findIndex(
          (row: any) => row.hash === payload.transaction.hash
        );
        rows[index] = payload.transaction;
      }
    },
  },
}));
jest.mock('state/vault', () => ({
  setAccountAssets: (payload: any) => ({ type: 'assets', payload }),
  setAccountBalanceForNetwork: (payload: any) => ({ type: 'balance', payload }),
  setSingleTransactionToState: (payload: any) => ({
    type: 'transaction',
    payload,
  }),
}));
jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: {
    notifyTransaction: jest.fn(),
    updatePendingTransactionBadge: jest.fn(),
  },
}));
jest.mock('utils/ethersV6Compat', () => ({
  ...jest.requireActual('utils/ethersV6Compat'),
  Contract: jest.fn(),
}));

import { CustomJsonRpcProvider } from '@sidhujag/sysweb3-keyring';

import { KeyringAccountType } from 'types/network';
import { Contract } from 'utils/ethersV6Compat';

import { ReceiptBalanceRefresh } from './balances/ReceiptBalanceRefresh';
import MainController from './MainController';
import { CancellablePromises } from './promises/cancellablesPromises';

const A = `0x${'11'.repeat(20)}`;
const T = `0x${'33'.repeat(20)}`;
const U = `0x${'44'.repeat(20)}`;
const asset = (contractAddress: string, balance = 5) => ({
  contractAddress,
  balance,
  chainId: 1,
  decimals: 0,
  isNft: false,
  tokenSymbol: 'T',
  tokenStandard: 'ERC-20',
});
const type = KeyringAccountType.HDAccount;
let controller: any;
let balanceOf: jest.Mock;
let provider: any;
let readProviders: any[];
beforeEach(() => {
  jest.useFakeTimers();
  state = {
    vault: {
      activeNetwork: { chainId: 1, url: 'https://rpc.test', kind: 'ethereum' },
      activeAccount: { id: 0, type },
      accounts: { [type]: { 0: { address: A } } },
      accountAssets: {
        [type]: { 0: { ethereum: [asset(T), asset(U)], syscoin: [] } },
      },
      accountTransactions: { [type]: { 0: { ethereum: { 1: [] } } } },
    },
  };
  provider = {
    getBalance: jest.fn().mockResolvedValue(BigInt('1000000000000000000')),
    send: jest.fn().mockResolvedValue('0xb'),
  };
  readProviders = [];
  (CustomJsonRpcProvider as jest.Mock).mockImplementation(
    (signal, url, chainId) => {
      const local = {
        ...provider,
        signal,
        url,
        chainId,
        destroy: jest.fn(),
      };
      readProviders.push(local);
      return local;
    }
  );
  balanceOf = jest.fn().mockResolvedValue(BigInt(9));
  (Contract as jest.Mock).mockReturnValue({ balanceOf });
  controller = Object.create(MainController.prototype);
  Object.assign(controller, {
    receiptBalanceRefresh: new ReceiptBalanceRefresh(),
    targetedBalanceVersions: new Map(),
    assetUpdateRequestId: 0,
    nativeBalanceRevision: 0,
    activeRapidPolls: new Map(),
    cancellablePromises: new CancellablePromises(),
    getActiveKeyring: () => ({
      ethereumTransaction: { web3Provider: provider },
    }),
  });
});
afterEach(() => {
  controller.stopAllRapidPolling();
  jest.useRealTimers();
});

it('a direct receipt refreshes only its token and native payer; retries are independent of receipt polling', async () => {
  balanceOf
    .mockRejectedValueOnce(new Error('not indexed yet'))
    .mockResolvedValue(BigInt(9));
  controller.refreshBalancesAfterReceipt({
    from: A,
    to: T,
    blockNumber: 10,
    value: '0',
  });
  await jest.advanceTimersByTimeAsync(100);
  expect(state.vault.accountAssets[type][0].ethereum[0].balance).toBe(5);
  await jest.advanceTimersByTimeAsync(250);
  expect(state.vault.accountAssets[type][0].ethereum[0].balance).toBe(9);
  expect(state.vault.accountAssets[type][0].ethereum[1].balance).toBe(5);
  expect(balanceOf).toHaveBeenCalledTimes(2);
  expect(provider.getBalance).toHaveBeenCalledTimes(1);
});

it('never commits after an account/chain change, including in-flight results', async () => {
  let resolve!: (value: bigint) => void;
  balanceOf.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  controller.refreshBalancesAfterReceipt({ from: A, to: T, blockNumber: 10 });
  await jest.advanceTimersByTimeAsync(100);
  controller.stopAllRapidPolling();
  state.vault.activeNetwork = { chainId: 2, url: 'https://other.test' };
  resolve(BigInt(77));
  await jest.advanceTimersByTimeAsync(100);
  expect(state.vault.accountAssets[type][0].ethereum[0].balance).toBe(5);
});

it('targeted balance refresh merges into latest assets and never restores a removed token', async () => {
  let resolve!: (value: bigint) => void;
  balanceOf.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  const read = controller.refreshActiveEvmTokenBalance(T);
  state.vault.accountAssets[type][0].ethereum[1] = { ...asset(U), balance: 26 };
  resolve(BigInt(7));
  await read;
  expect(
    state.vault.accountAssets[type][0].ethereum.map(
      (token: any) => token.balance
    )
  ).toEqual([7, 26]);
  const second = controller.refreshActiveEvmTokenBalance(T);
  state.vault.accountAssets[type][0].ethereum = [asset(U)];
  resolve(BigInt(8));
  await second;
  expect(
    state.vault.accountAssets[type][0].ethereum.map(
      (token: any) => token.contractAddress
    )
  ).toEqual([U]);
});

it('refreshes an incoming token receipt without any unrelated native balance request', async () => {
  controller.refreshBalancesAfterReceipt({
    from: U,
    to: A,
    contractAddress: T,
    blockNumber: 10,
    value: '99',
  });
  await jest.advanceTimersByTimeAsync(100);
  expect(balanceOf).toHaveBeenCalledTimes(1);
  expect(provider.getBalance).not.toHaveBeenCalled();
  expect(state.vault.accountAssets[type][0].ethereum[0].balance).toBe(9);
});

it('preserves AA inner-token hints through the actual pending-to-receipt update', async () => {
  const saType = KeyringAccountType.SmartAccount;
  const sa = `0x${'55'.repeat(20)}`;
  state.vault.accounts[saType] = { 0: { address: sa } };
  state.vault.accountAssets[saType] = { 0: { ethereum: [asset(T)] } };
  state.vault.accountTransactions[saType] = {
    0: {
      ethereum: {
        1: [
          {
            hash: '0xabc',
            blockNumber: null,
            smartAccountExecutionFrom: sa,
            balanceRefreshTokenAddresses: [T],
            balanceRefreshNativeAddresses: [sa],
          },
        ],
      },
    },
  };
  controller.updateTrackedEvmTransactionCopies('0xabc', 1, {
    hash: '0xabc',
    from: A,
    to: U,
    blockNumber: 10,
    value: '0',
    status: 'success',
  });
  await jest.advanceTimersByTimeAsync(100);
  expect(balanceOf).toHaveBeenCalledTimes(1);
  expect(balanceOf).toHaveBeenCalledWith(sa, { blockTag: 11 });
  expect(provider.getBalance).toHaveBeenCalledTimes(2);
  expect(state.vault.accountAssets[saType][0].ethereum[0].balance).toBe(9);
  expect(
    state.vault.accountTransactions[saType][0].ethereum[1][0]
      .balanceRefreshTokenAddresses
  ).toEqual([T]);
});

it('does not let an older same-key read overwrite a newer response', async () => {
  let resolve!: (value: bigint) => void;
  balanceOf
    .mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    )
    .mockResolvedValueOnce(BigInt(12));
  const old = controller.refreshActiveEvmTokenBalance(T);
  const latest = controller.refreshActiveEvmTokenBalance(T);
  await latest;
  resolve(BigInt(6));
  await expect(old).rejects.toThrow('context changed');
  expect(state.vault.accountAssets[type][0].ethereum[0].balance).toBe(12);
});

it('allows independent token reads to commit without clobbering each other', async () => {
  let first!: (value: bigint) => void;
  balanceOf
    .mockReturnValueOnce(
      new Promise((done) => {
        first = done;
      })
    )
    .mockResolvedValueOnce(BigInt(26));
  const a = controller.refreshActiveEvmTokenBalance(T);
  await controller.refreshActiveEvmTokenBalance(U);
  first(BigInt(7));
  await a;
  expect(
    state.vault.accountAssets[type][0].ethereum.map(
      (token: any) => token.balance
    )
  ).toEqual([7, 26]);
});

it('reads the current head for a late historical receipt, with one shared head query', async () => {
  provider.send.mockResolvedValue('0x14');
  controller.refreshBalancesAfterReceipt({ from: A, to: T, blockNumber: 10 });
  await jest.advanceTimersByTimeAsync(100);
  expect(balanceOf).toHaveBeenCalledWith(A, { blockTag: 20 });
  expect(provider.getBalance).toHaveBeenCalledWith(A, 20);
  expect(provider.send).toHaveBeenCalledTimes(1);
});

it('uses disposable receipt-only providers with the captured URL, chain and abort signal', async () => {
  controller.refreshBalancesAfterReceipt({ from: A, to: T, blockNumber: 10 });
  await jest.advanceTimersByTimeAsync(100);
  expect(readProviders).toHaveLength(2);
  for (const local of readProviders) {
    expect(local.url).toBe('https://rpc.test');
    expect(local.chainId).toBe(1);
    expect(local.signal.aborted).toBe(true);
    expect(local.destroy).toHaveBeenCalledTimes(1);
  }
  expect(provider.destroy).toBeUndefined();
  expect((Contract as jest.Mock).mock.calls.at(-1)?.[2]).toBe(readProviders[1]);
  expect(jest.getTimerCount()).toBe(0);
});

it('clears an aborted owning head read and does not start a balance read after cancellation', async () => {
  let resolve!: (value: string) => void;
  provider.send
    .mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    )
    .mockResolvedValue('0x15');
  // Native owns the shared head query; both native and token are waiting for it.
  controller.refreshBalancesAfterReceipt({ from: A, to: T, blockNumber: 10 });
  await jest.advanceTimersByTimeAsync(100);
  expect(provider.send).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(30_250);
  expect(readProviders[0].signal.aborted).toBe(true);
  expect(readProviders[1].signal.aborted).toBe(true);
  expect(provider.send).toHaveBeenCalledTimes(2);
  expect(provider.getBalance).toHaveBeenCalledTimes(1);
  expect(balanceOf).toHaveBeenCalledTimes(1);
  expect(balanceOf).toHaveBeenCalledWith(A, { blockTag: 21 });
  resolve('0xb'); // ignored-abort transport finally completes the old query
  await jest.advanceTimersByTimeAsync(0);
  expect(provider.getBalance).toHaveBeenCalledTimes(1);
  expect(balanceOf).toHaveBeenCalledTimes(1);
  expect(state.vault.accountAssets[type][0].ethereum[0].balance).toBe(9);
  expect(
    readProviders.every((local) => local.destroy.mock.calls.length === 1)
  ).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});

it('immediately disposes pending receipt transports when the wallet context is cancelled', async () => {
  provider.send.mockReturnValue(new Promise(() => undefined));
  controller.refreshBalancesAfterReceipt({ from: A, to: T, blockNumber: 10 });
  await jest.advanceTimersByTimeAsync(100);
  controller.stopAllRapidPolling();
  await jest.advanceTimersByTimeAsync(0);
  expect(readProviders.every((local) => local.signal.aborted)).toBe(true);
  expect(
    readProviders.every((local) => local.destroy.mock.calls.length === 1)
  ).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
  await jest.advanceTimersByTimeAsync(300_000);
  expect(provider.send).toHaveBeenCalledTimes(1);
  expect(balanceOf).not.toHaveBeenCalled();
});

it('does not overwrite a newer regular token balance with a delayed receipt response', async () => {
  let resolve!: (value: bigint) => void;
  balanceOf.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  controller.refreshBalancesAfterReceipt({ from: A, to: T, blockNumber: 10 });
  await jest.advanceTimersByTimeAsync(100);
  controller.assetsManager = {
    utils: {
      updateAssetsFromCurrentAccount: async (...args: any[]) => {
        args[6](asset(T, 11));
        return { ethereum: [asset(T, 11), asset(U)], syscoin: [] };
      },
    },
  };
  await controller.updateAssetsFromCurrentAccount({
    activeAccount: state.vault.activeAccount,
    activeNetwork: state.vault.activeNetwork,
    isBitcoinBased: false,
    isPolling: true,
  });
  expect(state.vault.accountAssets[type][0].ethereum[0].balance).toBe(11);
  resolve(BigInt(10));
  await jest.advanceTimersByTimeAsync(0);
  expect(state.vault.accountAssets[type][0].ethereum[0].balance).toBe(11);
});

it('does not overwrite a newer regular native balance with a delayed receipt response', async () => {
  let resolve!: (value: bigint) => void;
  provider.getBalance.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  controller.refreshBalancesAfterReceipt({ from: A, to: T, blockNumber: 10 });
  await jest.advanceTimersByTimeAsync(100);
  controller.balancesManager = {
    utils: { getBalanceUpdatedForAccount: async () => 2 },
  };
  await controller.updateUserNativeBalance({
    activeAccount: state.vault.activeAccount,
    activeNetwork: state.vault.activeNetwork,
    isBitcoinBased: false,
    isPolling: true,
  });
  expect(state.vault.accounts[type][0].nativeBalance).toBe(2);
  resolve(BigInt('1000000000000000000'));
  await jest.advanceTimersByTimeAsync(0);
  expect(state.vault.accounts[type][0].nativeBalance).toBe(2);
});

it('retains external-dapp preflight for an unimported ERC20 without adding an asset', async () => {
  const external = `0x${'66'.repeat(20)}`;
  controller.getERC20TokenInfo = jest.fn().mockResolvedValue({
    balance: '123',
    decimals: 2,
    symbol: 'EXT',
    name: 'External',
  });
  const result = await controller.refreshActiveEvmTokenBalance(external);
  expect(result).toMatchObject({
    balance: 1.23,
    tokenSymbol: 'EXT',
    contractAddress: external,
  });
  expect(state.vault.accountAssets[type][0].ethereum).toHaveLength(2);
});

it.each(['failed', 'mixed'])(
  'does not discard a successful target when a normal poll has %s token reads',
  async (mode) => {
    let resolve!: (value: bigint) => void;
    balanceOf.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    controller.refreshBalancesAfterReceipt({ from: A, to: T, blockNumber: 10 });
    await jest.advanceTimersByTimeAsync(100);
    controller.assetsManager = {
      utils: {
        updateAssetsFromCurrentAccount: async (...args: any[]) => {
          // T failed (old value preserved). Only U succeeded in the mixed case.
          if (mode === 'mixed') args[6](asset(U, 26));
          return {
            ethereum: mode === 'mixed' ? [asset(T), asset(U, 26)] : [],
            syscoin: [],
          };
        },
      },
    };
    await controller.updateAssetsFromCurrentAccount({
      activeAccount: state.vault.activeAccount,
      activeNetwork: state.vault.activeNetwork,
      isBitcoinBased: false,
      isPolling: true,
    });
    resolve(BigInt(19));
    await jest.advanceTimersByTimeAsync(0);
    expect(state.vault.accountAssets[type][0].ethereum[0].balance).toBe(19);
    if (mode === 'mixed')
      expect(state.vault.accountAssets[type][0].ethereum[1].balance).toBe(26);
  }
);

it('counts a successful unchanged normal read even when no asset dispatch is needed', async () => {
  let resolve!: (value: bigint) => void;
  balanceOf.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  controller.refreshBalancesAfterReceipt({ from: A, to: T, blockNumber: 10 });
  await jest.advanceTimersByTimeAsync(100);
  controller.assetsManager = {
    utils: {
      updateAssetsFromCurrentAccount: async (...args: any[]) => {
        args[6](asset(T));
        return { ethereum: [], syscoin: [] }; // existing unchanged-result convention
      },
    },
  };
  await controller.updateAssetsFromCurrentAccount({
    activeAccount: state.vault.activeAccount,
    activeNetwork: state.vault.activeNetwork,
    isBitcoinBased: false,
    isPolling: true,
  });
  resolve(BigInt(10));
  await jest.advanceTimersByTimeAsync(0);
  expect(state.vault.accountAssets[type][0].ethereum[0].balance).toBe(5);
});
