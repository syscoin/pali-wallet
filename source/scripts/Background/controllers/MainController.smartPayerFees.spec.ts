/** @jest-environment node */
jest.mock('..', () => ({ getController: jest.fn(), notificationManager: {} }));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('@sidhujag/sysweb3-keyring/cjs/evm-fees.js', () => ({
  ...jest.requireActual('@sidhujag/sysweb3-keyring/cjs/evm-fees.js'),
  getEvmFeeData: async (provider) => {
    const { baseFeePerGas } = await provider.getBlock();
    return {
      gasPrice: BigInt(3),
      maxFeePerGas: mockSettingsFeePerGas,
      maxPriorityFeePerGas: mockSettingsPriorityFee,
      ...(baseFeePerGas === null ? {} : { baseFeePerGas }),
    };
  },
}));
jest.mock('utils/evmCallBlacklist', () => ({
  getBlacklistTargetsForEvmCallWithContractType: jest.fn(async () => []),
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => ({
    account: String(mockState.vault.activeAccount.id),
    network: mockState.vault.activeNetwork.url,
  }),
  clearTransactionNavigationState: jest.fn(async () => undefined),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockState,
    dispatch: jest.fn(),
    subscribe: jest.fn(),
  },
}));

import { SoftwareKeyring } from '@sidhujag/sysweb3-keyring/cjs/software.js';
import { serializePreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import {
  captureEvmSubmission,
  submitSignedEvmTransaction,
} from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-submission.js';
import { webcrypto } from 'crypto';
import { Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';
import { smartAccountAddressFixture } from 'tests/fixtures/smartAccountAddress';

import { getController } from '..';
import {
  createOwnedEvmFeeFunding,
  NATIVE_EVM_FEE_FUNDING,
} from '../../../shared/evmFeeApproval';
import { getSmartAccountUserOpHash } from '../../../utils/smartAccount/userOperationHash';
import { EvmSignedRecords } from '../../../wallet/evmSignedRecords';
import { decodeRetainedSmartAccountOperations } from '../../../wallet/smartAccountActivity';
import {
  inspectSmartAccountCancellationPayer,
  smartAccountCancellationMetadata,
  type SmartAccountCancellation,
} from '../../../wallet/smartAccountCancellation';
import { projectSmartAccountSavedTransaction } from '../../../wallet/smartAccountSignedReplay';
import { KeyringAccountType } from 'types/network';
import { EVM_TRANSACTION_CONTEXT_CHANGED } from 'utils/evmTransactionContext';
import {
  buildSmartAccountUserOperation,
  encodeERC7579Executions,
  encodeSmartAccountGasFees,
  encodeSmartAccountGasLimits,
  encodeSmartAccountValidatorNonceKey,
} from 'utils/smartAccount/account';
import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
  paliSmartAccountInterface,
} from 'utils/smartAccount/contracts';
import { ExecutionSimulationEvidenceError } from 'utils/smartAccount/executionSimulationError';
import {
  createSmartAccountGasTankFunding,
  ensureSmartAccountDeploymentPrefund,
} from 'utils/smartAccount/payerPolicy';
import { createSmartAccountPendingState } from 'utils/smartAccount/pendingState';
import { submitSmartAccountOperation } from 'utils/smartAccount/submitOperation';

import MainController from './MainController';
import { readSettingsEvmFeeNonce } from './nativeEvmFeeReviews';
import type { SmartAccountControllerFeeReview } from '../../../shared/smartAccountControllerAuthority';

const signer = new Wallet('0x' + '1'.padStart(64, '0'));
const deployment = smartAccountAddressFixture(57, signer.address);
const smart = deployment.account.address;
const profileId = '0x' + '99'.repeat(32);
const receiver = '0x' + '33'.repeat(20);
const block = {
  number: '0x10',
  hash: '0x' + '44'.repeat(32),
  gasLimit: '0x1c9c380',
  baseFeePerGas: '0x1',
};
let mockState: any;
let mockSettingsFeePerGas = BigInt(3);
let mockSettingsPriorityFee = BigInt(1);

function fixture(chainId = 57) {
  block.baseFeePerGas = '0x1';
  mockSettingsFeePerGas = BigInt(3);
  mockSettingsPriorityFee = BigInt(1);
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
  mockState = {
    vault: {
      isBitcoinBased: false,
      activeAccount: { id: 2, type: KeyringAccountType.SmartAccount },
      activeNetwork: {
        chainId,
        kind: 'ethereum',
        url: 'https://rpc.invalid',
        slip44: 60,
      },
      accounts: {
        SmartAccount: {
          2: {
            address: smart,
            isSmartAccount: true,
            balance: '1000000000000000000',
          },
        },
        HDAccount: { 0: { address: signer.address } },
      },
    },
    vaultGlobal: { activeSlip44: 60 },
  };
  let balance = BigInt(1_000_000);
  let onSigned: () => void = () => undefined;
  let onPersisted: () => void = () => undefined;
  const provider = {
    signal: new AbortController().signal,
    call: async (request: any): Promise<any> =>
      provider.send('eth_call', [request, 'pending']),
    verifyConfiguredChainId: jest.fn(async () => undefined),
    send: jest.fn(
      async (method: string, params: readonly unknown[] = []): Promise<any> => {
        if (!Array.isArray(params)) throw new Error('Invalid RPC parameters');
        if (method === 'eth_getBlockByNumber') return block;
        if (method === 'eth_getTransactionCount') return '0x0';
        if (method === 'eth_getBalance') return '0x' + balance.toString(16);
        if (method === 'eth_estimateGas') return '0x5208';
        throw new Error(`Unexpected RPC: ${method}`);
      }
    ),
  };
  const snapshot = {
    owner: profileId,
    minimumNonce: 0,
    retained: [],
    readMaximumCost: async () => BigInt(0),
    readAssetDebit: async () => BigInt(0),
    readSmartAccountOperations: jest.fn(async () => []),
  };
  const records: any = {
    captureSession: (session: any) => session,
    captureAutoNonceSnapshot: jest.fn(async (session: any) => {
      session.assertCurrent();
      return snapshot;
    }),
    append: jest.fn(async (session: any) => {
      session.assertCurrent();
      onPersisted();
    }),
    withReplayAdmission: jest.fn(
      async (_session, _identity, admit, _previous, preflight) => {
        await preflight.run(profileId, () => snapshot);
        return admit();
      }
    ),
    autoNonceAcceptance: { track: () => () => undefined },
  };
  const wallet: any = Object.create(MainController.prototype);
  wallet.walletSessionGeneration = 1;
  wallet.networkRequestGeneration = 1;
  wallet.assertWalletReadyForSigning = jest.fn();
  wallet.assertCurrentWalletSession = jest.fn((generation: number) => {
    if (generation !== wallet.walletSessionGeneration)
      throw new Error('session changed');
  });
  wallet.getWalletSetupStatus = () => undefined;
  wallet.getRetainedEvmRecords = () => records;
  wallet.captureFreshEvmRead = () => {
    const network = mockState.vault.activeNetwork;
    return {
      keyring,
      network,
      overrides: {},
      assertCurrent: () => {
        if (mockState.vault.activeNetwork.url !== network.url)
          throw new Error('network changed');
      },
      run: (run: any) => run(provider),
    };
  };
  wallet.inspectOrdinaryEvmNonce = jest.fn(async (_read, from, options) => {
    options.assertCurrent?.();
    expect(from).toBe(signer.address);
    return {
      nonce: 0,
      state: 'pending',
      balanceState: 'pending',
      nativeReservations: { canonical: BigInt(0), pending: BigInt(0) },
      canonicalBlock: block,
    };
  });
  wallet.sendAndSaveTransaction = jest.fn(async () => undefined);
  const broadcast = jest.fn(async () => undefined);
  const send = jest.fn(async (transaction: any, _legacy, options: any) => {
    options.assertCurrent();
    expect(options.mode).toBe('reviewed-generic');
    expect(options.selectedAccount).toMatchObject({
      id: 2,
      type: 'SmartAccount',
      expectedAddress: smart,
    });
    expect(options.targetAccount).toMatchObject({
      id: 0,
      type: 'HDAccount',
      expectedAddress: signer.address,
    });
    const unsigned = Transaction.from(
      serializePreparedEvmTransaction(transaction)
    );
    const context = {
      account: { id: 0, type: 'HDAccount', address: signer.address },
      network: {
        kind: 'ethereum',
        chainId,
        url: 'https://rpc.invalid',
        slip44: 60,
      },
      operation: 'send' as const,
      walletNonce: options.walletNonce,
      review: { id: options.reviewId, unsignedHash: unsigned.unsignedHash },
    };
    const boundary = captureEvmSubmission(context, options.assertCurrent, () =>
      wallet.captureEvmSignedSubmission(keyring, context)
    );
    const rawTransaction = await signer.signTransaction(unsigned);
    onSigned();
    const tx = Transaction.from(rawTransaction);
    return submitSignedEvmTransaction(
      rawTransaction,
      async ({ admit }) =>
        admit(async () => {
          await broadcast();
          return { hash: tx.hash!, nonce: tx.nonce };
        }),
      boundary,
      undefined,
      unsigned.unsignedSerialized
    );
  });
  const keyring = {
    ethereumTransaction: {
      web3Provider: provider,
      sendFormattedTransaction: send,
    },
  };
  wallet.getActiveKeyring = () => keyring;
  jest.mocked(getController).mockReturnValue({
    wallet: { ethereumTransaction: keyring.ethereumTransaction },
  } as any);
  const request = {
    chainId,
    from: signer.address,
    to: receiver,
    data: '0x1234',
    value: '0',
    gasLimit: '21000',
    maxFeePerGas: '3',
    maxPriorityFeePerGas: '1',
  };
  const options = {
    assertBeforeSign: () => undefined,
    assertCurrentContext: () => undefined,
    assertPendingState: jest.fn(async (...args: unknown[]) => {
      void args;
    }),
    assertAssetState: jest.fn(async () => undefined),
    feeFunding: NATIVE_EVM_FEE_FUNDING,
    clearNavigation: false,
    confirmFee: jest.fn(
      async (quote: SmartAccountControllerFeeReview): Promise<string | null> =>
        quote.id
    ),
  };
  return {
    wallet,
    send,
    records,
    provider,
    broadcast,
    request,
    options,
    snapshot,
    setBalance(value: bigint) {
      balance = value;
    },
    onSigned(callback: () => void) {
      onSigned = callback;
    },
    onPersisted(callback: () => void) {
      onPersisted = callback;
    },
    submit(
      funding = NATIVE_EVM_FEE_FUNDING,
      input = request,
      metadata = { smartAccountExecution: true }
    ) {
      return wallet.sendAndSaveEthTransaction(
        input,
        false,
        { id: 0, type: KeyringAccountType.HDAccount },
        metadata,
        { ...options, feeFunding: funding }
      );
    },
  };
}

afterEach(() => jest.restoreAllMocks());

function attachSignedRecords(f: ReturnType<typeof fixture>) {
  const cryptoKeyring: any = Object.create(SoftwareKeyring.prototype);
  cryptoKeyring.sessionPassword = { isCleared: () => false };
  cryptoKeyring.sessionMnemonic = { isCleared: () => false };
  cryptoKeyring.privateRecordSessionRevision = 0;
  cryptoKeyring.getDecryptedMnemonic = () =>
    'synthetic cancellation journal root';
  const keyring = f.wallet.getActiveKeyring();
  for (const name of [
    'getPrivateRecordProfileId',
    'encryptPrivateRecord',
    'decryptPrivateRecord',
  ])
    keyring[name] = cryptoKeyring[name].bind(cryptoKeyring);
  let stored: string | undefined;
  const records = new EvmSignedRecords({
    read: async () => stored,
    compareAndSet: async (_profile, expected, next, check) => {
      check();
      if (stored !== expected) return false;
      stored = next;
      return true;
    },
  });
  f.wallet.getRetainedEvmRecords = () => records;
  f.wallet.inspectOrdinaryEvmNonce = (
    MainController.prototype as any
  ).inspectOrdinaryEvmNonce.bind(f.wallet);
  const session = { keyring, assertCurrent: () => undefined };
  return { records, session };
}

async function cancellationFixture(useSpeedUpTip = false) {
  const f = fixture();
  const { records, session } = attachSignedRecords(f);
  const validator = deployment.account.smartAccount.auth!.validator;
  const nonce = (
    BigInt(encodeSmartAccountValidatorNonceKey(validator)) << BigInt(64)
  ).toString();
  const originalOperation = buildSmartAccountUserOperation({
    sender: smart,
    nonce,
    callData: '0x1234',
    signature: '0x1234',
  });
  const originalData = paliEntryPointInterface.encodeFunctionData('handleOps', [
    [originalOperation],
    signer.address,
  ]);
  const rawTransaction = await signer.signTransaction({
    type: 2,
    chainId: 57,
    nonce: 0,
    to: getPaliEntryPointAddress(57),
    value: 0,
    data: originalData,
    gasLimit: 21000,
    maxFeePerGas: 3,
    maxPriorityFeePerGas: 1,
  });
  const context = {
    account: { id: 0, type: 'HDAccount' as const, address: signer.address },
    network: {
      kind: 'ethereum' as const,
      chainId: 57,
      slip44: 60,
      url: 'https://rpc.invalid',
    },
    operation: 'send' as const,
  };
  const initial = await records.append(session, {
    rawTransaction,
    hash: Transaction.from(rawTransaction).hash!,
    from: signer.address,
    chainId: '57',
    nonce: 0,
    type: 2,
    context,
  });
  let original = initial;
  if (useSpeedUpTip) {
    const binding = await records.captureVerifiedReplacement(session, {
      chainId: '57',
      from: signer.address,
      nonce: 0,
      originalHash: initial.hash,
      operation: 'speed-up',
    });
    const variant = Transaction.from(
      Transaction.from(rawTransaction).unsignedSerialized
    );
    variant.maxFeePerGas = BigInt(6);
    variant.maxPriorityFeePerGas = BigInt(2);
    const signed = await signer.signTransaction(variant);
    original = await records.append(
      session,
      {
        rawTransaction: signed,
        hash: Transaction.from(signed).hash!,
        from: signer.address,
        chainId: '57',
        nonce: 0,
        type: 2,
        context: {
          ...context,
          operation: 'speed-up',
          originalHash: initial.hash,
        },
      },
      undefined,
      binding
    );
  }
  mockState.vault.accounts.SmartAccount[2].smartAccount =
    deployment.account.smartAccount;
  f.wallet.smartAccount = {
    assertExpectedExecutionContext: jest.fn(),
    prepareSmartAccountCancellation: (cancellation: SmartAccountCancellation) =>
      cancellation,
  };
  const cancellation: SmartAccountCancellation =
    await f.wallet.prepareSmartAccountCancellation(
      { originalHash: original.hash },
      2,
      {
        expectedContext: {
          account: {
            address: smart,
            id: 2,
            type: KeyringAccountType.SmartAccount,
          },
          chainId: 57,
          rpcUrl: 'https://rpc.invalid',
          slip44: 60,
          sessionGeneration: 1,
        },
      }
    );
  const noop = encodeERC7579Executions([
    { target: smart, value: '0x0', data: '0x' },
  ]);
  const userOperation = {
    ...originalOperation,
    callData: paliSmartAccountInterface.encodeFunctionData('execute', [
      noop.mode,
      noop.executionCalldata,
    ]),
    signature: '0x5678',
  };
  const descriptor = { cancellation, replaceOuter: true, userOperation };
  Object.assign(f.options, { smartAccountCancellation: descriptor });
  const metadata = {
    smartAccountExecution: true,
    smartAccountOperationCancellation: smartAccountCancellationMetadata(
      cancellation,
      getSmartAccountUserOpHash(userOperation, 57)
    ),
  };
  const send = f.provider.send.getMockImplementation()!;
  let latest = 0;
  let originalReceipt: unknown = null;
  f.provider.send.mockImplementation(async (method, params) => {
    if (method === 'eth_chainId') return '0x39';
    if (method === 'eth_getTransactionCount') {
      const nonce = params?.[1] === 'pending' && !useSpeedUpTip ? 1 : latest;
      return `0x${nonce.toString(16)}`;
    }
    if (
      method === 'eth_getBalance' &&
      params?.[1] === 'pending' &&
      latest === 0
    )
      return '0x0';
    if (method === 'eth_getTransactionByHash') return null;
    if (method === 'eth_getTransactionReceipt')
      return params?.[0] === original.hash ? originalReceipt : null;
    return send(method, params);
  });
  const payer = await inspectSmartAccountCancellationPayer(
    cancellation,
    {
      send: f.provider.send,
      getFeeData: async () => ({
        maxFeePerGas: BigInt(3),
        maxPriorityFeePerGas: BigInt(1),
      }),
    },
    session.assertCurrent
  );
  if (!payer.replaceOuter) throw new Error('Expected the retained payer nonce');
  const request = {
    ...f.request,
    to: getPaliEntryPointAddress(57),
    data: paliEntryPointInterface.encodeFunctionData('handleOps', [
      [userOperation],
      signer.address,
    ]),
    ...payer.feeOverrides,
  };
  return {
    ...f,
    records,
    session,
    original,
    descriptor,
    setLatest(value: number) {
      latest = value;
    },
    confirmOriginal() {
      originalReceipt = {
        transactionHash: original.hash,
        from: signer.address,
        to: getPaliEntryPointAddress(57),
        status: '0x1',
        blockHash: block.hash,
        blockNumber: block.number,
      };
    },
    submit: () => f.submit(NATIVE_EVM_FEE_FUNDING, request, metadata),
  };
}

it.each([false, true])(
  'replaces the authenticated Smart outer nonce without its RPC body (Speed Up tip: %s)',
  async (useSpeedUpTip) => {
    const f = await cancellationFixture(useSpeedUpTip);
    const response = await f.submit();
    expect(f.broadcast).toHaveBeenCalledTimes(1);
    const raw = f.send.mock.calls[0][0];
    expect(raw.nonce).toBe('0');
    expect(raw.maxFeePerGas).toBe(useSpeedUpTip ? '7' : '4');
    expect(raw.maxPriorityFeePerGas).toBe(useSpeedUpTip ? '3' : '2');
    expect(f.provider.send).not.toHaveBeenCalledWith(
      'eth_getTransactionByHash',
      [f.original.hash]
    );
    const saved = await f.records.readExact(
      f.session,
      '57',
      signer.address,
      response.hash
    );
    expect(saved?.originalHash).toBe(f.original.hash);
    expect(saved?.metadata?.smartAccountOperationCancellation).toEqual(
      smartAccountCancellationMetadata(
        f.descriptor.cancellation,
        getSmartAccountUserOpHash(f.descriptor.userOperation, 57)
      )
    );
    const record = await f.records.readSmartAccountReplayExact(
      f.session,
      '57',
      smart,
      response.hash
    );
    expect(record).not.toBeNull();
    expect(
      projectSmartAccountSavedTransaction(record!, smart).smartAccount
    ).toMatchObject({
      cancellation: true,
      pendingCancellationOf:
        f.descriptor.cancellation.authorization.operationHash,
    });
  }
);

it.each(['consent', 'signing'] as const)(
  'refuses a consumed Smart outer nonce after %s',
  async (stage) => {
    const f = await cancellationFixture();
    if (stage === 'consent')
      f.options.confirmFee.mockImplementationOnce(async (quote) => {
        f.setLatest(1);
        return quote.id;
      });
    else f.onSigned(() => f.setLatest(1));
    await expect(f.submit()).rejects.toMatchObject({
      transactionNotBroadcast: true,
    });
    expect(f.broadcast).not.toHaveBeenCalled();
    expect(f.send).toHaveBeenCalledTimes(stage === 'consent' ? 0 : 1);
  }
);

it('refuses a Smart outer receipt after signing despite the old nonce report', async () => {
  const f = await cancellationFixture();
  f.onSigned(() => f.confirmOriginal());
  await expect(f.submit()).rejects.toMatchObject({
    transactionNotBroadcast: true,
  });
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(f.broadcast).not.toHaveBeenCalled();
});

it('retains other payer commitments when replacing a Smart outer transaction', async () => {
  const f = await cancellationFixture();
  const rawTransaction = await signer.signTransaction({
    type: 2,
    chainId: 57,
    nonce: 1,
    to: receiver,
    value: 0,
    gasLimit: 400000,
    maxFeePerGas: 3,
    maxPriorityFeePerGas: 1,
  });
  await f.records.append(f.session, {
    rawTransaction,
    hash: Transaction.from(rawTransaction).hash!,
    from: signer.address,
    chainId: '57',
    nonce: 1,
    type: 2,
    context: {
      account: { id: 0, type: 'HDAccount', address: signer.address },
      network: {
        kind: 'ethereum',
        chainId: 57,
        slip44: 60,
        url: 'https://rpc.invalid',
      },
      operation: 'send',
    },
  });
  await expect(f.submit()).rejects.toMatchObject({
    transactionNotBroadcast: true,
  });
  expect(f.send).not.toHaveBeenCalled();
  expect(f.broadcast).not.toHaveBeenCalled();
});

it('rejects a copied Smart cancellation descriptor before quoting or signing', async () => {
  const f = await cancellationFixture();
  Object.assign(f.options, {
    smartAccountCancellation: {
      ...f.descriptor,
      cancellation: { ...f.descriptor.cancellation },
    },
  });
  await expect(f.submit()).rejects.toMatchObject({
    transactionNotBroadcast: true,
  });
  expect(f.options.confirmFee).not.toHaveBeenCalled();
  expect(f.send).not.toHaveBeenCalled();
  expect(f.broadcast).not.toHaveBeenCalled();
});

it('uses ordinary nonce admission for fresh Smart cancellation delivery', async () => {
  const f = await cancellationFixture();
  f.descriptor.replaceOuter = false;
  f.setLatest(1);
  const response = await f.submit();
  expect(f.send.mock.calls[0][0].nonce).toBe('1');
  const saved = await f.records.readExact(
    f.session,
    '57',
    signer.address,
    response.hash
  );
  expect(saved?.originalHash).toBeUndefined();
  expect(saved?.metadata?.smartAccountOperationCancellation).toEqual(
    smartAccountCancellationMetadata(
      f.descriptor.cancellation,
      getSmartAccountUserOpHash(f.descriptor.userOperation, 57)
    )
  );
  expect(f.broadcast).toHaveBeenCalledTimes(1);
});

it('rechecks the original payer before using a fresh Smart cancellation nonce', async () => {
  const f = await cancellationFixture();
  f.descriptor.replaceOuter = false;
  f.setLatest(1);
  f.options.confirmFee.mockImplementationOnce(async (quote) => {
    f.setLatest(0);
    return quote.id;
  });
  await expect(f.submit()).rejects.toMatchObject({
    transactionNotBroadcast: true,
  });
  expect(f.send).not.toHaveBeenCalled();
  expect(f.broadcast).not.toHaveBeenCalled();
});

it('quotes only the exact payer envelope before consent and admits freshly afterward', async () => {
  const f = fixture();
  f.options.confirmFee.mockImplementationOnce(async (quote) => {
    expect(f.wallet.inspectOrdinaryEvmNonce).not.toHaveBeenCalled();
    expect(f.options.assertPendingState).not.toHaveBeenCalled();
    expect(f.options.assertAssetState).not.toHaveBeenCalled();
    expect(f.provider.send.mock.calls.map(([method]) => method)).toEqual([
      'eth_getBlockByNumber',
      'eth_getTransactionCount',
      'eth_estimateGas',
    ]);
    expect(quote.transaction.nonce).toBe('0');
    f.setBalance(BigInt(0));
    return quote.id;
  });
  await expect(f.submit()).rejects.toMatchObject({
    transactionNotBroadcast: true,
  });
  expect(f.wallet.inspectOrdinaryEvmNonce).toHaveBeenCalledTimes(1);
  expect(f.options.assertPendingState).toHaveBeenCalledTimes(1);
  expect(f.send).not.toHaveBeenCalled();
  expect(f.broadcast).not.toHaveBeenCalled();
});

it('reuses only the owner display header and keeps fresh state at both signing boundaries', async () => {
  const f = fixture();
  Object.assign(f.options, { feeDisplayBlock: { ...block } });
  f.options.confirmFee.mockImplementationOnce(async (quote) => {
    expect(f.provider.send.mock.calls.map(([method]) => method)).toEqual([
      'eth_getTransactionCount',
      'eth_estimateGas',
    ]);
    return quote.id;
  });
  await f.submit();
  expect(f.options.assertPendingState).toHaveBeenCalledTimes(2);
  expect(f.options.assertAssetState).toHaveBeenCalledTimes(2);
  expect(
    f.provider.send.mock.calls.filter(
      ([method]) => method === 'eth_estimateGas'
    )
  ).toHaveLength(2);
  expect(
    f.provider.send.mock.calls.filter(
      ([method, params]) =>
        method === 'eth_getBlockByNumber' && params[0] === 'latest'
    )
  ).toHaveLength(2);
  expect(f.broadcast).toHaveBeenCalledTimes(1);
});

it('finishes authenticated phase priming before independent quote and admission reads', async () => {
  const f = fixture();
  const ready = new WeakSet<object>();
  const prepareReadPhase = jest.fn(async (provider: object) => {
    await Promise.resolve();
    ready.add(provider);
  });
  Object.assign(f.options, { prepareReadPhase });
  f.options.assertPendingState.mockImplementation(async (...args) => {
    expect(ready.has(args[0] as object)).toBe(true);
  });
  await f.submit();
  expect(prepareReadPhase).toHaveBeenCalledTimes(2);
  expect(prepareReadPhase.mock.calls[0][0]).not.toBe(
    prepareReadPhase.mock.calls[1][0]
  );
  expect(f.broadcast).toHaveBeenCalledTimes(1);
});

it.each(['larger', 'unavailable'] as const)(
  'holds signed bytes when the final estimate becomes %s after consent',
  async (change) => {
    const f = fixture();
    let approved = false;
    const read = f.provider.send.getMockImplementation()!;
    f.options.confirmFee.mockImplementationOnce(async (quote) => {
      approved = true;
      return quote.id;
    });
    f.provider.send.mockImplementation(async (method, params) => {
      if (approved && method === 'eth_estimateGas') {
        if (change === 'unavailable')
          throw new Error('final estimate unavailable');
        return '0x100000';
      }
      return read(method, params);
    });
    await expect(f.submit()).rejects.toMatchObject({
      transactionNotBroadcast: true,
    });
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.records.append).toHaveBeenCalledTimes(1);
    expect(f.broadcast).not.toHaveBeenCalled();
    expect(
      f.provider.send.mock.calls.filter(
        ([method]) => method === 'eth_estimateGas'
      )
    ).toHaveLength(2);
  }
);

