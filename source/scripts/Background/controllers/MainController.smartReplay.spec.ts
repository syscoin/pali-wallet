/** @jest-environment node */
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
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockState,
    dispatch: jest.fn((action) => {
      const reducer = jest.requireActual('state/vault').default;
      mockState = {
        ...mockState,
        vault: structuredClone(reducer(mockState.vault, action)),
      };
    }),
    subscribe: jest.fn(() => () => undefined),
  },
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => ({
    account: String(mockState.vault.activeAccount.id),
    network: mockState.vault.activeNetwork.url,
  }),
}));

import { SoftwareKeyring } from '@sidhujag/sysweb3-keyring/cjs/software.js';
import { webcrypto } from 'crypto';
import { Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';

import { notificationManager } from '..';
import { EvmSignedRecords } from '../../../wallet/evmSignedRecords';
import * as privateReplay from '../../../wallet/privateNoteReplay';
import {
  decodeRetainedSmartAccountOperations,
  decodeSmartAccountOperations,
} from '../../../wallet/smartAccountActivity';
import { encodeERC7579Executions } from 'utils/smartAccount/account';
import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
  paliSmartAccountInterface,
} from 'utils/smartAccount/contracts';

import MainController from './MainController';
import { CancellablePromises } from './promises/cancellablesPromises';
import SmartAccountController from './smartAccount';

const smart = '0x' + '11'.repeat(20),
  recipient = '0x' + '22'.repeat(20);
const payer = new Wallet('0x' + '33'.repeat(32));
const blockHash = '0x' + '44'.repeat(32);
let mockState: any;
afterEach(() => jest.restoreAllMocks());

async function fixture(
  nonce = 0,
  operationCount = 1,
  target = recipient,
  followingTarget = target
) {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
  mockState = {
    vault: {
      isBitcoinBased: false,
      activeAccount: { id: 1, type: 'SmartAccount' },
      activeNetwork: {
        kind: 'ethereum',
        chainId: 1,
        slip44: 60,
        url: 'https://rpc.invalid',
      },
      accountTransactions: { SmartAccount: {}, HDAccount: {} },
      accounts: {
        SmartAccount: { 1: { address: smart, isSmartAccount: true } },
        HDAccount: { 0: { address: payer.address } },
      },
    },
    vaultGlobal: { activeSlip44: 60 },
  };
  const keyring: any = Object.create(SoftwareKeyring.prototype);
  keyring.sessionPassword = { isCleared: () => false };
  keyring.sessionMnemonic = { isCleared: () => false };
  keyring.privateRecordSessionRevision = 0;
  keyring.getDecryptedMnemonic = () =>
    'public deterministic Smart replay fixture';
  let disk: string | undefined;
  const records = new EvmSignedRecords(
    {
      async read() {
        return disk;
      },
      async compareAndSet(_id, previous, next, check) {
        check();
        if (disk !== previous) return false;
        disk = next;
        return true;
      },
    },
    () => 1000
  );
  const broadcasts: string[] = [];
  const provider = {
    _send: jest.fn(async () => [{ jsonrpc: '2.0', id: 0, result: '0x1' }]),
    send: jest.fn(async (method: string, params: unknown[]) => {
      if (method === 'eth_chainId') return '0x1';
      if (method === 'eth_getTransactionCount') return '0x0';
      if (method === 'eth_getTransactionReceipt') return null;
      if (method === 'eth_getBlockByNumber')
        return { number: '0x10', hash: blockHash, gasLimit: '0x100000' };
      if (method === 'eth_sendRawTransaction') {
        broadcasts.push(String(params[0]));
        return Transaction.from(String(params[0])).hash;
      }
      throw new Error(method);
    }),
  };
  keyring.ethereumTransaction = { web3Provider: provider };
  const wallet: any = Object.create(MainController.prototype);
  wallet.walletSessionGeneration = 1;
  wallet.networkRequestGeneration = 1;
  wallet.pendingEvmReceiptChecks = new Map();
  wallet.startRapidTransactionPolling = jest.fn();
  wallet.saveWalletState = jest.fn(async () => undefined);
  wallet.refreshBalancesAfterReceipt = jest.fn();
  wallet.assertWalletReadyForSigning = () => undefined;
  wallet.assertCurrentWalletSession = (generation: number) => {
    if (generation !== wallet.walletSessionGeneration)
      throw new Error('Session changed');
  };
  wallet.getActiveKeyring = () => keyring;
  wallet.getRetainedEvmRecords = () => records;
  wallet.captureFreshEvmRead = () => {
    const generation = wallet.walletSessionGeneration,
      url = mockState.vault.activeNetwork.url;
    const check = () => {
      if (
        generation !== wallet.walletSessionGeneration ||
        url !== mockState.vault.activeNetwork.url
      )
        throw new Error('Context changed');
    };
    return {
      keyring,
      network: { ...mockState.vault.activeNetwork },
      assertCurrent: check,
      run: async (read: any) => {
        check();
        const result = await read(provider);
        check();
        return result;
      },
    };
  };
  const session = { keyring, assertCurrent: () => undefined };
  const encoded = encodeERC7579Executions([{ target, value: '9' }]);
  const operation = {
    sender: smart,
    nonce: 7,
    initCode: '0x',
    callData: paliSmartAccountInterface.encodeFunctionData('execute', [
      encoded.mode,
      encoded.executionCalldata,
    ]),
    accountGasLimits:
      '0x' + '00'.repeat(12) + '000186a0' + '00'.repeat(12) + '000186a0',
    preVerificationGas: 21000,
    gasFees: '0x' + '00'.repeat(15) + '01' + '00'.repeat(15) + '03',
    paymasterAndData: '0x',
    signature: '0x1234',
  };
  let predecessor: string | undefined;
  if (nonce > 0) {
    predecessor = await payer.signTransaction({
      chainId: 1,
      nonce: 0,
      type: 0,
      gasPrice: 2,
      gasLimit: 21000,
      to: recipient,
      value: 1,
    });
    const previous = Transaction.from(predecessor);
    await records.append(session, {
      rawTransaction: predecessor,
      hash: previous.hash!,
      from: payer.address,
      chainId: '1',
      nonce: 0,
      type: 0,
      context: {
        account: { id: 0, type: 'HDAccount', address: payer.address },
        network: mockState.vault.activeNetwork,
        operation: 'send',
      },
    });
  }
  const rawTransaction = await payer.signTransaction({
    chainId: 1,
    nonce,
    type: 0,
    gasPrice: 2,
    gasLimit: 300000,
    value: 0,
    to: getPaliEntryPointAddress(1),
    data: paliEntryPointInterface.encodeFunctionData('handleOps', [
      Array.from({ length: operationCount }, (_value, index) => {
        const call = encodeERC7579Executions([
          { target: index === 0 ? target : followingTarget, value: '9' },
        ]);
        return {
          ...operation,
          nonce: operation.nonce + index,
          callData: paliSmartAccountInterface.encodeFunctionData('execute', [
            call.mode,
            call.executionCalldata,
          ]),
        };
      }),
      payer.address,
    ]),
  });
  const tx = Transaction.from(rawTransaction);
  await records.append(session, {
    rawTransaction,
    hash: tx.hash!,
    from: payer.address,
    chainId: '1',
    nonce,
    type: 0,
    context: {
      account: { id: 0, type: 'HDAccount', address: payer.address },
      network: mockState.vault.activeNetwork,
      operation: 'send',
    },
  });
  return {
    wallet,
    records,
    session,
    provider,
    broadcasts,
    rawTransaction,
    hash: tx.hash!,
    predecessor,
  };
}

