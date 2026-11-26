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
import { EVM_ACTIVITY_CURSOR_STALE } from '../../../shared/evmHistory';
import { EvmSignedRecords } from '../../../wallet/evmSignedRecords';
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
import { getSmartAccountUserOpHash } from 'utils/smartAccount/userOperationHash';

import { ReceiptBalanceRefresh } from './balances/ReceiptBalanceRefresh';
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
    signal: new AbortController().signal,
    verifyConfiguredChainId: jest.fn(async () => undefined),
    _getConnection: () => ({ url: 'https://rpc.synthetic.invalid' }),
    readMany: jest.fn(async (requests) =>
      Promise.allSettled(
        requests.map(({ method, params }) => provider.send(method, params))
      )
    ),
    send: jest.fn(async (method: string, params: unknown[]) => {
      if (method === 'eth_chainId') return '0x1';
      if (method === 'eth_getTransactionCount') return '0x0';
      if (method === 'eth_getTransactionReceipt') return null;
      if (method === 'eth_getBlockByNumber')
        return { number: '0x10', hash: blockHash, gasLimit: '0x100000' };
      if (method === 'eth_simulateV1') {
        const transactions = (params[0] as any).blockStateCalls[0].calls;
        return [
          {
            number: '0x11',
            parentHash: blockHash,
            transactions: transactions.map((tx: any) => ({
              ...tx,
              input: tx.data,
            })),
            calls: transactions.map((tx: any) => {
              if (
                tx.to.toLowerCase() !==
                getPaliEntryPointAddress(1).toLowerCase()
              )
                return { status: '0x1', gasUsed: '0x5208', logs: [] };
              const [operations] = paliEntryPointInterface.decodeFunctionData(
                'handleOps',
                tx.data
              );
              return {
                status: '0x1',
                gasUsed: '0x186a0',
                logs: operations.map((op: any) => ({
                  address: tx.to,
                  ...paliEntryPointInterface.encodeEventLog(
                    paliEntryPointInterface.getEvent('UserOperationEvent')!,
                    [
                      getSmartAccountUserOpHash(op, 1),
                      op.sender,
                      '0x' + '00'.repeat(20),
                      op.nonce,
                      true,
                      1,
                      1,
                    ]
                  ),
                })),
              };
            }),
          },
        ];
      }
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
    operation,
  };
}

it('identifies missing transaction and authorization page anchors without classifying journal reads as corrupt', async () => {
  const f = await fixture();
  const options = { beforeHash: blockHash, maximum: 20 };
  await expect(
    f.records.readPage(f.session, '1', payer.address, options)
  ).rejects.toThrow(EVM_ACTIVITY_CURSOR_STALE);
  await expect(
    f.records.readSmartAccountReplayPage(f.session, '1', smart, options)
  ).rejects.toThrow(EVM_ACTIVITY_CURSOR_STALE);
  await expect(
    f.records.listSmartAccountAuthorizations(f.session, '1', smart, options)
  ).rejects.toThrow(EVM_ACTIVITY_CURSOR_STALE);
});