it('rejects a higher live base fee before payer signing despite the fixed approved gas bound', async () => {
  const f = fixture();
  Object.assign(f.options, { feeDisplayBlock: { ...block } });
  f.options.confirmFee.mockImplementationOnce(async (quote) => {
    block.baseFeePerGas = '0xa';
    return quote.id;
  });
  await expect(f.submit()).rejects.toMatchObject({
    transactionNotBroadcast: true,
  });
  expect(f.send).not.toHaveBeenCalled();
  expect(f.broadcast).not.toHaveBeenCalled();
});

it('refuses a smart payer without explicit numerical fee consent', async () => {
  const f = fixture();
  delete (f.options as { confirmFee?: unknown }).confirmFee;
  await expect(f.submit()).rejects.toMatchObject({
    transactionNotBroadcast: true,
  });
  expect(f.send).not.toHaveBeenCalled();
  expect(f.records.append).not.toHaveBeenCalled();
  expect(f.broadcast).not.toHaveBeenCalled();
});

it('shows an affordable excessive RPC priority fee before the payer can sign', async () => {
  const f = fixture();
  f.setBalance(BigInt('1000000000000000000000000'));
  mockSettingsFeePerGas = BigInt('1000000000000');
  mockSettingsPriorityFee = BigInt('999999999999');
  let approve!: (id: string | null) => void;
  f.options.confirmFee.mockImplementationOnce(
    () => new Promise((resolve) => (approve = resolve))
  );
  const work = f.submit(NATIVE_EVM_FEE_FUNDING, {
    ...f.request,
    maxFeePerGas: mockSettingsFeePerGas.toString(),
    maxPriorityFeePerGas: mockSettingsPriorityFee.toString(),
  });
  for (let i = 0; i < 20 && !approve; i++) await new Promise(setImmediate);
  expect(approve).toBeDefined();
  const quote = f.options.confirmFee.mock.calls[0][0];
  expect(quote.maximumFeeUnits).toBe('21000000000000000');
  expect(quote.transaction).toMatchObject({
    from: signer.address,
    to: receiver,
    gasLimit: '21000',
    maxPriorityFeePerGas: mockSettingsPriorityFee.toString(),
  });
  expect(f.send).not.toHaveBeenCalled();
  expect(f.records.append).not.toHaveBeenCalled();
  expect(f.broadcast).not.toHaveBeenCalled();
  approve(quote.id);
  await work;
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(f.broadcast).toHaveBeenCalledTimes(1);
});