it('finds metadata-free Smart operations and replays exact bytes through the recorded local payer', async () => {
  const f = await fixture();
  const page = await f.wallet.getSavedEvmTransactions();
  expect(page.transactions).toHaveLength(1);
  expect(page.transactions[0].smartAccount.account.toLowerCase()).toBe(smart);
  const saved = await f.wallet.getSavedEvmTransaction(f.hash);
  expect(saved.smartAccount.transfer).toMatchObject({
    recipient,
    amountUnits: '9',
  });
  const prepared = await f.wallet.prepareEvmSignedReplay(f.hash);
  expect(prepared.status).toBe('review');
  expect(prepared.review.from.toLowerCase()).toBe(payer.address.toLowerCase());
  await expect(
    f.wallet.confirmEvmSignedReplay(prepared.review.id)
  ).resolves.toMatchObject({ status: 'submitted', hash: f.hash });
  expect(f.broadcasts).toEqual([f.rawTransaction]);
});

async function settleReplay(
  f: Awaited<ReturnType<typeof fixture>>,
  outcome:
    | 'confirmed'
    | 'reverted'
    | 'missing'
    | 'wrong-operation'
    | 'duplicate'
    | 'missing-calldata'
    | 'empty-calldata'
    | 'contradictory-calldata',
  secondOutcome?: 'confirmed' | 'reverted' | 'missing' | 'duplicate'
) {
  const entry = await f.records.readExact(
    f.session,
    '1',
    payer.address,
    f.hash
  );
  const identity = decodeRetainedSmartAccountOperations(entry!)[0];
  const conflictingData = Transaction.from(f.rawTransaction).data.replace(
    '22'.repeat(20),
    '66'.repeat(20)
  );
  const conflicting = decodeSmartAccountOperations({
    chainId: '1',
    hash: f.hash,
    payer: payer.address,
    nonce: 0,
    to: getPaliEntryPointAddress(1),
    value: '0',
    data: conflictingData,
  })[0];
  const event = paliEntryPointInterface.encodeEventLog(
    paliEntryPointInterface.getEvent('UserOperationEvent')!,
    [
      outcome === 'wrong-operation'
        ? '0x' + 'aa'.repeat(32)
        : outcome === 'contradictory-calldata'
        ? conflicting.operationHash
        : identity.operationHash,
      smart,
      '0x' + '00'.repeat(20),
      identity.operationNonce,
      outcome !== 'reverted',
      1,
      1,
    ]
  );
  const log = {
    ...event,
    address: getPaliEntryPointAddress(1),
    transactionHash: f.hash,
    blockHash,
    blockNumber: '0xc',
  };
  const receipt = {
    transactionHash: f.hash,
    from: payer.address,
    to: getPaliEntryPointAddress(1),
    status: '0x1',
    blockNumber: '0xc',
    blockHash,
    transactionIndex: '0x0',
    logs:
      outcome === 'missing' ? [] : outcome === 'duplicate' ? [log, log] : [log],
  };
  if (secondOutcome && secondOutcome !== 'missing') {
    const second = decodeRetainedSmartAccountOperations(entry!)[1];
    const secondLog = {
      ...log,
      ...paliEntryPointInterface.encodeEventLog(
        paliEntryPointInterface.getEvent('UserOperationEvent')!,
        [
          second.operationHash,
          second.account,
          '0x' + '00'.repeat(20),
          second.operationNonce,
          secondOutcome !== 'reverted',
          1,
          1,
        ]
      ),
    };
    receipt.logs.push(secondLog);
    if (secondOutcome === 'duplicate') receipt.logs.push(secondLog);
  }
  const base = f.provider.send.getMockImplementation()!;
  f.provider.send.mockImplementation(async (method, params) => {
    if (method === 'eth_getTransactionReceipt') return receipt as any;
    if (method === 'eth_getBlockByNumber')
      return {
        number: '0xc',
        hash: blockHash,
        gasLimit: '0x100000',
        transactions: [f.hash],
      } as any;
    return base(method, params);
  });
  Object.assign(f.provider, {
    getTransaction: async () => {
      const tx = Transaction.from(f.rawTransaction);
      return [
        'missing-calldata',
        'empty-calldata',
        'contradictory-calldata',
      ].includes(outcome)
        ? {
            hash: tx.hash,
            from: tx.from,
            to: tx.to,
            chainId: tx.chainId,
            nonce: tx.nonce,
            value: tx.value,
            data:
              outcome === 'missing-calldata'
                ? undefined
                : outcome === 'empty-calldata'
                ? '0x'
                : conflictingData,
          }
        : tx;
    },
    getTransactionReceipt: async () => receipt,
    getBlockNumber: async () => 12,
    getBlock: async () => ({ timestamp: 1000 }),
  });
  return receipt;
}

