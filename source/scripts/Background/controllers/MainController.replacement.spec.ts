jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: {
    notifyTransaction: jest.fn(),
    updatePendingTransactionBadge: jest.fn(),
  },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
const mockPersist = jest.fn();
const mockDispatch = jest.fn();
let mockState: any;
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockState,
    dispatch: (action: any) => mockDispatch(action),
  },
  persistCommittedWalletState: (...args: any[]) => mockPersist(...args),
}));

import { notificationManager } from '..';
import vaultReducer, {
  rehydrate,
  setAccountTransactions,
  setSingleTransactionToState,
} from 'state/vault';
import { INetworkType, KeyringAccountType } from 'types/network';

import MainController from './MainController';

const ADDRESS = `0x${'11'.repeat(20)}`;
const OTHER = `0x${'22'.repeat(20)}`;
const SMART = `0x${'33'.repeat(20)}`;
const CHAIN = 5700;
const hash = (byte: string) => `0x${byte.repeat(64)}`;
const ORIGINAL = hash('1');
const response = (txHash: string, fields: any = {}) => ({
  chainId: CHAIN,
  from: ADDRESS,
  to: OTHER,
  value: '1000000000000000000',
  nonce: 8,
  hash: txHash,
  confirmations: 0,
  ...fields,
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => (resolve = finish));
  return { promise, resolve };
};