it.each(['cancel', 'payer', 'network', 'session'])(
  'does not sign or persist the payer envelope after fee-review %s',
  async (failure) => {
    const f = fixture();
    let approve!: (id: string | null) => void;
    f.options.confirmFee.mockImplementationOnce(
      () => new Promise((resolve) => (approve = resolve))
    );
    const work = f.submit();
    const refused = expect(work).rejects.toMatchObject({
      transactionNotBroadcast: true,
    });
    for (let i = 0; i < 20 && !approve; i++) await new Promise(setImmediate);
    expect(approve).toBeDefined();
    const quote = f.options.confirmFee.mock.calls[0][0];
    if (failure === 'payer')
      mockState.vault.accounts.HDAccount[0].address = receiver;
    if (failure === 'network')
      mockState.vault.activeNetwork.url = 'https://other.invalid';
    if (failure === 'session') f.wallet.walletSessionGeneration++;
    approve(failure === 'cancel' ? null : quote.id);
    await refused;
    expect(f.send).not.toHaveBeenCalled();
    expect(f.records.append).not.toHaveBeenCalled();
    expect(f.broadcast).not.toHaveBeenCalled();
  }
);

it.each(['signing', 'persistence', 'unchanged'] as const)(
  'checks fresh tank credit after %s with one compatible estimate per phase',
  async (stage) => {
    const f = fixture(57057);
    f.setBalance(BigInt(0));
    let credit = BigInt(1000000);
    const read = f.provider.send.getMockImplementation()!;
    f.provider.send.mockImplementation(async (method, params) => {
      if (method === 'eth_call')
        return '0x' + credit.toString(16).padStart(64, '0');
      return read(method, params);
    });
    const fundingProvider = {
      call: async () => '0x' + credit.toString(16).padStart(64, '0'),
      estimateGas: jest.fn(async () => {
        throw new Error('Duplicate tank estimate');
      }),
      getFeeData: jest.fn(async () => {
        throw new Error('Unused fee data');
      }),
    };
    const to = getPaliEntryPointAddress(57057);
    const funding = createSmartAccountGasTankFunding(
      fundingProvider,
      { chainId: 57057, payer: signer.address, to, data: '0x1234', value: '0' },
      () => undefined
    );
    if (stage === 'signing')
      f.onSigned(() => {
        credit = BigInt(0);
      });
    if (stage === 'persistence')
      f.onPersisted(() => {
        credit = BigInt(0);
      });
    const work = f.submit(funding, { ...f.request, chainId: 57057, to });
    if (stage === 'unchanged') await expect(work).resolves.toBeDefined();
    else
      await expect(work).rejects.toMatchObject({
        transactionNotBroadcast: true,
      });
    expect(fundingProvider.estimateGas).not.toHaveBeenCalled();
    expect(fundingProvider.getFeeData).not.toHaveBeenCalled();
    expect(f.broadcast).toHaveBeenCalledTimes(stage === 'unchanged' ? 1 : 0);
  }
);