async function saveNativeRecipientCopies(
  f: Awaited<ReturnType<typeof fixture>>,
  recipientType: 'SmartAccount' | 'HDAccount',
  target = recipient
) {
  const id = target === payer.address ? 0 : 2;
  mockState.vault.accounts[recipientType][id] = {
    address: target,
    isSmartAccount: recipientType === 'SmartAccount',
  };
  const controller = Object.create(SmartAccountController.prototype);
  const recipients = controller.getLocalNativeExecutionRecipients([
    { target, value: '9', data: '0x' },
  ]);
  expect(recipients).toEqual([{ id, type: recipientType }]);
  const tx = Transaction.from(f.rawTransaction);
  await f.wallet.sendAndSaveTransaction(
    {
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      nonce: tx.nonce,
      chainId: Number(tx.chainId),
      value: tx.value.toString(),
      input: tx.data,
      smartAccountExecutionFrom: smart,
    },
    { id: 1, type: 'SmartAccount' },
    {
      clearNavigation: false,
      persist: false,
      skipRapidPolling: true,
      transactionAccounts: [
        { id: 1, type: 'SmartAccount' },
        ...recipients,
        { id: 0, type: 'HDAccount' },
      ],
    }
  );
  return () =>
    mockState.vault.accountTransactions[recipientType][id].ethereum[1][0];
}

it.each(['SmartAccount', 'HDAccount'] as const)(
  'follows the authenticated originating operation for an owned %s recipient',
  async (recipientType) => {
    const f = await fixture();
    const recipientRow = await saveNativeRecipientCopies(f, recipientType);
    expect(recipientRow()).toMatchObject({
      smartAccountExecutionFrom: smart,
      from: payer.address,
    });
    await settleReplay(f, 'confirmed');
    const outer = await f.wallet.getEvmTransactionFromProvider(f.hash);
    f.provider.send.mockClear();
    await f.wallet.updateTrackedEvmTransactionCopies(f.hash, 1, outer);
    expect(recipientRow()).toMatchObject({
      blockNumber: 12,
      confirmations: 1,
      // eslint-disable-next-line camelcase -- RPC receipt field.
      txreceipt_status: '1',
      smartAccountExecutionFrom: smart,
    });
    expect(
      mockState.vault.accountTransactions.SmartAccount[1].ethereum[1][0]
        .txreceipt_status
    ).toBe('1');
    expect(
      f.provider.send.mock.calls.filter(
        ([method]) => method === 'eth_getTransactionReceipt'
      )
    ).toHaveLength(1);
  }
);