describe('EVM replacement intent and durable history', () => {
  let wallet: any;
  let snapshots: any[];
  const rows = () =>
    mockState.vault.accountTransactions[mockState.vault.activeAccount.type][
      mockState.vault.activeAccount.id
    ].ethereum[CHAIN];
  const row = (txHash: string) => rows().find((tx: any) => tx.hash === txHash);
  const changeContext = (axis: string) => {
    const vault = mockState.vault;
    if (axis === 'session') wallet.walletSessionGeneration++;
    if (axis === 'provider') wallet.ethereumTransaction.web3Provider = {};
    if (axis === 'transaction controller')
      wallet.ethereumTransaction = { web3Provider: {} };
    if (axis === 'slip44')
      mockState = { ...mockState, vaultGlobal: { activeSlip44: 57 } };
    if (axis === 'account')
      mockState = {
        ...mockState,
        vault: {
          ...vault,
          activeAccount: { type: KeyringAccountType.HDAccount, id: 1 },
        },
      };
    if (axis === 'address')
      mockState = {
        ...mockState,
        vault: {
          ...vault,
          accounts: {
            ...vault.accounts,
            HDAccount: {
              ...vault.accounts.HDAccount,
              0: { ...vault.accounts.HDAccount[0], address: OTHER },
            },
          },
        },
      };
    if (axis === 'RPC' || axis === 'chain')
      mockState = {
        ...mockState,
        vault: {
          ...vault,
          activeNetwork: {
            ...vault.activeNetwork,
            ...(axis === 'RPC' ? { url: 'rpc-b' } : { chainId: 1 }),
          },
        },
      };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    snapshots = [];
    const initial = JSON.parse(
      JSON.stringify(vaultReducer(undefined, { type: 'init' }))
    );
    mockState = {
      vault: {
        ...initial,
        isBitcoinBased: false,
        activeAccount: { type: KeyringAccountType.HDAccount, id: 0 },
        accounts: {
          ...initial.accounts,
          HDAccount: {
            0: { id: 0, address: ADDRESS },
            1: { id: 1, address: OTHER },
          },
        },
        activeNetwork: {
          chainId: CHAIN,
          kind: INetworkType.Ethereum,
          slip44: 60,
          url: 'rpc-a',
        },
        accountTransactions: {
          ...initial.accountTransactions,
          HDAccount: {
            0: { ethereum: { [CHAIN]: [response(ORIGINAL)] }, syscoin: {} },
            1: { ethereum: { [CHAIN]: [] }, syscoin: {} },
          },
        },
      },
      vaultGlobal: { activeSlip44: 60 },
    };
    mockDispatch.mockImplementation((action) => {
      mockState = {
        ...mockState,
        vault: vaultReducer(mockState.vault, action),
      };
      return action;
    });
    mockPersist.mockImplementation(async (_include, _skip, isCurrent) => {
      if (!isCurrent()) throw Error('Wallet state changed before persistence');
      snapshots.push(JSON.parse(JSON.stringify(mockState.vault)));
    });
    wallet = Object.create(MainController.prototype);
    wallet.walletSessionGeneration = 5;
    wallet.isResettingWallet = false;
    Object.defineProperty(wallet, 'ethereumTransaction', {
      configurable: true,
      writable: true,
      value: { web3Provider: {} },
    });
    wallet.startRapidTransactionPolling = jest.fn();
  });
  afterEach(() => jest.restoreAllMocks());

  it('keeps cancellation purpose through acceleration, cancellation, and repeated acceleration', async () => {
    const sped = hash('2');
    const canceled = hash('3');
    const fasterCancel = hash('4');
    const fastestCancel = hash('5');
    await wallet.setEvmTransactionAsAccelerated(
      ORIGINAL,
      CHAIN,
      response(sped)
    );
    await wallet.setEvmTransactionCancelSubmitted(
      sped,
      CHAIN,
      response(canceled, { to: ADDRESS, value: '0' })
    );
    await wallet.setEvmTransactionAsAccelerated(
      canceled,
      CHAIN,
      response(fasterCancel, { to: ADDRESS, value: '0' })
    );
    await wallet.setEvmTransactionAsAccelerated(
      fasterCancel,
      CHAIN,
      response(fastestCancel, { to: ADDRESS, value: '0' })
    );
    expect(row(fastestCancel)).toMatchObject({
      isCancel: true,
      isSpeedUp: true,
    });
    expect(row(ORIGINAL)).toMatchObject({
      isReplaced: true,
      status: 'replaced',
    });
    expect(row(sped)).toMatchObject({
      isSpeedUp: true,
      isCancel: false,
      replacesHash: ORIGINAL,
      replacementRootHash: ORIGINAL,
    });
    expect(row(canceled)).toMatchObject({
      isCancel: true,
      isSpeedUp: false,
      replacesHash: sped,
      replacementRootHash: ORIGINAL,
      isReplaced: true,
    });
    expect(row(fasterCancel)).toMatchObject({
      isCancel: true,
      isSpeedUp: true,
      replacesHash: canceled,
      replacementRootHash: ORIGINAL,
      isReplaced: true,
    });
    expect(row(fastestCancel)).toMatchObject({
      isCancel: true,
      isSpeedUp: true,
      replacesHash: fasterCancel,
      replacementRootHash: ORIGINAL,
    });
    expect(snapshots).toHaveLength(4);
    const restored: any = vaultReducer(undefined, rehydrate(snapshots[3]));
    expect(
      restored.accountTransactions.HDAccount[0].ethereum[CHAIN].find(
        (tx: any) => tx.hash === fastestCancel
      )
    ).toMatchObject({
      isCancel: true,
      isSpeedUp: true,
      replacementRootHash: ORIGINAL,
    });
  });

  it('does not infer cancellation purpose from a zero-value self transfer or provider flags', async () => {
    const txHash = hash('2');
    await wallet.setEvmTransactionAsAccelerated(
      ORIGINAL,
      CHAIN,
      response(txHash, {
        to: ADDRESS,
        value: '0',
        isCancel: true,
        replacementRootHash: hash('f'),
      })
    );
    expect(row(txHash)).toMatchObject({
      isCancel: false,
      isSpeedUp: true,
      replacementRootHash: ORIGINAL,
    });
  });

  it('inherits the root through legacy parent links without flattening the immediate parent', async () => {
    const first = response(hash('2'), {
      isSpeedUp: true,
      replacesHash: ORIGINAL,
    });
    const cancel = response(hash('3'), {
      isCancel: true,
      to: ADDRESS,
      value: '0',
      replacesHash: first.hash,
    });
    mockDispatch(
      setSingleTransactionToState({
        chainId: CHAIN,
        networkType: 'ethereum',
        transaction: first,
      } as any)
    );
    mockDispatch(
      setSingleTransactionToState({
        chainId: CHAIN,
        networkType: 'ethereum',
        transaction: cancel,
      } as any)
    );
    await wallet.setEvmTransactionAsAccelerated(
      cancel.hash,
      CHAIN,
      response(hash('4'), { to: ADDRESS, value: '0' })
    );
    expect(row(hash('4'))).toMatchObject({
      replacesHash: cancel.hash,
      replacementRootHash: ORIGINAL,
      isCancel: true,
    });
  });

  it('recovers recorded cancellation intent through a legacy speedup that lost the cancel flag', async () => {
    const cancel = response(hash('2'), {
      isCancel: true,
      to: ADDRESS,
      value: '0',
      replacesHash: ORIGINAL,
    });
    const legacySpeedup = response(hash('3'), {
      isSpeedUp: true,
      to: ADDRESS,
      value: '0',
      replacesHash: cancel.hash,
    });
    for (const transaction of [cancel, legacySpeedup])
      mockDispatch(
        setSingleTransactionToState({
          chainId: CHAIN,
          networkType: 'ethereum',
          transaction,
        } as any)
      );
    await wallet.setEvmTransactionAsAccelerated(
      legacySpeedup.hash,
      CHAIN,
      response(hash('4'), { to: ADDRESS, value: '0' })
    );
    expect(row(hash('4'))).toMatchObject({
      isCancel: true,
      isSpeedUp: true,
      replacesHash: legacySpeedup.hash,
      replacementRootHash: ORIGINAL,
    });
  });

  it.each([
    { from: OTHER },
    { nonce: 9 },
    { chainId: 1 },
    { historySource: 'explorer-tokentx' },
    { type: '0x7f' },
    { r: '0x0', s: '0x0', v: '0x0' },
  ])(
    'does not inherit cancellation from an incompatible linked ancestor %j',
    async (fields) => {
      const unrelatedCancel = response(hash('2'), {
        isCancel: true,
        ...fields,
      });
      const legacySpeedup = response(hash('3'), {
        isSpeedUp: true,
        replacesHash: unrelatedCancel.hash,
      });
      for (const transaction of [unrelatedCancel, legacySpeedup])
        mockDispatch(
          setSingleTransactionToState({
            chainId: CHAIN,
            networkType: 'ethereum',
            transaction,
          } as any)
        );
      await wallet.setEvmTransactionAsAccelerated(
        legacySpeedup.hash,
        CHAIN,
        response(hash('4'))
      );
      expect(row(hash('4')).isCancel).toBe(false);
      expect(row(hash('4')).replacementRootHash).toBe(legacySpeedup.hash);
    }
  );

  it('retains cancellation purpose, AA ownership, and refresh targets when a receipt replaces the local row', async () => {
    const metadata = {
      smartAccountExecutionFrom: SMART,
      balanceRefreshTokenAddresses: [OTHER],
      balanceRefreshNativeAddresses: [ADDRESS, SMART],
    };
    mockState.vault = {
      ...mockState.vault,
      activeAccount: { type: KeyringAccountType.SmartAccount, id: 7 },
      accounts: {
        ...mockState.vault.accounts,
        SmartAccount: { 7: { id: 7, address: SMART } },
      },
      accountTransactions: {
        ...mockState.vault.accountTransactions,
        SmartAccount: {
          7: {
            ethereum: { [CHAIN]: [response(ORIGINAL, metadata)] },
            syscoin: {},
          },
        },
      },
    };
    const canceled = hash('2');
    const sped = hash('3');
    await wallet.setEvmTransactionCancelSubmitted(
      ORIGINAL,
      CHAIN,
      response(canceled, { to: ADDRESS, value: '0' })
    );
    await wallet.setEvmTransactionAsAccelerated(
      canceled,
      CHAIN,
      response(sped, { to: ADDRESS, value: '0' })
    );
    expect(row(sped)).toMatchObject({
      ...metadata,
      isCancel: true,
      isSpeedUp: true,
    });
    mockDispatch(
      setAccountTransactions({
        chainId: CHAIN,
        networkType: 'ethereum',
        transactions: [
          response(sped, {
            to: ADDRESS,
            value: '0',
            blockNumber: 123,
            confirmations: 2,
          }),
        ],
      } as any)
    );
    expect(row(sped)).toMatchObject({
      smartAccountExecutionFrom: SMART,
      isCancel: true,
      isSpeedUp: true,
      replacementRootHash: ORIGINAL,
      blockNumber: 123,
    });
  });

  it('waits for the persistence barrier before notifying or starting receipt polling', async () => {
    const gate = deferred<void>();
    mockPersist.mockImplementationOnce(async (_include, _skip, current) => {
      await gate.promise;
      expect(current()).toBe(true);
    });
    const saving = wallet.setEvmTransactionCancelSubmitted(
      ORIGINAL,
      CHAIN,
      response(hash('2'), { to: ADDRESS, value: '0' })
    );
    expect(mockPersist).toHaveBeenCalledWith(true, true, expect.any(Function));
    expect(notificationManager.notifyTransaction).not.toHaveBeenCalled();
    expect(wallet.startRapidTransactionPolling).not.toHaveBeenCalled();
    gate.resolve();
    await saving;
    expect(notificationManager.notifyTransaction).toHaveBeenCalledTimes(1);
    expect(wallet.startRapidTransactionPolling).toHaveBeenCalledWith(
      hash('2'),
      CHAIN,
      false,
      { type: KeyringAccountType.HDAccount, id: 0 },
      expect.any(Function)
    );
  });

  it('retains the acknowledged hash on a save failure without claiming that the send was rejected', async () => {
    mockPersist.mockRejectedValueOnce(Error('Storage failed'));
    await expect(
      wallet.setEvmTransactionCancelSubmitted(
        ORIGINAL,
        CHAIN,
        response(hash('2'), { to: ADDRESS, value: '0' })
      )
    ).rejects.toMatchObject({
      transactionHash: hash('2'),
      transactionNotBroadcast: false,
      message: 'Storage failed',
    });
    expect(row(hash('2')).isCancel).toBe(true);
    expect(notificationManager.notifyTransaction).not.toHaveBeenCalled();
    expect(wallet.startRapidTransactionPolling).not.toHaveBeenCalled();
  });

  it.each([
    'account',
    'address',
    'chain',
    'RPC',
    'slip44',
    'session',
    'provider',
    'transaction controller',
  ])(
    'does not notify or poll a different context after %s changes during persistence',
    async (axis) => {
      const gate = deferred<void>();
      mockPersist.mockImplementationOnce(() => gate.promise);
      const saving = wallet.setEvmTransactionCancelSubmitted(
        ORIGINAL,
        CHAIN,
        response(hash('2'), { to: ADDRESS, value: '0' })
      );
      const rejected = expect(saving).rejects.toMatchObject({
        transactionHash: hash('2'),
        transactionNotBroadcast: false,
        message: 'PALI_TRANSACTION_CONTEXT_CHANGED',
      });
      changeContext(axis);
      gate.resolve();
      await rejected;
      expect(notificationManager.notifyTransaction).not.toHaveBeenCalled();
      expect(wallet.startRapidTransactionPolling).not.toHaveBeenCalled();
    }
  );

  it.each(['wrong account', 'wrong chain', 'wrong nonce'])(
    'refuses a %s callback before changing any transaction bucket',
    async (failure) => {
      if (failure === 'wrong account') changeContext('account');
      const tx = response(
        hash('2'),
        failure === 'wrong chain'
          ? { chainId: 1 }
          : failure === 'wrong nonce'
          ? { nonce: 9 }
          : {}
      );
      await expect(
        wallet.setEvmTransactionCancelSubmitted(ORIGINAL, CHAIN, tx)
      ).rejects.toMatchObject({
        transactionHash: tx.hash,
        transactionNotBroadcast: false,
      });
      expect(mockDispatch).not.toHaveBeenCalled();
      expect(mockPersist).not.toHaveBeenCalled();
    }
  );

  it('refuses to file a callback in another same-address account when the original belongs to the prior bucket', async () => {
    mockState.vault = {
      ...mockState.vault,
      activeAccount: { type: KeyringAccountType.HDAccount, id: 1 },
      accounts: {
        ...mockState.vault.accounts,
        HDAccount: {
          ...mockState.vault.accounts.HDAccount,
          1: { id: 1, address: ADDRESS },
        },
      },
    };
    await expect(
      wallet.setEvmTransactionCancelSubmitted(
        ORIGINAL,
        CHAIN,
        response(hash('2'), { to: ADDRESS, value: '0' })
      )
    ).rejects.toMatchObject({
      transactionHash: hash('2'),
      transactionNotBroadcast: false,
    });
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockPersist).not.toHaveBeenCalled();
  });

  it('does not emit a stale pending notification when a newer replacement already owns the nonce', async () => {
    const gate = deferred<void>();
    mockPersist.mockImplementationOnce(() => gate.promise);
    const saving = wallet.setEvmTransactionCancelSubmitted(
      ORIGINAL,
      CHAIN,
      response(hash('2'), { to: ADDRESS, value: '0' })
    );
    mockDispatch(
      setSingleTransactionToState({
        chainId: CHAIN,
        networkType: 'ethereum',
        transaction: {
          ...row(hash('2')),
          isReplaced: true,
          status: 'replaced',
        },
      } as any)
    );
    gate.resolve();
    await saving;
    expect(notificationManager.notifyTransaction).not.toHaveBeenCalled();
    expect(wallet.startRapidTransactionPolling).not.toHaveBeenCalled();
  });

  it.each(['before lookup', 'during lookup'])(
    'bounds replacement receipt polling to the same RPC/session %s',
    async (phase) => {
      jest.useFakeTimers();
      try {
        wallet.startRapidTransactionPolling =
          MainController.prototype['startRapidTransactionPolling'];
        wallet.activeRapidPolls = new Map();
        const lookup = deferred<any>();
        wallet.getEvmTransactionFromProvider = jest.fn(() => lookup.promise);
        wallet.updateTrackedEvmTransactionCopies = jest.fn();
        await wallet.setEvmTransactionCancelSubmitted(
          ORIGINAL,
          CHAIN,
          response(hash('2'), { to: ADDRESS, value: '0' })
        );
        if (phase === 'before lookup') changeContext('RPC');
        jest.advanceTimersByTime(4000);
        if (phase === 'before lookup') {
          expect(wallet.getEvmTransactionFromProvider).not.toHaveBeenCalled();
        } else {
          expect(wallet.getEvmTransactionFromProvider).toHaveBeenCalledTimes(1);
          changeContext('session');
          lookup.resolve(
            response(hash('2'), { confirmations: 1, blockNumber: 123 })
          );
          for (let i = 0; i < 4; i++) await Promise.resolve();
          expect(
            wallet.updateTrackedEvmTransactionCopies
          ).not.toHaveBeenCalled();
        }
        expect(wallet.activeRapidPolls.size).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    }
  );
});