it('refuses an unfunded EOA payer even when the selected Smart account has funds', async () => {
  const f = fixture();
  f.setBalance(BigInt(0));
  await expect(f.submit()).rejects.toMatchObject({
    transactionNotBroadcast: true,
  });
  expect(f.send).not.toHaveBeenCalled();
  expect(f.records.append).not.toHaveBeenCalled();
  expect(f.broadcast).not.toHaveBeenCalled();
  for (const [method, params] of f.provider.send.mock.calls as any)
    if (method === 'eth_getBalance') expect(params?.[0]).toBe(signer.address);
});

it('retains the selected Smart account while signing a funded EOA payer with the exact gas limit', async () => {
  const f = fixture();
  await f.submit();
  expect(f.send).toHaveBeenCalledWith(
    expect.objectContaining({
      gasLimit: '21000',
      nonce: '0',
      from: signer.address,
    }),
    false,
    expect.objectContaining({
      mode: 'reviewed-generic',
      walletNonce: { nonce: 0, source: 'automatic' },
    })
  );
  expect(f.records.append).toHaveBeenCalledTimes(1);
  expect(f.records.append.mock.calls[0][2]).toMatchObject({
    smartAccountExecution: true,
  });
  expect(f.broadcast).toHaveBeenCalledTimes(1);
  expect(f.wallet.sendAndSaveTransaction).toHaveBeenCalledWith(
    expect.objectContaining({ smartAccountExecution: true }),
    { id: 0, type: 'HDAccount' },
    expect.objectContaining({
      assertPendingState: f.options.assertPendingState,
    })
  );
});