it.each(['SmartAccount', 'HDAccount', 'payer'] as const)(
  'does not confirm an incoming native transfer to %s when its originating operation reverts',
  async (recipientType) => {
    const target = recipientType === 'payer' ? payer.address : recipient;
    const f = await fixture(0, 1, target);
    const recipientRow = await saveNativeRecipientCopies(
      f,
      recipientType === 'payer' ? 'HDAccount' : recipientType,
      target
    );
    await settleReplay(f, 'reverted');
    const outer = await f.wallet.getEvmTransactionFromProvider(f.hash);
    expect(outer.txreceipt_status).toBe('1');
    jest.mocked(notificationManager.notifyTransaction).mockClear();
    await f.wallet.updateTrackedEvmTransactionCopies(f.hash, 1, outer);
    expect(recipientRow()).toMatchObject({
      blockNumber: 12,
      confirmations: 1,
      // eslint-disable-next-line camelcase -- RPC receipt field.
      txreceipt_status: '0',
      success: false,
    });
    const notice = jest
      .mocked(notificationManager.notifyTransaction)
      .mock.calls.map(([value]) => value)
      .find(
        (value) => value.account.address.toLowerCase() === target.toLowerCase()
      );
    expect(notice?.type).toBe('failed');
    if (recipientType !== 'payer')
      expect(
        mockState.vault.accountTransactions.HDAccount[0].ethereum[1][0]
          .txreceipt_status
      ).toBe('1');
  }
);

it.each(['confirmed', 'reverted', 'missing', 'duplicate'] as const)(
  'requires complete originating multi-operation outcomes for a recipient (%s)',
  async (secondOutcome) => {
    const f = await fixture(0, 2);
    const recipientRow = await saveNativeRecipientCopies(f, 'SmartAccount');
    await settleReplay(f, 'confirmed', secondOutcome);
    const outer = await f.wallet.getEvmTransactionFromProvider(f.hash);
    await f.wallet.updateTrackedEvmTransactionCopies(f.hash, 1, outer);
    const known = secondOutcome === 'confirmed' || secondOutcome === 'reverted';
    expect(recipientRow().txreceipt_status).toBe(
      known ? (secondOutcome === 'confirmed' ? '1' : '0') : null
    );
    expect(recipientRow().blockNumber).toBe(known ? 12 : null);
  }
);

it('does not authenticate a recipient from a foreign originating-account hint', async () => {
  const f = await fixture();
  const recipientRow = await saveNativeRecipientCopies(f, 'SmartAccount');
  recipientRow().smartAccountExecutionFrom = '0x' + '66'.repeat(20);
  await settleReplay(f, 'confirmed');
  const outer = await f.wallet.getEvmTransactionFromProvider(f.hash);
  await f.wallet.updateTrackedEvmTransactionCopies(f.hash, 1, outer);
  expect(recipientRow().txreceipt_status).toBeNull();
  expect(recipientRow().blockNumber).toBeNull();
});

it('does not give a native recipient the outcome of an unrelated originating operation', async () => {
  const f = await fixture(0, 2, recipient, '0x' + '66'.repeat(20));
  const recipientRow = await saveNativeRecipientCopies(f, 'SmartAccount');
  await settleReplay(f, 'confirmed', 'reverted');
  const outer = await f.wallet.getEvmTransactionFromProvider(f.hash);
  await f.wallet.updateTrackedEvmTransactionCopies(f.hash, 1, outer);
  expect(recipientRow()).toMatchObject({
    blockNumber: 12,
    confirmations: 1,
    // eslint-disable-next-line camelcase -- RPC receipt field.
    txreceipt_status: '1',
  });
  expect(
    mockState.vault.accountTransactions.SmartAccount[1].ethereum[1][0]
      .txreceipt_status
  ).toBe('0');
});

it.each(['forceRefresh', 'bypassCompletedCache'] as const)(
  'rechecks a recipient after logs recover on explicit %s while routine polling respects cooldown',
  async (refreshOption) => {
    const f = await fixture();
    const recipientRow = await saveNativeRecipientCopies(f, 'SmartAccount');
    await settleReplay(f, 'missing');
    await f.wallet.reconcileLocalPendingEvmSmartAccountTransactions(
      { id: 1, type: 'SmartAccount' },
      1
    );
    expect(recipientRow().txreceipt_status).toBeNull();
    await settleReplay(f, 'confirmed');
    mockState.vault.activeAccount = { id: 2, type: 'SmartAccount' };
    f.wallet.transactionUpdateRequestId = 0;
    f.wallet.transactionUpdateCommitId = 0;
    f.wallet.cancellablePromises = new CancellablePromises();
    f.wallet.transactionsManager = {
      utils: { updateTransactionsFromCurrentAccount: jest.fn(async () => []) },
    };
    f.wallet.activityNotificationObserver = () => ({ history: () => [] });
    f.provider.send.mockClear();
    const request = {
      isBitcoinBased: false,
      activeNetwork: mockState.vault.activeNetwork,
      isPolling: true,
    };
    await f.wallet.updateUserTransactionsState(request);
    expect(f.provider.send).not.toHaveBeenCalled();
    expect(recipientRow().txreceipt_status).toBeNull();
    await f.wallet.updateUserTransactionsState({
      ...request,
      [refreshOption]: true,
    });
    expect(recipientRow()).toMatchObject({
      blockNumber: 12,
      confirmations: 1,
      // eslint-disable-next-line camelcase -- RPC receipt field.
      txreceipt_status: '1',
    });
    expect(
      f.provider.send.mock.calls.filter(
        ([method]) => method === 'eth_getTransactionReceipt'
      )
    ).toHaveLength(1);
  }
);