it('only offers cancellation while the authenticated inner nonce is current and unrevoked', async () => {
  const f = await fixture();
  const scope = { account: '1', network: mockState.vault.activeNetwork.url };
  const canCancel = () =>
    f.wallet.canCancelSavedSmartAccountTransaction(f.hash, scope);
  let liveNonce = 7;
  const send = f.provider.send.getMockImplementation()!;
  f.provider.send.mockImplementation(async (method, params) => {
    if (method !== 'eth_call') return send(method, params);
    const [address, key] = paliEntryPointInterface.decodeFunctionData(
      'getNonce',
      (params[0] as { data: string }).data
    );
    expect(address.toLowerCase()).toBe(smart);
    expect(key).toBe(BigInt(0));
    expect(params[1]).toBe('latest');
    return '0x' + liveNonce.toString(16).padStart(64, '0');
  });
  await expect(canCancel()).resolves.toBe(true);
  liveNonce = 8;
  await expect(canCancel()).resolves.toBe(false);
  liveNonce = 6;
  await expect(canCancel()).resolves.toBe(false);
  liveNonce = 7;
  const revocation = encodeERC7579Executions([{ target: smart, value: '0' }]);
  const originalOperationHash = getSmartAccountUserOpHash(
    f.operation as any,
    1
  );
  const userOperation = {
    ...f.operation,
    callData: paliSmartAccountInterface.encodeFunctionData('execute', [
      revocation.mode,
      revocation.executionCalldata,
    ]),
    nonce: '7',
    preVerificationGas: String(f.operation.preVerificationGas),
  };
  const { operationHash } = await f.records.retainSmartAccountAuthorization(
    f.session,
    {
      chainId: 1,
      payer: payer.address,
      observedAt: { number: '16', hash: blockHash },
      replacesOperationHash: originalOperationHash,
      userOperation,
    }
  );
  await expect(canCancel()).resolves.toBe(false);

  const entryPoint = getPaliEntryPointAddress(1);
  const rawTransaction = await payer.signTransaction({
    chainId: 1,
    nonce: 1,
    type: 0,
    gasPrice: 2,
    gasLimit: 300000,
    to: entryPoint,
    data: paliEntryPointInterface.encodeFunctionData('handleOps', [
      [userOperation],
      payer.address,
    ]),
  });
  const hash = Transaction.from(rawTransaction).hash!;
  await f.records.append(
    f.session,
    {
      rawTransaction,
      hash,
      from: payer.address,
      chainId: '1',
      nonce: 1,
      type: 0,
      context: {
        account: { id: 0, type: 'HDAccount', address: payer.address },
        network: mockState.vault.activeNetwork,
        operation: 'send',
      },
    },
    {
      smartAccountExecution: true,
      smartAccountExecutionFrom: smart,
      smartAccountOperationCancellation: {
        account: smart,
        chainId: '1',
        originalHash: f.hash,
        originalKind: 'transaction',
        originalOperationHash,
        operationHash,
        operationNonce: '7',
      },
    }
  );
  const canRetry = () =>
    f.wallet.canCancelSavedSmartAccountTransaction(hash, scope, true);
  expect((await f.wallet.getSavedEvmTransactions()).transactions).toMatchObject(
    [
      {
        hash,
        smartAccount: {
          cancellationRetry: {
            originalHash: f.hash,
            operationHash: originalOperationHash,
          },
        },
      },
    ]
  );
  await expect(canRetry()).resolves.toBe(false);
  const withNonce = f.provider.send.getMockImplementation()!;
  f.provider.send.mockImplementation((method, params) =>
    method === 'eth_getTransactionReceipt'
      ? (Promise.resolve({
          transactionHash: hash,
          from: payer.address,
          to: entryPoint,
          blockNumber: '0x10',
          blockHash,
          status: '0x0',
        }) as any)
      : withNonce(method, params)
  );
  await expect(canRetry()).resolves.toBe(true);
  await expect(canCancel()).resolves.toBe(false);
  liveNonce = 8;
  await expect(canRetry()).resolves.toBe(false);
  liveNonce = 6;
  await expect(canRetry()).resolves.toBe(false);
  expect(f.broadcasts).toEqual([]);
});

it('projects only the unresolved Smart Account authorization without an outer transaction', async () => {
  const f = await fixture();
  const retain = (nonce: number) =>
    f.records.retainSmartAccountAuthorization(f.session, {
      chainId: 1,
      payer: payer.address,
      observedAt: { number: '16', hash: blockHash },
      userOperation: {
        ...f.operation,
        nonce: String(nonce),
        preVerificationGas: String(f.operation.preVerificationGas),
      },
    });
  await retain(7); // The existing signed outer already contains this operation.
  const pending = await retain(9);
  const consumed = await retain(8);
  const revocation = encodeERC7579Executions([{ target: smart, value: '0' }]);
  await f.records.retainSmartAccountAuthorization(f.session, {
    chainId: 1,
    payer: payer.address,
    observedAt: { number: '16', hash: blockHash },
    replacesOperationHash: pending.operationHash,
    userOperation: {
      ...f.operation,
      callData: paliSmartAccountInterface.encodeFunctionData('execute', [
        revocation.mode,
        revocation.executionCalldata,
      ]),
      nonce: '9',
      preVerificationGas: String(f.operation.preVerificationGas),
    },
  });
  let chainNonce = 9;
  const send = f.provider.send.getMockImplementation()!;
  f.provider.send.mockImplementation(async (method, params) => {
    if (method === 'eth_call') {
      expect(params[1]).toBe('latest');
      return '0x' + chainNonce.toString(16).padStart(64, '0');
    }
    return send(method, params);
  });

  const page = await f.wallet.getSavedEvmTransactions();
  expect(page.transactions.map((tx: { hash: string }) => tx.hash)).toEqual([
    f.hash,
  ]);
  expect(page.signedOperations).toEqual([
    {
      account: smart,
      chainId: '1',
      createdAt: 1000,
      operationHash: pending.operationHash,
      status: 'unresolved',
    },
  ]);
  expect(page.signedOperations[0]).not.toHaveProperty('hash');
  expect(pending.operationHash).not.toBe(consumed.operationHash);
  const nonceReads = () =>
    f.provider.send.mock.calls.filter(([method]) => method === 'eth_call');
  expect(nonceReads()).toHaveLength(1);
  expect(f.broadcasts).toEqual([]);

  chainNonce = 10;
  await expect(f.wallet.getSavedEvmTransactions()).resolves.not.toHaveProperty(
    'signedOperations'
  );
  expect(nonceReads()).toHaveLength(2);

  mockState.vault.accounts.SmartAccount[1].evmActivityClearedAtByChainId = {
    1: 1000,
  };
  await expect(f.wallet.getSavedEvmTransactions()).resolves.toEqual({
    transactions: [],
    nextCursor: null,
  });
  expect(nonceReads()).toHaveLength(2);
});