it('does not reject its own newly persisted handleOps row as an unrelated pending operation', async () => {
  const f = fixture();
  const execution = encodeERC7579Executions([
    { target: receiver, value: '0', data: '0x' },
  ]);
  const operation = buildSmartAccountUserOperation({
    sender: smart,
    nonce: '0',
    callData: paliSmartAccountInterface.encodeFunctionData('execute', [
      execution.mode,
      execution.executionCalldata,
    ]),
    initCode: '0x',
    accountGasLimits: '0x' + '00'.repeat(32),
    gasFees: '0x' + '00'.repeat(32),
    preVerificationGas: '1',
  });
  const read = f.provider.send.getMockImplementation()!;
  f.provider.send.mockImplementation(async (method, params) => {
    if (method === 'eth_getCode') return '0x';
    if (method === 'eth_call')
      return (params[0] as { data: string }).data.startsWith(
        paliEntryPointInterface.getFunction('balanceOf')!.selector
      )
        ? paliEntryPointInterface.encodeFunctionResult('balanceOf', [0])
        : paliEntryPointInterface.encodeFunctionResult('getNonce', [0]);
    if (
      method === 'eth_getTransactionReceipt' ||
      method === 'eth_getTransactionByHash'
    )
      return null;
    if (method === 'eth_chainId') return '0x39';
    if (method === 'eth_getTransactionCount') return '0x0';
    return read(method, params);
  });
  const pending = createSmartAccountPendingState(
    f.provider,
    {
      profileId: '0x' + '99'.repeat(32),
      async read() {
        return f.records.append.mock.calls.map(([, record]: any) => ({
          account: smart,
          chainId: '57',
          operationNonce: '0',
          payer: signer.address,
          payerNonce: record.nonce,
          hash: record.hash,
        }));
      },
    },
    57,
    smart,
    () => undefined
  );
  f.options.assertPendingState = jest.fn((provider, hash) =>
    provider
      ? pending
          .onProvider(provider, hash as string | undefined)
          .assertNonce(operation)
      : pending.assertNonce(operation)
  );
  await f.submit();
  expect(f.records.append).toHaveBeenCalledTimes(1);
  expect(f.broadcast).toHaveBeenCalledTimes(1);
  // The unchanged predecessor guard really would reject the retained row;
  // only dispatch of that already-owned exact row skips re-running this gate.
  await expect(pending.assertNonce(operation)).rejects.toThrow(
    'SMART_ACCOUNT_PENDING_STATE'
  );
});

it('uses verified gas credit without requiring native gas and rechecks it at dispatch', async () => {
  const f = fixture();
  f.setBalance(BigInt(0));
  let boundary = 'quote';
  const boundaries: string[] = [];
  f.options.confirmFee.mockImplementation(async (quote) => {
    boundary = 'approved';
    return quote.id;
  });
  f.onSigned(() => {
    boundary = 'signed';
  });
  f.onPersisted(() => {
    boundary = 'persisted';
  });
  const verify = jest.fn(async (approval) => {
    boundaries.push(boundary);
    return BigInt(approval.maximumFeeUnits);
  });
  await f.submit(createOwnedEvmFeeFunding(verify));
  expect(f.options.confirmFee).toHaveBeenCalledWith(
    expect.objectContaining({
      maximumFeeUnits: '63000',
      coveredFeeUnits: '63000',
      maximumTotalUnits: '0',
    })
  );
  // The new asynchronous consent boundary requires fresh credit admission;
  // final dispatch still checks again after the durable signed-row write.
  expect(boundaries).toEqual(['quote', 'approved', 'persisted']);
  expect(f.records.append).toHaveBeenCalledTimes(1);
  expect(f.broadcast).toHaveBeenCalledTimes(1);
});

it('still requires the native transfer value when gas is covered', async () => {
  const f = fixture();
  f.setBalance(BigInt(0));
  await expect(
    f.submit(
      createOwnedEvmFeeFunding(async (approval) =>
        BigInt(approval.maximumFeeUnits)
      ),
      { ...f.request, value: '1' }
    )
  ).rejects.toMatchObject({ transactionNotBroadcast: true });
  expect(f.send).not.toHaveBeenCalled();
});

it('retains signed bytes and refuses dispatch when funding is lost during signing', async () => {
  const f = fixture();
  f.onSigned(() => f.setBalance(BigInt(0)));
  await expect(f.submit()).rejects.toMatchObject({
    transactionNotBroadcast: true,
  });
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(f.records.append).toHaveBeenCalledTimes(1);
  expect(f.broadcast).not.toHaveBeenCalled();
});

it('keeps the final pre-broadcast check after durable persistence', async () => {
  const f = fixture();
  f.onPersisted(() => f.setBalance(BigInt(0)));
  await expect(f.submit()).rejects.toMatchObject({
    transactionNotBroadcast: true,
  });
  expect(f.records.append).toHaveBeenCalledTimes(1);
  expect(f.broadcast).not.toHaveBeenCalled();
});