it.each(['endpoint', 'account'] as const)(
  'does not apply a late receipt after the %s changes during reconciliation',
  async (changed) => {
    const f = await fixture();
    await saveNativeRecipientCopies(f, 'SmartAccount');
    await settleReplay(f, 'confirmed');
    const outer = await f.wallet.getEvmTransactionFromProvider(f.hash);
    const before = structuredClone(mockState.vault.accountTransactions);
    let release!: (value: unknown) => void;
    f.wallet.getEvmTransactionFromProvider = jest.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const pending = f.wallet.reconcileLocalPendingEvmSmartAccountTransactions(
      { id: 1, type: 'SmartAccount' },
      1,
      true
    );
    expect(f.wallet.getEvmTransactionFromProvider).toHaveBeenCalledTimes(1);
    if (changed === 'endpoint')
      mockState.vault.activeNetwork.url = 'https://other.invalid';
    else mockState.vault.activeAccount = { id: 2, type: 'SmartAccount' };
    release(outer);
    await pending;
    expect(mockState.vault.accountTransactions).toEqual(before);
    expect(f.wallet.refreshBalancesAfterReceipt).not.toHaveBeenCalled();
  }
);

it.each([
  'confirmed',
  'reverted',
  'missing',
  'wrong-operation',
  'duplicate',
  'missing-calldata',
  'empty-calldata',
  'contradictory-calldata',
] as const)(
  'uses the exact canonical inner outcome (%s) when ordinary receipt reconciliation resumes after replay',
  async (outcome) => {
    const f = await fixture();
    expect(mockState.vault.accountTransactions.SmartAccount[1]).toBeUndefined();
    const prepared = await f.wallet.prepareEvmSignedReplay(f.hash);
    await f.wallet.confirmEvmSignedReplay(prepared.review.id);
    const pending =
      mockState.vault.accountTransactions.SmartAccount[1].ethereum[1][0];
    expect(pending).toMatchObject({
      hash: f.hash,
      from: payer.address,
      input: Transaction.from(f.rawTransaction).data,
      smartAccountExecutionFrom: smart,
    });
    expect(pending.blockNumber).toBeUndefined();
    expect(f.wallet.startRapidTransactionPolling).toHaveBeenCalledWith(
      f.hash,
      1,
      false,
      { id: 1, type: 'SmartAccount' }
    );
    expect(f.wallet.saveWalletState).toHaveBeenCalled();
    mockState = structuredClone(mockState);
    await settleReplay(f, outcome);
    jest.mocked(notificationManager.notifyTransaction).mockClear();
    await f.wallet.reconcileLocalPendingEvmSmartAccountTransactions(
      { id: 1, type: 'SmartAccount' },
      1
    );
    if (
      ['missing-calldata', 'empty-calldata', 'contradictory-calldata'].includes(
        outcome
      )
    ) {
      expect(
        mockState.vault.accountTransactions.SmartAccount[1].ethereum[1][0]
          .blockNumber
      ).toBeNull();
      // The next ordinary reconciliation must still recognize the known
      // handleOps envelope when the RPC again omits its calldata.
      f.wallet.pendingEvmReceiptChecks.clear();
      await f.wallet.reconcileLocalPendingEvmSmartAccountTransactions(
        { id: 1, type: 'SmartAccount' },
        1
      );
    }
    const smartRow =
      mockState.vault.accountTransactions.SmartAccount[1].ethereum[1][0];
    const payerRow =
      mockState.vault.accountTransactions.HDAccount[0].ethereum[1][0];
    const known = outcome === 'confirmed' || outcome === 'reverted';
    expect(smartRow.blockNumber).toBe(known ? 12 : null);
    expect(smartRow.txreceipt_status).toBe(
      known ? (outcome === 'confirmed' ? '1' : '0') : null
    );
    expect(smartRow.confirmations).toBe(known ? 1 : 0);
    expect(payerRow.txreceipt_status).toBe('1');
    expect(payerRow.confirmations).toBe(1);
    const smartNotices = jest
      .mocked(notificationManager.notifyTransaction)
      .mock.calls.map(([notice]) => notice)
      .filter((notice) => notice.account.address.toLowerCase() === smart);
    expect(smartNotices).toHaveLength(known ? 1 : 0);
    if (known)
      expect(smartNotices[0].type).toBe(
        outcome === 'confirmed' ? 'confirmed' : 'failed'
      );
  }
);

