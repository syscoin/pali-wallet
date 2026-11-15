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
      maxFeePerGas: BigInt(3),
      maxPriorityFeePerGas: BigInt(1),
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
import { decodeRetainedSmartAccountOperations } from '../../../wallet/smartAccountActivity';
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
import {
  createSmartAccountGasTankFunding,
  ensureSmartAccountDeploymentPrefund,
} from 'utils/smartAccount/payerPolicy';
import { createSmartAccountPendingState } from 'utils/smartAccount/pendingState';
import { submitSmartAccountOperation } from 'utils/smartAccount/submitOperation';

import MainController from './MainController';

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

function fixture(chainId = 57) {
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
    verifyConfiguredChainId: jest.fn(async () => undefined),
    send: jest.fn(
      async (method: string, params: readonly unknown[] = []): Promise<any> => {
        if (!Array.isArray(params)) throw new Error('Invalid RPC parameters');
        if (method === 'eth_getBlockByNumber') return block;
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
  const verify = jest.fn(async (approval) => BigInt(approval.maximumFeeUnits));
  await f.submit(createOwnedEvmFeeFunding(verify));
  expect(verify).toHaveBeenCalledTimes(2);
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
    const pending = createSmartAccountPendingState(
      f.provider,
      {
        profileId,
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
            ...sendArgs
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
        sendTransaction: async () => {
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