it('shows an older unresolved operation behind a full page of consumed authorizations', async () => {
  const f = await fixture();
  const retain = (nonce: bigint) =>
    f.records.retainSmartAccountAuthorization(f.session, {
      chainId: 1,
      payer: payer.address,
      observedAt: { number: '16', hash: blockHash },
      userOperation: {
        ...f.operation,
        nonce: nonce.toString(),
        preVerificationGas: String(f.operation.preVerificationGas),
      },
    });
  const olderNonce = (BigInt(1) << BigInt(64)) + BigInt(9);
  const older = await retain(olderNonce);
  for (let sequence = 10; sequence < 45; sequence++)
    await retain(BigInt(sequence));
  const send = f.provider.send.getMockImplementation()!;
  f.provider.send.mockImplementation(async (method, params) => {
    if (method !== 'eth_call') return send(method, params);
    const [, key] = paliEntryPointInterface.decodeFunctionData(
      'getNonce',
      (params[0] as { data: string }).data
    );
    const nonce = BigInt(key) === BigInt(1) ? olderNonce : BigInt(45);
    return '0x' + nonce.toString(16).padStart(64, '0');
  });

  const page = await f.wallet.getSavedEvmTransactions();
  expect(page.signedOperations).toEqual([
    expect.objectContaining({
      operationHash: older.operationHash,
      status: 'unresolved',
    }),
  ]);
  expect(
    f.provider.send.mock.calls.filter(([method]) => method === 'eth_call')
  ).toHaveLength(2);
});

it('keeps payer records while honoring the selected Smart Account activity reset', async () => {
  const f = await fixture();
  const { activeAccount, accounts } = mockState.vault;
  const account = accounts[activeAccount.type][activeAccount.id];
  const retained = await f.records.readExact(
    f.session,
    '1',
    payer.address,
    f.hash
  );
  expect(retained).not.toBeNull();
  account.evmActivityClearedAtByChainId = { 1: retained!.createdAt - 1 };
  const scope = {
    account: String(activeAccount.id),
    network: mockState.vault.activeNetwork.url,
  };
  await expect(
    f.wallet.getSavedEvmTransactions(null, 30, {
      ...scope,
      account: 'another-account',
    })
  ).rejects.toThrow();
  await expect(
    f.wallet.getSavedEvmTransaction(f.hash, {
      ...scope,
      network: 'another-endpoint',
    })
  ).rejects.toThrow();
  expect(
    (await f.wallet.getSavedEvmTransactions(null, 30, scope)).transactions
  ).toHaveLength(1);
  expect(await f.wallet.getSavedEvmTransaction(f.hash)).toMatchObject({
    hash: f.hash,
  });
  account.evmActivityClearedAtByChainId[1] = retained!.createdAt;
  expect(await f.wallet.getSavedEvmTransaction(f.hash)).toBeNull();
  expect(await f.wallet.getSavedEvmTransactions()).toEqual({
    transactions: [],
    nextCursor: null,
  });
  expect(
    await f.records.readExact(f.session, '1', payer.address, f.hash)
  ).toEqual(retained);
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
    getBlock: async () => ({ number: 12, hash: blockHash, timestamp: 1000 }),
  });
  return receipt;
}

it('adds an exact mined retained outer only after every selected Smart operation is verified', async () => {
  const f = await fixture(0, 2);
  const scope = { account: '1', network: mockState.vault.activeNetwork.url };
  const observe = () =>
    f.wallet.observeSavedSmartAccountActivity(f.hash, scope);
  await expect(observe()).resolves.toBeUndefined(); // Signed, no mined receipt.
  const activity = () =>
    mockState.vault.accountTransactions.SmartAccount[1]?.ethereum?.[1];
  expect(activity()).toBeUndefined();
  await settleReplay(f, 'confirmed', 'missing');
  await expect(observe()).rejects.toThrow('Smart account outcome unavailable');
  expect(activity()).toBeUndefined();
  await settleReplay(f, 'confirmed', 'reverted');
  await expect(observe()).resolves.toBeUndefined();
  expect(activity()).toEqual([
    expect.objectContaining({
      hash: f.hash,
      blockHash,
      blockNumber: 12,
      status: 'failed',
      smartAccountExecutionFrom: smart,
      smartAccountOutcome: {
        blockHash,
        blockNumber: 12,
        smartAccount: smart,
        success: false,
      },
    }),
  ]);
  expect(mockState.vault.accountTransactions.HDAccount).toEqual({});
  expect(f.broadcasts).toEqual([]);
});

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