it('keeps mined outer-only cancellation rows terminal without requiring a UserOperation event', async () => {
  const f = await fixture();
  const pending = {
    hash: f.hash,
    from: payer.address,
    to: payer.address,
    input: '0x',
    value: '0',
    isCancel: true,
    smartAccountExecutionFrom: smart,
  };
  mockState.vault.accountTransactions.SmartAccount[1] = {
    ethereum: { 1: [pending] },
  };
  const unresolved = await f.wallet.updateTrackedEvmTransactionCopies(
    f.hash,
    1,
    {
      ...pending,
      chainId: 1,
      nonce: 0,
      blockNumber: 12,
      blockHash,
      confirmations: 1,
      // eslint-disable-next-line camelcase
      txreceipt_status: '1',
      success: true,
    }
  );
  expect(unresolved).toBe(false);
  expect(
    mockState.vault.accountTransactions.SmartAccount[1].ethereum[1][0]
  ).toMatchObject({
    blockNumber: 12,
    ['txreceipt_status']: '1',
    isCancel: true,
  });
  expect(f.provider._send).not.toHaveBeenCalled();
});

it('does not replace a newer receipt with a delayed unknown inner result', async () => {
  const f = await fixture();
  const prepared = await f.wallet.prepareEvmSignedReplay(f.hash);
  await f.wallet.confirmEvmSignedReplay(prepared.review.id);
  await settleReplay(f, 'missing');
  const outer = await f.wallet.getEvmTransactionFromProvider(f.hash);
  const base = f.provider.send.getMockImplementation()!;
  let release!: () => void;
  let entered!: () => void;
  const observing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.provider.send.mockImplementation(async (method, params) => {
    if (method === 'eth_getTransactionReceipt') {
      entered();
      await held;
    }
    return base(method, params);
  });
  const update = f.wallet.updateTrackedEvmTransactionCopies(f.hash, 1, outer);
  await observing;
  const newer = {
    blockNumber: 13,
    blockHash: '0x' + '99'.repeat(32),
    confirmations: 1,
    // eslint-disable-next-line camelcase
    txreceipt_status: '0',
  };
  for (const [type, id] of [
    ['SmartAccount', 1],
    ['HDAccount', 0],
  ] as const) {
    const rows = mockState.vault.accountTransactions[type][id].ethereum[1];
    rows[0] = { ...rows[0], ...newer };
  }
  release();
  await update;
  expect(
    mockState.vault.accountTransactions.SmartAccount[1].ethereum[1][0]
  ).toMatchObject(newer);
  expect(
    mockState.vault.accountTransactions.HDAccount[0].ethereum[1][0]
  ).toMatchObject(newer);
});

it('keeps the existing rapid poll active while the canonical inner outcome is unavailable', async () => {
  const f = await fixture();
  const prepared = await f.wallet.prepareEvmSignedReplay(f.hash);
  await f.wallet.confirmEvmSignedReplay(prepared.review.id);
  await settleReplay(f, 'missing');
  f.wallet.activeRapidPolls = new Map();
  f.wallet.startRapidTransactionPolling =
    MainController.prototype['startRapidTransactionPolling'];
  jest.useFakeTimers();
  try {
    f.wallet.startRapidTransactionPolling(f.hash, 1, false, {
      id: 1,
      type: 'SmartAccount',
    });
    await jest.advanceTimersByTimeAsync(4000);
    expect(f.wallet.activeRapidPolls.size).toBe(1);
    expect(
      mockState.vault.accountTransactions.SmartAccount[1].ethereum[1][0]
        .blockNumber
    ).toBeNull();
    expect(
      mockState.vault.accountTransactions.HDAccount[0].ethereum[1][0]
        .blockNumber
    ).toBe(12);
  } finally {
    for (const timer of f.wallet.activeRapidPolls.values()) clearTimeout(timer);
    jest.useRealTimers();
  }
});

it('tracks the Smart account actually named by earlier payer bytes, not the currently selected parent', async () => {
  const f = await fixture();
  const entry = await f.records.readExact(
    f.session,
    '1',
    payer.address,
    f.hash
  );
  mockState.vault.accounts.SmartAccount[2] = {
    address: recipient,
    isSmartAccount: true,
  };
  mockState.vault.activeAccount = { id: 2, type: 'SmartAccount' };
  await f.wallet.recordAcknowledgedEvmReplay(entry, () => undefined);
  expect(
    mockState.vault.accountTransactions.SmartAccount[1].ethereum[1][0]
  ).toMatchObject({ hash: f.hash, smartAccountExecutionFrom: smart });
  expect(mockState.vault.accountTransactions.SmartAccount[2]).toBeUndefined();
  expect(
    mockState.vault.accountTransactions.HDAccount[0].ethereum[1][0].hash
  ).toBe(f.hash);
});