it.each([true, false])(
  'retains the inner authorization after a failed Smart payer submission (simulation refused: %s)',
  async (simulationRefused) => {
    const f = fixture();
    const { records, session } = attachSignedRecords(f);
    const operation = buildSmartAccountUserOperation({
      sender: smart,
      nonce: '0',
      callData: '0x1234',
      signature: '0x1234',
    });
    const { operationHash } = await records.retainSmartAccountAuthorization(
      session,
      {
        chainId: 57,
        observedAt: { number: '16', hash: block.hash },
        payer: signer.address,
        userOperation: operation,
      }
    );
    let persistedHash: string | undefined;
    f.options.assertPendingState.mockImplementation(async (_provider, hash) => {
      if (typeof hash !== 'string') return;
      persistedHash = hash;
      if (simulationRefused) throw new ExecutionSimulationEvidenceError();
    });
    if (!simulationRefused) {
      f.broadcast.mockRejectedValueOnce(new Error('HTTP 502'));
    }
    await expect(
      f.submit(NATIVE_EVM_FEE_FUNDING, {
        ...f.request,
        to: getPaliEntryPointAddress(57),
        data: paliEntryPointInterface.encodeFunctionData('handleOps', [
          [operation],
          signer.address,
        ]),
      })
    ).rejects.toMatchObject({ transactionNotBroadcast: simulationRefused });
    expect(persistedHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(f.broadcast).toHaveBeenCalledTimes(simulationRefused ? 0 : 1);
    const outer = await records.listSender(session, '57', signer.address);
    expect(outer.map(({ hash }) => hash)).toEqual(
      simulationRefused ? [] : [persistedHash]
    );
    expect(
      await records.readSmartAccountAuthorizationExact(
        session,
        '57',
        smart,
        operationHash
      )
    ).toMatchObject({ operationHash });
  }
);

it.each(['review', 'signing', 'persistence'] as const)(
  'rechecks Smart asset spendability after %s without resubmitting',
  async (stage) => {
    const f = fixture();
    let available = stage !== 'review';
    f.options.assertAssetState = jest.fn(async () => {
      if (!available) throw new Error('SMART_ACCOUNT_ASSET_STATE_CHANGED');
    });
    const revoke = () => {
      available = false;
    };
    if (stage === 'signing') f.onSigned(revoke);
    if (stage === 'persistence') f.onPersisted(revoke);
    await expect(f.submit()).rejects.toMatchObject({
      transactionNotBroadcast: true,
    });
    expect(f.records.append).toHaveBeenCalledTimes(stage === 'review' ? 0 : 1);
    expect(f.broadcast).not.toHaveBeenCalled();
  }
);

it('uses the full Smart admission callback without repeating its asset reads', async () => {
  const f = fixture();
  Object.assign(f.options, { assertPendingStateIncludesAssets: true });
  await f.submit();
  expect(f.options.assertPendingState).toHaveBeenCalled();
  expect(f.options.assertAssetState).not.toHaveBeenCalled();
  expect(f.broadcast).toHaveBeenCalledTimes(1);
});

it('requires the explicit Smart asset check before signing', async () => {
  const f = fixture();
  delete (f.options as Partial<typeof f.options>).assertAssetState;
  await expect(f.submit()).rejects.toMatchObject({
    transactionNotBroadcast: true,
  });
  expect(f.send).not.toHaveBeenCalled();
});

it.each(['signing', 'persistence'] as const)(
  'rechecks gas-tank credit after %s',
  async (stage) => {
    const f = fixture();
    f.setBalance(BigInt(0));
    let credit = true;
    const funding = createOwnedEvmFeeFunding(async (approval) => {
      if (!credit) throw new Error('Gas credit changed');
      return BigInt(approval.maximumFeeUnits);
    });
    if (stage === 'signing')
      f.onSigned(() => {
        credit = false;
      });
    else
      f.onPersisted(() => {
        credit = false;
      });
    await expect(f.submit(funding)).rejects.toMatchObject({
      transactionNotBroadcast: true,
    });
    expect(f.records.append).toHaveBeenCalledTimes(1);
    expect(f.broadcast).not.toHaveBeenCalled();
  }
);

it('retains all authorization and pending-state checks after signing', async () => {
  const f = fixture();
  let allowed = true;
  f.options.assertBeforeSign = () => {
    if (!allowed) throw new Error('Approval cancelled');
  };
  f.onSigned(() => {
    allowed = false;
  });
  await expect(f.submit()).rejects.toMatchObject({
    transactionNotBroadcast: true,
  });
  expect(f.records.append).not.toHaveBeenCalled();
  expect(f.broadcast).not.toHaveBeenCalled();
});

it('refuses dispatch for other pending Smart operations after signing', async () => {
  const f = fixture();
  let competing = false;
  f.options.assertPendingState = jest.fn(async () => {
    if (competing) throw new Error('SMART_ACCOUNT_PENDING_STATE');
  });
  f.onSigned(() => {
    competing = true;
  });
  await expect(f.submit()).rejects.toMatchObject({
    transactionNotBroadcast: true,
  });
  expect(f.records.append).toHaveBeenCalledTimes(1);
  expect(f.broadcast).not.toHaveBeenCalled();
});

it('allows ordinary balance refreshes while the same selected account and payer remain', async () => {
  const f = fixture();
  f.onSigned(() => {
    mockState.vault.accounts.HDAccount[0] = {
      ...mockState.vault.accounts.HDAccount[0],
      balance: 'new display value',
    };
    mockState.vault.accounts.SmartAccount[2] = {
      ...mockState.vault.accounts.SmartAccount[2],
      balance: 'new display value',
    };
  });
  await f.submit();
  expect(f.broadcast).toHaveBeenCalledTimes(1);
});

it('retains an ambiguous broadcast failure as unknown', async () => {
  const f = fixture();
  f.broadcast.mockRejectedValueOnce(new Error('response lost'));
  await expect(f.submit()).rejects.toMatchObject({
    transactionNotBroadcast: false,
  });
  expect(f.records.append).toHaveBeenCalledTimes(1);
  expect(f.broadcast).toHaveBeenCalledTimes(1);
});

it.each(['account', 'network', 'session'] as const)(
  'rejects %s drift during a deferred payer quote before invoking the signer',
  async (change) => {
    const f = fixture();
    let release!: (result: unknown) => void;
    let reached!: () => void;
    const entered = new Promise<void>((resolve) => {
      reached = resolve;
    });
    f.provider.send.mockImplementationOnce(() => {
      reached();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const pending = f.submit();
    void pending.catch(() => undefined);
    await entered;
    if (change === 'account')
      mockState.vault.activeAccount = { id: 0, type: 'HDAccount' };
    if (change === 'network')
      mockState.vault.activeNetwork = {
        ...mockState.vault.activeNetwork,
        url: 'https://other.invalid',
      };
    if (change === 'session') f.wallet.walletSessionGeneration += 1;
    release(block);
    await expect(pending).rejects.toMatchObject({
      transactionNotBroadcast: true,
    });
    expect(f.send).not.toHaveBeenCalled();
    expect(f.records.append).not.toHaveBeenCalled();
    expect(f.broadcast).not.toHaveBeenCalled();
  }
);

it('refuses an unverified credit object without a private funding capability', async () => {
  const f = fixture();
  f.setBalance(BigInt(0));
  await expect(f.submit({ kind: 'verified-credit' })).rejects.toMatchObject({
    transactionNotBroadcast: true,
  });
  expect(f.send).not.toHaveBeenCalled();
});

it.each(['account', 'network', 'payer'] as const)(
  'rejects %s drift during signing before persistence',
  async (change) => {
    const f = fixture();
    f.onSigned(() => {
      if (change === 'account')
        mockState.vault.activeAccount = { id: 0, type: 'HDAccount' };
      if (change === 'network')
        mockState.vault.activeNetwork = {
          ...mockState.vault.activeNetwork,
          url: 'https://other.invalid',
        };
      if (change === 'payer')
        mockState.vault.accounts.HDAccount[0] = { address: receiver };
    });
    await expect(f.submit()).rejects.toMatchObject({
      transactionNotBroadcast: true,
    });
    expect(f.records.append).not.toHaveBeenCalled();
    expect(f.broadcast).not.toHaveBeenCalled();
  }
);

it('refuses an otherwise valid fee cap when the fresh base fee requires raising it', async () => {
  const f = fixture();
  const read = f.provider.send.getMockImplementation()!;
  f.provider.send.mockImplementation(async (method, params) =>
    method === 'eth_getBlockByNumber'
      ? { ...block, baseFeePerGas: '0x4' }
      : read(method, params)
  );
  await expect(f.submit()).rejects.toMatchObject({
    message: 'REVIEW_REQUIRED',
    transactionNotBroadcast: true,
  });
  expect(f.send).not.toHaveBeenCalled();
  expect(f.records.append).not.toHaveBeenCalled();
});

it('rejects a reorg after a numbered header was reused by pending reconciliation', async () => {
  const f = fixture();
  let replaced = false;
  let numberedReads = 0;
  const original = f.provider.send.getMockImplementation()!;
  f.options.assertPendingState.mockImplementation(async (...args) => {
    const provider = args[0] as any;
    await provider.send('eth_getBlockByNumber', ['0x10', false]);
  });
  f.provider.send.mockImplementation(async (method, params) => {
    if (method === 'eth_getBlockByNumber' && params?.[0] === '0x10') {
      numberedReads++;
      return { ...block, hash: replaced ? '0x' + '55'.repeat(32) : block.hash };
    }
    if (method === 'eth_estimateGas') replaced = true;
    return original(method, params);
  });
  await expect(f.submit()).rejects.toMatchObject({
    message: EVM_TRANSACTION_CONTEXT_CHANGED,
    transactionNotBroadcast: true,
  });
  expect(numberedReads).toBe(2);
  expect(f.send).not.toHaveBeenCalled();
  expect(f.records.append).not.toHaveBeenCalled();
  expect(f.broadcast).not.toHaveBeenCalled();
});

it('routes deployment prefunding through the same payer checks', async () => {
  const f = fixture();
  f.setBalance(BigInt(0));
  await expect(
    f.submit(NATIVE_EVM_FEE_FUNDING, f.request, {
      smartAccountDeploymentPrefund: true,
    } as any)
  ).rejects.toMatchObject({ transactionNotBroadcast: true });
  expect(f.send).not.toHaveBeenCalled();
});

it.each([false, true])(
  'discovers deployment prefund fees, legacy=%s',
  async (legacy) => {
    const f = fixture();
    if (legacy) {
      const read = f.provider.send.getMockImplementation()!;
      f.provider.send.mockImplementation(async (method, params) =>
        method === 'eth_getBlockByNumber'
          ? { ...block, baseFeePerGas: null }
          : read(method, params)
      );
    }
    await f.submit(
      NATIVE_EVM_FEE_FUNDING,
      {
        chainId: 57,
        from: signer.address,
        to: smart,
        value: '100',
      } as any,
      { smartAccountDeploymentPrefund: true } as any
    );
    expect(f.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: smart,
        value: '100',
        ...(legacy
          ? { gasPrice: '3' }
          : { maxFeePerGas: '3', maxPriorityFeePerGas: '1' }),
      }),
      legacy,
      expect.objectContaining({ mode: 'reviewed-generic' })
    );
    expect(f.records.append).toHaveBeenCalledTimes(1);
    expect(f.broadcast).toHaveBeenCalledTimes(1);
  }
);

it('rejects an unfunded deployment prefund after discovering fees', async () => {
  const f = fixture();
  f.setBalance(BigInt(0));
  await expect(
    f.submit(
      NATIVE_EVM_FEE_FUNDING,
      { chainId: 57, from: signer.address, to: smart, value: '100' } as any,
      { smartAccountDeploymentPrefund: true } as any
    )
  ).rejects.toMatchObject({ transactionNotBroadcast: true });
  expect(f.send).not.toHaveBeenCalled();
  expect(f.records.append).not.toHaveBeenCalled();
  expect(f.broadcast).not.toHaveBeenCalled();
});

it.each(['signing', 'persistence', 'unchanged'] as const)(
  'binds counterfactual prefunding to the signed token operation through payer %s',
  async (stage) => {
    const f = fixture();
    const token = '0x' + '66'.repeat(20);
    const execution = encodeERC7579Executions([
      {
        target: token,
        data:
          '0xa9059cbb' +
          receiver.slice(2).padStart(64, '0') +
          BigInt(9).toString(16).padStart(64, '0'),
        value: '0',
      },
    ]);
    const nonce = (
      BigInt(
        encodeSmartAccountValidatorNonceKey(
          deployment.account.smartAccount.auth.validator
        )
      ) << BigInt(64)
    ).toString();
    const operation = buildSmartAccountUserOperation({
      sender: smart,
      nonce,
      initCode: deployment.deploymentInitCode,
      callData: paliSmartAccountInterface.encodeFunctionData('execute', [
        execution.mode,
        execution.executionCalldata,
      ]),
      accountGasLimits: encodeSmartAccountGasLimits({
        callGasLimit: 1,
        verificationGasLimit: 1,
      }),
      gasFees: encodeSmartAccountGasFees({
        maxFeePerGas: 1,
        maxPriorityFeePerGas: 0,
      }),
      preVerificationGas: '0',
    });
    let tokenBalance = BigInt(9);
    let retainedSnapshotRead = false;
    const balanceAtRead: bigint[] = [];
    const originalRead = f.provider.send.getMockImplementation()!;
    f.provider.send.mockImplementation(async (method, params) => {
      if (
        method === 'eth_getBalance' &&
        String(params?.[0]).toLowerCase() === smart.toLowerCase()
      )
        return '0x0';
      if (method === 'eth_getCode')
        return String(params?.[0]).toLowerCase() === token.toLowerCase()
          ? '0x01'
          : '0x';
      if (method === 'eth_call') {
        const call = params?.[0] as { data: string; to: string };
        if (
          call.to.toLowerCase() === getPaliEntryPointAddress(57).toLowerCase()
        ) {
          if (
            call.data.startsWith(
              paliEntryPointInterface.getFunction('getNonce')!.selector
            )
          )
            return paliEntryPointInterface.encodeFunctionResult('getNonce', [
              nonce,
            ]);
          if (
            call.data.startsWith(
              paliEntryPointInterface.getFunction('balanceOf')!.selector
            )
          )
            return paliEntryPointInterface.encodeFunctionResult('balanceOf', [
              0,
            ]);
        }
        if (call.to.toLowerCase() === token.toLowerCase()) {
          if (call.data.startsWith('0x70a08231')) {
            balanceAtRead.push(tokenBalance);
            return '0x' + tokenBalance.toString(16).padStart(64, '0');
          }
          if (call.data === '0x313ce567') return '0x' + '0'.repeat(64);
          if (call.data.startsWith('0xa9059cbb'))
            return '0x' + '0'.repeat(63) + '1';
        }
        throw new Error('Unexpected prefund contract read');
      }
      return originalRead(method, params);
    });
    const protectedKeyring: any = Object.create(SoftwareKeyring.prototype);
    protectedKeyring.sessionPassword = { isCleared: () => false };
    protectedKeyring.sessionMnemonic = { isCleared: () => false };
    protectedKeyring.privateRecordSessionRevision = 0;
    protectedKeyring.getDecryptedMnemonic = () =>
      'synthetic prefund authorization root';
    let authorizationBytes: string | undefined;
    const authorizations = new EvmSignedRecords({
      read: async () => authorizationBytes,
      compareAndSet: async (_profile, expected, next, check) => {
        check();
        if (authorizationBytes !== expected) return false;
        authorizationBytes = next;
        return true;
      },
    });
    const authorizationSession = {
      keyring: protectedKeyring,
      assertCurrent: () => undefined,
    };
    const authorizationRecords =
      await authorizations.captureSmartAccountPendingRecords(
        authorizationSession,
        '57',
        smart
      );
    f.snapshot.owner = authorizationRecords.profileId;
    Object.assign(f.snapshot, {
      readSmartAccountAuthorizations: () =>
        authorizationRecords.readAuthorizations!(true),
    });
    const pending = createSmartAccountPendingState(
      f.provider,
      {
        ...authorizationRecords,
        profileId: authorizationRecords.profileId,
        read: async () => {
          if (f.records.append.mock.calls.length) {
            throw new Error(
              'Final admission must use its authenticated snapshot'
            );
          }
          return [];
        },
      },
      57,
      smart,
      () => undefined
    );
    f.snapshot.readSmartAccountOperations.mockImplementation(async () => {
      retainedSnapshotRead = true;
      return [];
    });
    const revoke = () => {
      tokenBalance = BigInt(0);
    };
    if (stage === 'signing') f.onSigned(revoke);
    if (stage === 'persistence') f.onPersisted(revoke);
    const fund = jest.fn(async (...args: any[]) =>
      ensureSmartAccountDeploymentPrefund(
        pending.provider,
        async (...sendArgs) => {
          const response = await f.wallet.sendAndSaveEthTransaction(
            ...sendArgs.slice(0, 4),
            { ...sendArgs[4], confirmFee: f.options.confirmFee }
          );
          return { ...response, wait: async () => undefined };
        },
        args[0],
        args[1],
        args[2],
        args[3],
        args[4],
        args[5]
      )
    );
    const work = submitSmartAccountOperation(
      {
        accountId: 2,
        executionContextId: 'counterfactual-token',
        signature: '0x1234',
        userOperation: operation,
      },
      {
        chainId: 57,
        provider: pending.provider,
        pending,
        assertExpectedExecutionContext: () => undefined,
        assertSmartAccountExecutionContext: () => undefined,
        getExecutionContext: () => ({ accountId: 2, userOperation: operation }),
        getSmartAccountById: () => ({
          account: { ...deployment.account, id: 2 } as any,
          metadata: deployment.account.smartAccount,
        }),
        getWalletGasPayerAccount: async () => ({
          id: 0,
          type: KeyringAccountType.HDAccount,
          address: signer.address,
        }),
        getLocalNativeExecutionRecipients: () => [],
        invalidateMetadata: () => undefined,
        ensureDeploymentPrefund: fund,
        retainAuthorization: (userOperation, payer, assertCurrent) =>
          authorizations.retainSmartAccountAuthorization(
            { ...authorizationSession, assertCurrent },
            {
              chainId: 57,
              observedAt: { number: '16', hash: block.hash },
              payer: payer.address,
              userOperation,
            }
          ),
        sendTransaction: async (transaction) => {
          expect(transaction).not.toHaveProperty('gasLimit');
          throw new Error('Reached handleOps');
        },
      },
      () => undefined
    );
    if (stage === 'unchanged') {
      await expect(work).rejects.toThrow('Reached handleOps');
      expect(f.broadcast).toHaveBeenCalledTimes(1);
      expect(tokenBalance).toBe(BigInt(9));
    } else {
      await expect(work).rejects.toMatchObject({
        message: 'Insufficient token or collectible balance',
        transactionNotBroadcast: true,
      });
      expect(f.broadcast).not.toHaveBeenCalled();
      expect(balanceAtRead).toContain(BigInt(0));
    }
    expect(f.records.append).toHaveBeenCalledTimes(1);
    expect(fund).toHaveBeenCalledTimes(1);
    expect(retainedSnapshotRead).toBe(true);
    const retained = f.records.append.mock.calls[0][1];
    const transaction = Transaction.from(retained.rawTransaction);
    expect(transaction.to).toBe(smart);
    expect(transaction.value).toBe(BigInt(2));
    expect(decodeRetainedSmartAccountOperations(retained)).toEqual([]);
  }
);

it.each(['assertPendingState', 'assertAssetState'] as const)(
  'requires %s for deployment prefunding',
  async (guard) => {
    const f = fixture();
    delete (f.options as Partial<typeof f.options>)[guard];
    await expect(
      f.submit(
        NATIVE_EVM_FEE_FUNDING,
        {
          chainId: 57,
          from: signer.address,
          to: smart,
          value: '2',
        } as any,
        { smartAccountDeploymentPrefund: true } as any
      )
    ).rejects.toMatchObject({ transactionNotBroadcast: true });
    expect(f.send).not.toHaveBeenCalled();
    expect(f.records.append).not.toHaveBeenCalled();
    expect(f.broadcast).not.toHaveBeenCalled();
  }
);

const settingsOperations = [
  { smartAccountGuardianRecovery: true, smartAccountRecoveryAccount: smart },
  {
    smartAccountGuardianRecoveryFinalize: true,
    smartAccountRecoveryAccount: smart,
  },
  {
    smartAccountInfrastructureDeployment: true,
    smartAccountInfrastructureId: 'factory',
    smartAccountInfrastructureRpcUrl: 'https://rpc.invalid',
  },
];
const settingsRequest = () => ({
  chainId: 57,
  to: receiver,
  data: '0x1234',
  value: '0',
});
const settingsPayer = { id: 0, type: KeyringAccountType.HDAccount };

it.each(settingsOperations)(
  'requires explicit reviewed fees for settings operation %j',
  async (metadata) => {
    const f = fixture();
    await expect(
      f.wallet.sendAndSaveEthTransaction(
        settingsRequest(),
        false,
        settingsPayer,
        metadata,
        f.options
      )
    ).rejects.toMatchObject({ transactionNotBroadcast: true });
    expect(f.provider.send).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
    expect(f.records.append).not.toHaveBeenCalled();
    expect(f.broadcast).not.toHaveBeenCalled();
  }
);

it.each(settingsOperations)(
  'prepares settings fees without signing and consumes the exact funded EOA review once: %j',
  async (metadata) => {
    const f = fixture();
    const input = settingsRequest();
    const quote = await f.wallet.reviewSettingsEvmFee(
      input,
      settingsPayer,
      metadata,
      f.options
    );
    expect(quote).toMatchObject({
      maximumFeeUnits: '75600',
      maximumTotalUnits: '75600',
      transaction: {
        from: signer.address,
        chainId: '57',
        nonce: '0',
        gasLimit: '25200',
        maxFeePerGas: '3',
        maxPriorityFeePerGas: '1',
      },
    });
    expect(f.send).not.toHaveBeenCalled();
    expect(f.records.append).not.toHaveBeenCalled();
    expect(f.broadcast).not.toHaveBeenCalled();
    const onBroadcast = jest.fn();
    const options = { ...f.options, genericReviewId: quote.id, onBroadcast };
    await f.wallet.sendAndSaveEthTransaction(
      input,
      false,
      settingsPayer,
      metadata,
      options
    );
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.send.mock.calls[0][0]).toEqual(quote.transaction);
    expect(f.records.append).toHaveBeenCalledTimes(1);
    expect(f.records.append.mock.calls[0][2]).toMatchObject(metadata);
    expect(f.broadcast).toHaveBeenCalledTimes(1);
    expect(onBroadcast).toHaveBeenCalledTimes(1);
    await expect(
      f.wallet.sendAndSaveEthTransaction(
        input,
        false,
        settingsPayer,
        metadata,
        options
      )
    ).rejects.toMatchObject({ transactionNotBroadcast: true });
    expect(f.send).toHaveBeenCalledTimes(1);
    for (const [method, params] of f.provider.send.mock.calls as any)
      if (method === 'eth_getBalance') expect(params[0]).toBe(signer.address);
  }
);