it('settles the local Smart Account Activity row and balance when explorer history rejects', async () => {
  const f = await fixture();
  const { vault } = mockState;
  vault.activeNetwork.apiUrl = 'https://explorer.invalid';
  vault.accounts.SmartAccount[1].balances = { ethereum: '0.07429548' };
  vault.accountAssets = {};
  await saveNativeRecipientCopies(f, 'HDAccount');
  await settleReplay(f, 'confirmed');

  const historyError = new Error('Explorer unavailable');
  const receiptProvider = {
    send: async (method: string) => {
      expect(method).toBe('eth_blockNumber');
      return '0xc';
    },
    getBalance: jest.fn(async () => BigInt('15226800000000000')),
  };
  const receiptBalanceRefresh = new ReceiptBalanceRefresh();
  delete f.wallet.refreshBalancesAfterReceipt;
  Object.assign(f.wallet, {
    transactionUpdateRequestId: 0,
    transactionUpdateCommitId: 0,
    cancellablePromises: new CancellablePromises(),
    transactionsManager: {
      utils: {
        updateTransactionsFromCurrentAccount: jest.fn(async () => {
          throw historyError;
        }),
      },
    },
    receiptBalanceRefresh,
    targetedBalanceVersions: new Map(),
    targetedBalanceEvictions: 0,
    withReceiptReadProvider: async (
      _signal: AbortSignal,
      _network: unknown,
      read: (provider: typeof receiptProvider) => Promise<void>
    ) => read(receiptProvider),
  });
  const senderRow = () =>
    mockState.vault.accountTransactions.SmartAccount[1].ethereum[1][0];
  expect(senderRow().blockNumber).toBeFalsy();

  jest.useFakeTimers();
  try {
    await expect(
      f.wallet.updateUserTransactionsState({
        isBitcoinBased: false,
        activeNetwork: mockState.vault.activeNetwork,
        isPolling: true,
      })
    ).rejects.toBe(historyError);
    expect(senderRow()).toMatchObject({
      blockNumber: 12,
      blockHash,
      status: 'success',
      success: true,
    });
    await jest.advanceTimersByTimeAsync(100);
    expect(receiptProvider.getBalance).toHaveBeenCalledWith(smart, 12);
    expect(mockState.vault.accounts.SmartAccount[1].balances.ethereum).toBe(
      '0.0152268'
    );
    expect(f.broadcasts).toEqual([]);
  } finally {
    receiptBalanceRefresh.cancel();
    jest.useRealTimers();
  }
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

it('settles a late mined Smart Account send on the fourth rapid check after a transient failure', async () => {
  const f = await fixture();
  await saveNativeRecipientCopies(f, 'HDAccount');
  await settleReplay(f, 'confirmed');
  const account = { id: 1, type: 'SmartAccount' };
  const savedRow = () =>
    mockState.vault.accountTransactions.SmartAccount[1].ethereum[1][0];
  const lookup = jest
    .spyOn(f.wallet, 'getEvmTransactionFromProvider')
    .mockRejectedValueOnce(new Error('Transient RPC error'))
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.useFakeTimers();
  try {
    f.wallet.activeRapidPolls = new Map();
    MainController.prototype['startRapidTransactionPolling'].call(
      f.wallet,
      f.hash,
      1,
      false,
      account
    );
    for (const [index, delay] of [4000, 4000, 12000, 28000].entries()) {
      await jest.advanceTimersByTimeAsync(delay - 1);
      expect(lookup).toHaveBeenCalledTimes(index);
      expect(savedRow().blockNumber).toBeFalsy();
      expect(f.wallet.refreshBalancesAfterReceipt).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      expect(lookup).toHaveBeenCalledTimes(index + 1);
    }

    expect(mockState.vault.activeAccount).toEqual(account);
    expect(savedRow()).toMatchObject({
      blockNumber: 12,
      blockHash,
      status: 'success',
      success: true,
    });
    expect(f.wallet.refreshBalancesAfterReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        hash: f.hash,
        blockNumber: 12,
        smartAccountExecutionFrom: smart,
      })
    );
    expect(f.wallet.activeRapidPolls.size).toBe(0);
    await jest.advanceTimersByTimeAsync(60000);
    expect(lookup).toHaveBeenCalledTimes(4);
  } finally {
    jest.useRealTimers();
  }
});

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
  expect(f.provider.readMany).not.toHaveBeenCalled();
});

it('uses ordinary payer history when that EOA is selected', async () => {
  const f = await fixture();
  mockState.vault.activeAccount = { id: 0, type: 'HDAccount' };
  const saved = await f.wallet.getSavedEvmTransaction(f.hash);
  expect(saved.from.toLowerCase()).toBe(payer.address.toLowerCase());
  expect(saved).not.toHaveProperty('smartAccount');
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