it.each(['cancel', 'speed-up'] as const)(
  'preserves the authenticated %s intent in public tracking',
  async (operation) => {
    const f = await fixture();
    const entry = await f.records.readExact(
      f.session,
      '1',
      payer.address,
      f.hash
    );
    const originalHash = '0x' + '77'.repeat(32);
    await f.wallet.recordAcknowledgedEvmReplay(
      { ...entry, operation, originalHash },
      () => undefined
    );
    const row = mockState.vault.accountTransactions.HDAccount[0].ethereum[1][0];
    expect(row.replacesHash).toBe(originalHash);
    expect(operation === 'cancel' ? row.isCancel : row.isSpeedUp).toBe(true);
  }
);

it('runs the private-note acknowledgement before tracking and does not expose private metadata', async () => {
  const f = await fixture();
  let acknowledged = false;
  jest.spyOn(privateReplay, 'authorizePrivateNoteReplay').mockResolvedValue({
    assertCurrent: () => undefined,
    withAdmission: async (admit) => admit(),
    onAcknowledged: async () => {
      acknowledged = true;
    },
  });
  f.wallet.saveWalletState.mockImplementation(async () => {
    expect(acknowledged).toBe(true);
  });
  const prepared = await f.wallet.prepareEvmSignedReplay(f.hash);
  await f.wallet.confirmEvmSignedReplay(prepared.review.id);
  expect(acknowledged).toBe(true);
  const row =
    mockState.vault.accountTransactions.SmartAccount[1].ethereum[1][0];
  expect(row).not.toHaveProperty('privateDeposit');
  expect(row).not.toHaveProperty('privateWithdrawal');
});

it('does not publish into another account when selection changes while acknowledging replay', async () => {
  const f = await fixture();
  jest.spyOn(privateReplay, 'authorizePrivateNoteReplay').mockResolvedValue({
    assertCurrent: () => undefined,
    withAdmission: async (admit) => admit(),
    onAcknowledged: async () => {
      mockState.vault.activeAccount = { id: 0, type: 'HDAccount' };
    },
  });
  const prepared = await f.wallet.prepareEvmSignedReplay(f.hash);
  await expect(
    f.wallet.confirmEvmSignedReplay(prepared.review.id)
  ).resolves.toMatchObject({ status: 'unknown', hash: f.hash });
  expect(mockState.vault.accountTransactions.SmartAccount[1]).toBeUndefined();
  expect(mockState.vault.accountTransactions.HDAccount[0]).toBeUndefined();
  expect(f.broadcasts).toEqual([f.rawTransaction]);
});

it('retains an accepted replay as unknown if public history tracking fails', async () => {
  const f = await fixture();
  f.wallet.sendAndSaveTransaction = jest.fn(async () => {
    throw new Error('storage failed');
  });
  const prepared = await f.wallet.prepareEvmSignedReplay(f.hash);
  await expect(
    f.wallet.confirmEvmSignedReplay(prepared.review.id)
  ).resolves.toMatchObject({ status: 'unknown', hash: f.hash });
  expect(f.broadcasts).toEqual([f.rawTransaction]);
  expect(
    (await f.records.readExact(f.session, '1', payer.address, f.hash))
      ?.rawTransaction
  ).toBe(f.rawTransaction);
});

it.each(['selected', 'payer', 'network', 'session'] as const)(
  'refuses %s drift after Smart replay review',
  async (change) => {
    const f = await fixture();
    const prepared = await f.wallet.prepareEvmSignedReplay(f.hash);
    expect(prepared.status).toBe('review');
    if (change === 'selected')
      mockState.vault.accounts.SmartAccount[1] = { address: recipient };
    if (change === 'payer')
      mockState.vault.accounts.HDAccount[0] = { address: recipient };
    if (change === 'network')
      mockState.vault.activeNetwork.url = 'https://other.invalid';
    if (change === 'session') f.wallet.walletSessionGeneration += 1;
    await expect(
      f.wallet.confirmEvmSignedReplay(prepared.review.id)
    ).rejects.toThrow();
    expect(f.broadcasts).toEqual([]);
    expect(
      (await f.records.readExact(f.session, '1', payer.address, f.hash))
        ?.rawTransaction
    ).toBe(f.rawTransaction);
  }
);

it('uses ordinary payer history when that EOA is selected', async () => {
  const f = await fixture();
  mockState.vault.activeAccount = { id: 0, type: 'HDAccount' };
  const saved = await f.wallet.getSavedEvmTransaction(f.hash);
  expect(saved.from.toLowerCase()).toBe(payer.address.toLowerCase());
  expect(saved).not.toHaveProperty('smartAccount');
});