it.each(['confirmation', 'signed envelope'] as const)(
  'blocks a settings base fee above the approved ceiling at %s',
  async (stage) => {
    const f = fixture();
    const metadata = settingsOperations[0];
    const input = settingsRequest();
    const quote = await f.wallet.reviewSettingsEvmFee(
      input,
      settingsPayer,
      metadata,
      f.options
    );
    const increase = () => {
      block.baseFeePerGas = '0xa';
      mockSettingsFeePerGas = BigInt(20);
      mockSettingsPriorityFee = BigInt(10);
    };
    if (stage === 'confirmation') increase();
    else f.onSigned(increase);
    await expect(
      f.wallet.sendAndSaveEthTransaction(
        input,
        false,
        settingsPayer,
        metadata,
        { ...f.options, genericReviewId: quote.id }
      )
    ).rejects.toMatchObject({ transactionNotBroadcast: true });
    expect(f.send).toHaveBeenCalledTimes(stage === 'confirmation' ? 0 : 1);
    expect(f.records.append).toHaveBeenCalledTimes(
      stage === 'confirmation' ? 0 : 1
    );
    expect(f.broadcast).not.toHaveBeenCalled();
  }
);

it.each([
  'calldata',
  'target',
  'nonce',
  'metadata',
  'selected account',
  'payer',
  'network',
  'session',
  'expired',
] as const)(
  'rejects changed settings review %s before signing',
  async (change) => {
    const f = fixture();
    const input = settingsRequest();
    const metadata = { ...settingsOperations[0] };
    const quote = await f.wallet.reviewSettingsEvmFee(
      input,
      settingsPayer,
      metadata,
      f.options
    );
    if (change === 'calldata') input.data = '0x5678';
    if (change === 'target') input.to = smart;
    if (change === 'nonce') (input as any).nonce = '1';
    if (change === 'metadata')
      (metadata as any).smartAccountRecoveryAccount = receiver;
    if (change === 'selected account') mockState.vault.activeAccount.id = 3;
    if (change === 'payer')
      mockState.vault.accounts.HDAccount[0].address = receiver;
    if (change === 'network')
      mockState.vault.activeNetwork = {
        ...mockState.vault.activeNetwork,
        url: 'https://other.invalid',
      };
    if (change === 'session') f.wallet.walletSessionGeneration += 1;
    if (change === 'expired')
      jest
        .spyOn(performance, 'now')
        .mockReturnValue(performance.now() + quote.validForMs + 1);
    await expect(
      f.wallet.sendAndSaveEthTransaction(
        input,
        false,
        settingsPayer,
        metadata,
        { ...f.options, genericReviewId: quote.id }
      )
    ).rejects.toMatchObject({ transactionNotBroadcast: true });
    expect(f.send).not.toHaveBeenCalled();
    expect(f.records.append).not.toHaveBeenCalled();
    expect(f.broadcast).not.toHaveBeenCalled();
  }
);