it('also tracks the affected Smart account when its recorded EOA payer is selected', async () => {
  const f = await fixture();
  mockState.vault.activeAccount = { id: 0, type: 'HDAccount' };
  const prepared = await f.wallet.prepareEvmSignedReplay(f.hash);
  await f.wallet.confirmEvmSignedReplay(prepared.review.id);
  expect(
    mockState.vault.accountTransactions.HDAccount[0].ethereum[1][0].hash
  ).toBe(f.hash);
  expect(f.wallet.startRapidTransactionPolling).toHaveBeenCalledWith(
    f.hash,
    1,
    false,
    { id: 1, type: 'SmartAccount' }
  );
});

it('does not duplicate pending notifications when replayed bytes already have public tracking', async () => {
  const f = await fixture();
  jest.mocked(notificationManager.notifyTransaction).mockClear();
  const first = await f.wallet.prepareEvmSignedReplay(f.hash);
  await f.wallet.confirmEvmSignedReplay(first.review.id);
  const second = await f.wallet.prepareEvmSignedReplay(f.hash);
  await f.wallet.confirmEvmSignedReplay(second.review.id);
  expect(notificationManager.notifyTransaction).toHaveBeenCalledTimes(1);
  expect(
    mockState.vault.accountTransactions.SmartAccount[1].ethereum[1]
  ).toHaveLength(1);
  expect(f.wallet.startRapidTransactionPolling).toHaveBeenCalledTimes(2);
});

it('opens an earlier EOA payer transaction only through its current Smart parent review', async () => {
  const f = await fixture(1);
  const predecessor = Transaction.from(f.predecessor!);
  expect(await f.wallet.getSavedEvmTransaction(predecessor.hash)).toBeNull();
  const parent = await f.wallet.prepareEvmSignedReplay(f.hash);
  expect(parent.status).toBe('review');
  const page = await f.wallet.getSmartAccountPredecessors(parent.review.id);
  expect(page.transactions.map((entry: any) => entry.hash)).toContain(
    predecessor.hash
  );
  const prior = await f.wallet.prepareSmartAccountPredecessor(
    parent.review.id,
    predecessor.hash
  );
  expect(prior.status).toBe('review');
  expect(prior.review).not.toHaveProperty('smartAccount');
  expect(prior.review.to.toLowerCase()).toBe(recipient);
  expect(prior.review.value).toBe('1');
  await expect(
    f.wallet.confirmEvmSignedReplay(prior.review.id)
  ).resolves.toMatchObject({ status: 'submitted', hash: predecessor.hash });
  expect(f.broadcasts).toEqual([f.predecessor]);
});

it('cancels Smart replay without broadcasting or changing saved bytes', async () => {
  const f = await fixture();
  const prepared = await f.wallet.prepareEvmSignedReplay(f.hash);
  f.wallet.cancelEvmSignedReplay(prepared.review.id);
  expect(() => f.wallet.confirmEvmSignedReplay(prepared.review.id)).toThrow();
  expect(f.broadcasts).toEqual([]);
});

it('checks later pending Smart rows while earlier rows cool down, without exceeding five reads', async () => {
  const f = await fixture();
  let now = 100_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  const hashes = Array.from(
    { length: 6 },
    (_, index) => '0x' + (index + 1).toString(16).padStart(64, '0')
  );
  mockState.vault.accountTransactions.SmartAccount[1] = {
    ethereum: {
      1: hashes.map((hash) => ({ hash, smartAccountExecutionFrom: smart })),
    },
  };
  f.wallet.getEvmTransactionFromProvider = jest.fn(async () => null);
  const refresh = () =>
    f.wallet.reconcileLocalPendingEvmSmartAccountTransactions(
      { id: 1, type: 'SmartAccount' },
      1
    );
  await refresh();
  expect(
    f.wallet.getEvmTransactionFromProvider.mock.calls.map(([hash]) => hash)
  ).toEqual(hashes.slice(0, 5));
  now += 1_000;
  await refresh();
  expect(
    f.wallet.getEvmTransactionFromProvider.mock.calls.map(([hash]) => hash)
  ).toEqual(hashes);
  await refresh();
  expect(f.wallet.getEvmTransactionFromProvider).toHaveBeenCalledTimes(6);
  now += 30_000;
  await refresh();
  expect(
    f.wallet.getEvmTransactionFromProvider.mock.calls
      .slice(6)
      .map(([hash]) => hash)
  ).toEqual(hashes.slice(0, 5));
  const beforeForced = f.wallet.getEvmTransactionFromProvider.mock.calls.length;
  await f.wallet.reconcileLocalPendingEvmSmartAccountTransactions(
    { id: 1, type: 'SmartAccount' },
    1,
    true
  );
  expect(
    f.wallet.getEvmTransactionFromProvider.mock.calls.length - beforeForced
  ).toBe(5);
  await refresh();
  expect(f.wallet.getEvmTransactionFromProvider).toHaveBeenCalledTimes(
    beforeForced + 5
  );
});