it('does not increase the approved settings priority or total fee when RPC recommendations rise', async () => {
  const f = fixture();
  const metadata = settingsOperations[0];
  const input = settingsRequest();
  const quote = await f.wallet.reviewSettingsEvmFee(
    input,
    settingsPayer,
    metadata,
    f.options
  );
  mockSettingsFeePerGas = BigInt(2000);
  mockSettingsPriorityFee = BigInt(1000);
  await f.wallet.sendAndSaveEthTransaction(
    input,
    false,
    settingsPayer,
    metadata,
    { ...f.options, genericReviewId: quote.id }
  );
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(f.send.mock.calls[0][0]).toEqual(quote.transaction);
  expect(f.broadcast).toHaveBeenCalledTimes(1);
});

it('requires another settings review when the fresh gas estimate exceeds the approved limit', async () => {
  const f = fixture();
  const input = settingsRequest();
  const metadata = settingsOperations[0];
  const quote = await f.wallet.reviewSettingsEvmFee(
    input,
    settingsPayer,
    metadata,
    f.options
  );
  const read = f.provider.send.getMockImplementation()!;
  f.provider.send.mockImplementation(async (method, values) =>
    method === 'eth_estimateGas' ? '0x100000' : read(method, values)
  );
  await expect(
    f.wallet.sendAndSaveEthTransaction(input, false, settingsPayer, metadata, {
      ...f.options,
      genericReviewId: quote.id,
    })
  ).rejects.toMatchObject({ transactionNotBroadcast: true });
  expect(f.send).not.toHaveBeenCalled();
  expect(f.records.append).not.toHaveBeenCalled();
  expect(f.broadcast).not.toHaveBeenCalled();
});

it('requires another settings review when the fresh payer nonce advances', async () => {
  const f = fixture();
  const input = settingsRequest();
  const metadata = settingsOperations[0];
  const quote = await f.wallet.reviewSettingsEvmFee(
    input,
    settingsPayer,
    metadata,
    f.options
  );
  const inspect = f.wallet.inspectOrdinaryEvmNonce.getMockImplementation();
  f.wallet.inspectOrdinaryEvmNonce.mockImplementation(async (...args) => ({
    ...(await inspect(...args)),
    nonce: 1,
  }));
  await expect(
    f.wallet.sendAndSaveEthTransaction(input, false, settingsPayer, metadata, {
      ...f.options,
      genericReviewId: quote.id,
    })
  ).rejects.toMatchObject({ transactionNotBroadcast: true });
  expect(f.send).not.toHaveBeenCalled();
  expect(f.records.append).not.toHaveBeenCalled();
  expect(f.broadcast).not.toHaveBeenCalled();
});

it('cannot auto-approve a settings operation by adding smart-payer metadata', async () => {
  const f = fixture();
  await expect(
    f.wallet.sendAndSaveEthTransaction(
      settingsRequest(),
      false,
      settingsPayer,
      { ...settingsOperations[0], smartAccountExecution: true },
      { ...f.options, genericReviewId: 'not-an-issued-review' }
    )
  ).rejects.toMatchObject({ transactionNotBroadcast: true });
  expect(f.provider.send).not.toHaveBeenCalled();
  expect(f.send).not.toHaveBeenCalled();
  expect(f.broadcast).not.toHaveBeenCalled();
});

it('reads the quoted infrastructure nonce only for its exact contract and live unused review', async () => {
  const f = fixture();
  const input = settingsRequest();
  const metadata = settingsOperations[2];
  const quote = await f.wallet.reviewSettingsEvmFee(
    input,
    settingsPayer,
    metadata,
    f.options
  );
  expect(readSettingsEvmFeeNonce(f.wallet, quote.id, 'factory')).toBe(0);
  f.provider.send.mockClear();
  expect(() =>
    readSettingsEvmFeeNonce(f.wallet, quote.id, 'accountImplementation')
  ).toThrow('Infrastructure fee review changed');
  expect(f.provider.send).not.toHaveBeenCalled();
  expect(f.send).not.toHaveBeenCalled();
  await f.wallet.sendAndSaveEthTransaction(
    input,
    false,
    settingsPayer,
    metadata,
    { ...f.options, genericReviewId: quote.id }
  );
  expect(() => readSettingsEvmFeeNonce(f.wallet, quote.id, 'factory')).toThrow(
    'Settings fee review is unavailable'
  );
});

it('cannot use a guardian fee review as an infrastructure nonce authority', async () => {
  const f = fixture();
  const quote = await f.wallet.reviewSettingsEvmFee(
    settingsRequest(),
    settingsPayer,
    settingsOperations[0],
    f.options
  );
  expect(() => readSettingsEvmFeeNonce(f.wallet, quote.id, 'factory')).toThrow(
    'Infrastructure fee review changed'
  );
  expect(f.send).not.toHaveBeenCalled();
  expect(f.records.append).not.toHaveBeenCalled();
  expect(f.broadcast).not.toHaveBeenCalled();
});
