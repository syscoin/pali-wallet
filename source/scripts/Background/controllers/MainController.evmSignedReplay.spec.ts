/** @jest-environment node */
jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
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
    dispatch: jest.fn(),
    subscribe: jest.fn(() => () => undefined),
  },
}));

import {
  captureEvmSubmission,
  evmSubmissionFailure,
  SoftwareKeyring,
  submitSignedEvmTransaction,
} from '@sidhujag/sysweb3-keyring/cjs/software.js';
import { submitSignedHardwareEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-submission.js';
import { webcrypto } from 'crypto';
import { Interface } from 'ethers/abi';
import { Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';

import { getController } from '..';
import { encodeErc20Transfer } from '../../../shared/erc20';
import { EvmAutoNonceAcceptance } from '../../../shared/evmAutoNonce';
import {
  EvmSignedRecords,
  retainedEvmAssetPreflightConflict,
} from '../../../wallet/evmSignedRecords';
import * as signedRecordModule from '../../../wallet/evmSignedRecords';
import { walletPersistenceGate } from 'state/paliStorage';
import store from 'state/store';
import { KeyringAccountType } from 'types/network';
import { getWalletNavigationScope } from 'utils/navigationState';
import { blacklistService } from 'utils/security/blacklistService';
import { buildSmartAccountUserOperation } from 'utils/smartAccount/account';
import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
} from 'utils/smartAccount/contracts';
import { chromeStorage } from 'utils/storageAPI';

import MainController from './MainController';

const signer = new Wallet('0x' + '1'.padStart(64, '0'));
const receiver = '0x' + '2'.repeat(40);
const context = {
  account: {
    id: 0,
    type: KeyringAccountType.HDAccount,
    address: signer.address,
  },
  network: {
    kind: 'ethereum',
    chainId: 123,
    slip44: 60,
    url: 'https://a.invalid',
  },
  operation: 'send' as const,
};
const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
let mockState: any;
let wallet: any;
let keyring: any;
let records: any;
let provider: {
  liveChainRead: jest.Mock;
  readMany: jest.Mock;
  send: jest.Mock;
  verifyConfiguredChainId?: jest.Mock;
};
let raw: string;
let entry: any;
const observed = () => ({ entry, revision: 1 });
const runReplayPreflight = async (
  preflight: Parameters<EvmSignedRecords['withReplayAdmission']>[4]
) => {
  if (!preflight) return;
  preflight.assertCurrent();
  const owner = '0x' + '55'.repeat(32);
  await preflight.run(owner, () => ({
    owner,
    minimumNonce: 0,
    retained: [],
    readMaximumCost: async () => {
      throw Error('Unexpected predecessor read in replacement fixture');
    },
    readAssetDebit: async () => BigInt(0),
  }));
};

beforeAll(async () => {
  raw = await signer.signTransaction({
    type: 2,
    chainId: 123,
    nonce: 0,
    to: receiver,
    value: 1,
    gasLimit: 21000,
    maxFeePerGas: 3,
    maxPriorityFeePerGas: 1,
  });
});
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
  walletPersistenceGate.blocked = false;
  mockState = {
    vault: {
      isBitcoinBased: false,
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      accounts: {
        HDAccount: {
          0: {
            id: 0,
            address: signer.address,
            xpub: signer.signingKey.publicKey,
            xprv: 'encrypted fixture',
          },
        },
        Imported: {},
        Ledger: {},
        Trezor: {},
        SmartAccount: {},
      },
      activeNetwork: { ...context.network },
      accountTransactions: {
        HDAccount: {
          0: {
            ethereum: {
              123: [
                {
                  hash: Transaction.from(raw).hash,
                  from: signer.address,
                  nonce: 0,
                },
              ],
            },
          },
        },
      },
    },
    vaultGlobal: { activeSlip44: 60 },
  };
  entry = {
    hash: Transaction.from(raw).hash,
    chainId: '123',
    from: signer.address,
    nonce: 0,
    phase: 'signed',
    signer: { id: 0, type: 'HDAccount' },
    operation: 'send',
    createdAt: 1,
    rawTransaction: raw,
  };
  records = {
    captureSession: jest.fn((session) => session),
    readExact: jest.fn(async () => entry),
    readForObservation: jest.fn(async () => observed()),
    readPage: jest.fn(async () => ({ entries: [entry], nextCursor: null })),
    withReplayAdmission: jest.fn(
      async (_session, _target, admit, _predecessorNonce, preflight) => {
        await runReplayPreflight(preflight);
        return await admit([]);
      }
    ),
    append: jest.fn(async () => undefined),
    captureVerifiedReplacement: jest.fn(async () => undefined),
    updatePhase: jest.fn(async () => undefined),
    updateObservedPhase: jest.fn(async () => undefined),
    reconcileMinedCancellation: jest.fn(async () => undefined),
  };
  provider = {
    liveChainRead: jest.fn(async () => '0x7b'),
    readMany: jest.fn(async (requests) =>
      Promise.allSettled(
        requests.map(({ method, params }) =>
          method === 'eth_chainId'
            ? provider.liveChainRead()
            : provider.send(method, params)
        )
      )
    ),
    send: jest.fn(async (method: string, params: unknown[]) => {
      if (method === 'eth_chainId') return '0x7b';
      if (method === 'eth_getTransactionReceipt') return null;
      if (method === 'eth_getTransactionCount') return '0x0';
      if (method === 'eth_sendRawTransaction') {
        expect(params).toEqual([raw]);
        return entry.hash;
      }
      throw Error('Unexpected RPC');
    }),
  };
  keyring = {
    isUnlocked: jest.fn(() => true),
    ethereumTransaction: { web3Provider: provider },
  };
  wallet = Object.create(MainController.prototype);
  wallet.walletSessionGeneration = 7;
  wallet.networkRequestGeneration = 11;
  wallet.getActiveKeyring = jest.fn(() => keyring);
  wallet.getRetainedEvmRecords = jest.fn(() => records);
  // Public history/polling is covered by the real replay-ACK integration suite.
});
afterEach(() => jest.restoreAllMocks());

it('rejects a view-only imported xpub before reading retained records', async () => {
  mockState.vault.activeAccount.type = KeyringAccountType.Imported;
  mockState.vault.accounts.Imported[0] = {
    address: signer.address,
    xpub: signer.signingKey.publicKey,
  };
  await expect(wallet.getSavedEvmTransaction(entry.hash)).rejects.toThrow(
    'signing account'
  );
  expect(records.readExact).not.toHaveBeenCalled();
  expect(provider.send).not.toHaveBeenCalled();
});
it.each([
  KeyringAccountType.Imported,
  KeyringAccountType.Ledger,
  KeyringAccountType.Trezor,
])(
  'allows retained reads for the signing %s account without password or signing',
  async (type) => {
    mockState.vault.activeAccount.type = type;
    mockState.vault.accounts[type][0] = {
      address: signer.address,
      xpub: signer.signingKey.publicKey,
      ...(type === KeyringAccountType.Imported
        ? { xprv: 'encrypted fixture' }
        : {}),
    };
    const saved = await wallet.getSavedEvmTransaction(entry.hash);
    expect(saved.hash).toBe(entry.hash);
    expect(saved.rawTransaction).toBeUndefined();
    expect(records.readExact).toHaveBeenCalledWith(
      expect.objectContaining({ keyring }),
      '123',
      signer.address,
      entry.hash
    );
    expect(provider.send).not.toHaveBeenCalled();
  }
);
it.each([
  ['wallet software', KeyringAccountType.HDAccount],
  ['wallet Ledger', KeyringAccountType.Ledger],
  ['wallet Trezor', KeyringAccountType.Trezor],
  ['approved dapp', KeyringAccountType.HDAccount],
])(
  'the %s lifecycle preserves an unused explicit nonce and refuses a retained one',
  async (lane, type) => {
    mockState.vault.activeAccount.type = type;
    mockState.vault.accounts[type][0] = { id: 0, address: signer.address };
    const sdkKeyring = Object.assign(
      Object.create(SoftwareKeyring.prototype),
      keyring,
      {
        sessionPassword: { isCleared: () => false },
        sessionMnemonic: { isCleared: () => false },
        privateRecordSessionRevision: 0,
        getDecryptedMnemonic: () => 'Public journal nonce test fixture',
      }
    );
    wallet.getActiveKeyring.mockReturnValue(sdkKeyring);
    let saved: string | undefined;
    const journal = new EvmSignedRecords({
      async read() {
        return saved;
      },
      async compareAndSet(_id, expected, next, assertCurrent) {
        assertCurrent();
        if (saved !== expected) return false;
        saved = next;
        return true;
      },
    });
    wallet.getRetainedEvmRecords.mockReturnValue(journal);
    const owner = { ...context, account: { ...context.account, type } };
    const send = jest.fn(async (bytes: string) => Transaction.from(bytes).hash);
    const authorize = jest.fn();
    const sign = (nonce: number, value: number) =>
      signer.signTransaction({
        chainId: 123,
        nonce,
        type: 2,
        to: receiver,
        value,
        gasLimit: 21000,
        maxFeePerGas: 3,
        maxPriorityFeePerGas: 1,
      });
    const submit = async (bytes: string) => {
      const boundary = captureEvmSubmission(
        owner,
        () => {
          if (lane === 'approved dapp') authorize();
        },
        () => wallet.captureEvmSignedSubmission(sdkKeyring, owner)
      );
      const broadcast: Parameters<
        typeof submitSignedEvmTransaction<string | null>
      >[1] = ({ rawTransaction, admit }) => admit(() => send(rawTransaction));
      const unsigned = Transaction.from(bytes).unsignedSerialized;
      return type === KeyringAccountType.Ledger ||
        type === KeyringAccountType.Trezor
        ? submitSignedHardwareEvmTransaction(
            bytes,
            broadcast,
            boundary,
            undefined,
            unsigned,
            async () => undefined
          )
        : submitSignedEvmTransaction(
            bytes,
            broadcast,
            boundary,
            undefined,
            unsigned
          );
    };
    const first = await sign(0, 1);
    const next = await sign(4, 2);
    const firstHash = Transaction.from(first).hash!;
    await expect(submit(first)).resolves.toBe(firstHash);
    await expect(submit(next)).resolves.toBe(Transaction.from(next).hash);
    const conflict = {
      code: 'EVM_SIGNED_RECORD_NONCE_CONFLICT',
      transactionNotBroadcast: true,
      recoveryHash: firstHash,
    };
    await expect(submit(await sign(0, 3))).rejects.toMatchObject(conflict);
    await expect(submit(first)).rejects.toMatchObject(conflict);
    expect(
      send.mock.calls.map(([bytes]) => Transaction.from(bytes).nonce)
    ).toEqual([0, 4]);
    if (lane === 'approved dapp') expect(authorize).toHaveBeenCalled();
  }
);

it('normal shared SDK submission rejects a network request epoch change after persistence', async () => {
  const lifecycle = wallet.captureEvmSignedSubmission(keyring, context);
  const boundary = captureEvmSubmission(
    context,
    () => undefined,
    () => lifecycle
  );
  const entered = deferred(),
    released = deferred();
  records.append.mockImplementationOnce(async () => {
    entered.resolve();
    await released.promise;
  });
  const dispatch = jest.fn(async (bytes: string) => {
    expect(bytes).toBe(raw);
    return entry.hash;
  });
  const pending = submitSignedEvmTransaction(
    raw,
    ({ rawTransaction, admit }) => admit(() => dispatch(rawTransaction)),
    boundary,
    () => undefined,
    Transaction.from(raw).unsignedSerialized
  );
  const rejected = expect(pending).rejects.toThrow();
  await entered.promise;
  wallet.networkRequestGeneration += 2;
  released.resolve();
  await rejected;
  expect(records.append).toHaveBeenCalledTimes(1);
  expect(dispatch).not.toHaveBeenCalled();
});

it.each([false, true])(
  'uses the final funds phase or empty-self code check when self=%s',
  async (self) => {
    const replacement = self
      ? await signer.signTransaction({
          type: 2,
          chainId: 123,
          nonce: 0,
          to: signer.address,
          value: 0,
          gasLimit: 42000,
          maxFeePerGas: 4,
          maxPriorityFeePerGas: 2,
        })
      : raw;
    const speedUp = {
      ...context,
      operation: 'speed-up' as const,
      originalHash: entry.hash,
    };
    const lifecycle = wallet.captureEvmSignedSubmission(keyring, speedUp);
    const boundary = captureEvmSubmission(
      speedUp,
      () => undefined,
      () => lifecycle
    );
    const phaseChecks = jest.fn(async () => {
      expect(await provider.liveChainRead()).toBe('0x7b');
    });
    Object.assign(provider, { verifyConfiguredChainId: phaseChecks });
    provider.send.mockImplementation(async (method) => {
      if (method === 'eth_getTransactionCount') return '0x0';
      if (method === 'eth_getCode') return '0xef0100' + '33'.repeat(20);
      if (method === 'eth_getBalance') return '0x100000';
      if (method === 'eth_getBlockByNumber')
        return {
          number: '0x1',
          hash: '0x' + '55'.repeat(32),
          baseFeePerGas: '0x1',
          gasLimit: '0x100000',
        };
      throw Error('Unexpected RPC');
    });
    const dispatch = jest.fn(async (bytes: string) => {
      expect(bytes).toBe(replacement);
      return entry.hash;
    });
    const submit = submitSignedEvmTransaction(
      replacement,
      ({ rawTransaction, admit }) => admit(() => dispatch(rawTransaction)),
      boundary,
      undefined,
      Transaction.from(replacement).unsignedSerialized
    );
    if (self) {
      await expect(submit).rejects.toThrow(
        'Unable to verify a code-free cancellation payer'
      );
      expect(provider.liveChainRead).toHaveBeenCalledTimes(1);
      expect(dispatch).not.toHaveBeenCalled();
    } else {
      await expect(submit).resolves.toBe(entry.hash);
      expect(phaseChecks).toHaveBeenCalledTimes(2);
      expect(provider.liveChainRead).toHaveBeenCalledTimes(2);
      expect(provider.send.mock.calls.map(([method]) => method)).toEqual([
        'eth_getBlockByNumber',
        'eth_getTransactionCount',
        'eth_getTransactionCount',
        'eth_getBalance',
        'eth_getBalance',
        'eth_getBlockByNumber',
      ]);
      expect(dispatch).toHaveBeenCalledTimes(1);
    }
  }
);

it.each([1, 2])(
  'preserves a valid access list on a ready type %s self fee replacement',
  async (type) => {
    const replacement = await signer.signTransaction({
      type,
      chainId: 123,
      nonce: 0,
      to: signer.address,
      value: 0,
      gasLimit: 42000,
      ...(type === 1
        ? { gasPrice: 4 }
        : { maxFeePerGas: 4, maxPriorityFeePerGas: 2 }),
      accessList: [
        { address: signer.address, storageKeys: ['0x' + '01'.repeat(32)] },
      ],
    });
    const speedUp = {
      ...context,
      operation: 'speed-up' as const,
      originalHash: entry.hash,
    };
    const lifecycle = wallet.captureEvmSignedSubmission(keyring, speedUp);
    const boundary = captureEvmSubmission(
      speedUp,
      () => undefined,
      () => lifecycle
    );
    provider.verifyConfiguredChainId = jest.fn(async () => {
      expect(await provider.liveChainRead()).toBe('0x7b');
    });
    provider.send.mockImplementation(async (method) => {
      if (method === 'eth_getTransactionCount') return '0x0';
      if (method === 'eth_getCode') return '0x';
      throw Error('Unexpected RPC');
    });
    const hash = Transaction.from(replacement).hash;
    const dispatch = jest.fn(async (bytes: string) => {
      expect(bytes).toBe(replacement);
      return hash;
    });
    await expect(
      submitSignedEvmTransaction(
        replacement,
        ({ rawTransaction, admit }) => admit(() => dispatch(rawTransaction)),
        boundary,
        undefined,
        Transaction.from(replacement).unsignedSerialized
      )
    ).resolves.toBe(hash);
    expect(dispatch).toHaveBeenCalledWith(replacement);
    expect(provider.liveChainRead).toHaveBeenCalledTimes(2);
  }
);

it('rejects a Smart speed-up with failed frozen execution before broadcast', async () => {
  const operation = buildSmartAccountUserOperation({
    sender: receiver,
    nonce: '0',
    callData: '0x',
  });
  const replacement = await signer.signTransaction({
    type: 2,
    chainId: 123,
    nonce: 0,
    to: getPaliEntryPointAddress(123),
    value: 0,
    data: paliEntryPointInterface.encodeFunctionData('handleOps', [
      [operation],
      signer.address,
    ]),
    gasLimit: 200000,
    maxFeePerGas: 4,
    maxPriorityFeePerGas: 2,
  });
  const speedUp = {
    ...context,
    operation: 'speed-up' as const,
    originalHash: entry.hash,
  };
  const lifecycle = wallet.captureEvmSignedSubmission(keyring, speedUp);
  const boundary = captureEvmSubmission(
    speedUp,
    () => undefined,
    () => lifecycle
  );
  provider.verifyConfiguredChainId = jest.fn(async () => undefined);
  provider.send.mockImplementation(async (method, params) => {
    if (method === 'eth_getTransactionCount') return '0x0';
    if (method === 'eth_getBalance') return '0x10000000';
    if (method === 'eth_getBlockByNumber')
      return {
        number: '0x1',
        hash: '0x' + '55'.repeat(32),
        baseFeePerGas: '0x1',
        gasLimit: '0x100000',
      };
    if (method === 'eth_simulateV1') {
      const transactions = (params[0] as any).blockStateCalls[0].calls;
      return [
        {
          number: '0x2',
          parentHash: '0x' + '55'.repeat(32),
          transactions: transactions.map((tx: any) => ({
            ...tx,
            input: tx.data,
          })),
          calls: [{ status: '0x0', gasUsed: '0x100', logs: [] }],
        },
      ];
    }
    throw Error('Unexpected RPC');
  });
  const dispatch = jest.fn(
    async (bytes: string) => Transaction.from(bytes).hash!
  );
  await expect(
    submitSignedEvmTransaction(
      replacement,
      ({ rawTransaction, admit }) => admit(() => dispatch(rawTransaction)),
      boundary,
      undefined,
      Transaction.from(replacement).unsignedSerialized
    )
  ).rejects.toThrow('Unable to verify smart account execution');
  expect(
    provider.send.mock.calls.filter(([method]) => method === 'eth_simulateV1')
  ).toHaveLength(1);
  expect(dispatch).not.toHaveBeenCalled();
});

it.each(['latest', 'pending', 'consumed', 'queued', 'ready'])(
  'handles %s after durable cancellation persistence through the installed SDK',
  async (blocked) => {
    const cancelContext = {
      ...context,
      operation: 'cancel' as const,
      originalHash: entry.hash,
    };
    const cancellation = await signer.signTransaction({
      type: 2,
      chainId: 123,
      nonce: 0,
      to: signer.address,
      value: 0,
      gasLimit: 42000,
      maxFeePerGas: 4,
      maxPriorityFeePerGas: 2,
    });
    const lifecycle = wallet.captureEvmSignedSubmission(keyring, cancelContext);
    const boundary = captureEvmSubmission(
      cancelContext,
      () => undefined,
      () => lifecycle
    );
    provider.verifyConfiguredChainId = jest.fn(async () => {
      expect(await provider.liveChainRead()).toBe('0x7b');
    });
    const entered = deferred(),
      released = deferred();
    records.append.mockImplementationOnce(async () => {
      entered.resolve();
      await released.promise;
    });
    const waitingInQueue = deferred(),
      admitWrite = deferred();
    let delegated = false;
    if (blocked === 'queued') {
      records.withReplayAdmission.mockImplementationOnce(
        async (_session, _target, admit, _predecessor, preflight) => {
          waitingInQueue.resolve();
          await admitWrite.promise;
          await runReplayPreflight(preflight);
          return await admit([]);
        }
      );
    }
    provider.send.mockImplementation(async (method, [, tag]) => {
      if (method === 'eth_getTransactionCount')
        return blocked === 'consumed' ? '0x1' : '0x0';
      if (method === 'eth_getBalance') return '0xffffff';
      expect(method).toBe('eth_getCode');
      return tag === blocked || (delegated && tag === 'latest')
        ? `0xef0100${'33'.repeat(20)}`
        : '0x';
    });
    const dispatch = jest.fn(async (bytes: string) => {
      expect(bytes).toBe(cancellation);
      return entry.hash;
    });
    const result = submitSignedEvmTransaction(
      cancellation,
      ({ rawTransaction, admit }) => admit(() => dispatch(rawTransaction)),
      boundary,
      undefined,
      Transaction.from(cancellation).unsignedSerialized
    ).catch((error) => error);
    await entered.promise;
    expect(provider.send).not.toHaveBeenCalled();
    released.resolve();
    if (blocked === 'queued') {
      await waitingInQueue.promise;
      expect(provider.send).not.toHaveBeenCalled();
      delegated = true;
      admitWrite.resolve();
    }
    const outcome = await result;
    if (blocked === 'ready') {
      expect(outcome).toBe(entry.hash);
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith(cancellation);
    } else {
      expect(outcome).toBeInstanceOf(Error);
      expect(evmSubmissionFailure(outcome)).toEqual({
        transactionNotBroadcast: true,
        signedTransactionHash: Transaction.from(cancellation).hash,
      });
      expect(dispatch).not.toHaveBeenCalled();
    }
    expect(provider.send.mock.calls).toEqual([
      ['eth_getTransactionCount', [signer.address, 'latest']],
      ['eth_getBalance', [signer.address, 'latest']],
      ...(blocked === 'consumed'
        ? []
        : [
            ['eth_getCode', [signer.address, 'latest']],
            ['eth_getCode', [signer.address, 'pending']],
          ]),
    ]);
  }
);
it('existing setActiveNetwork request epochs revoke a captured lifecycle even before a network value changes', async () => {
  const lifecycle = wallet.captureEvmSignedSubmission(keyring, context),
    navigation = getWalletNavigationScope();
  wallet.stopAllRapidPolling = jest.fn(() => {
    throw Error('Stop after request admission');
  });
  await expect(
    wallet.setActiveNetwork({ ...context.network, chainId: 124 })
  ).rejects.toThrow('Stop after request admission');
  await expect(wallet.setActiveNetwork({ ...context.network })).rejects.toThrow(
    'Stop after request admission'
  );
  expect(wallet.networkRequestGeneration).toBe(13);
  expect(getWalletNavigationScope()).toEqual(navigation);
  expect(() => lifecycle.assertCurrent()).toThrow();
});

// Exercise the controller entry points for single dapp requests and EOA batches.
describe('dapp automatic nonce recommendation', () => {
  function nonceFixture({
    pending = 0,
    retained = [] as any[],
    observed: pendingObserved = false,
  } = {}) {
    mockState.vault.accountTransactions = {
      HDAccount: { 0: { ethereum: { 123: [] } } },
    };
    const assertCurrent = jest.fn(() => undefined);
    const session = { keyring, assertCurrent };
    wallet.capturePrivateVaultSession = jest.fn(() => session);
    wallet.assertWalletReadyForSigning = jest.fn();
    const hash = entry.hash;
    const rpc = provider as any;
    rpc.signal = new AbortController().signal;
    rpc.verifyConfiguredChainId = jest.fn(async () => undefined);
    rpc.getTransactionCount = jest.fn(async (address: string, tag: string) => {
      expect(address).toBe(signer.address);
      return tag === 'latest' ? 0 : pending;
    });
    rpc.send = jest.fn(async (method: string, params: unknown[]) => {
      if (method === 'eth_chainId') return '0x7b';
      if (method === 'eth_getBlockByNumber')
        return { number: '0x10', hash: '0x' + 'a'.repeat(64) };
      if (method === 'eth_getTransactionCount')
        return params[1] === 'pending' ? `0x${pending.toString(16)}` : '0x0';
      if (method === 'eth_getTransactionByHash')
        return pendingObserved && params[0] === hash
          ? {
              hash,
              from: signer.address,
              nonce: '0x0',
              blockHash: null,
              blockNumber: null,
              transactionIndex: null,
            }
          : null;
      throw Error('Unexpected fixture RPC');
    });
    records.listSender = jest.fn(async () => retained);
    records.autoNonceAcceptance = new EvmAutoNonceAcceptance();
    records.captureAutoNonceSnapshot = jest.fn(async () => ({
      owner: 'nonce-review-fixture',
      minimumNonce: 0,
      retained,
      readMaximumCost: async () => BigInt(21000),
      readAssetDebit: async () => BigInt(0),
    }));
    // Compatible with the same captured-route helper used by the reviewed
    // native/token paths, while all requests remain synthetic and local.
    wallet.captureFreshEvmRead = jest.fn(() => ({
      keyring,
      network: context.network,
      assertCurrent,
      run: (work: (freshProvider: any) => unknown) => work(rpc),
    }));
    return { rpc, retained };
  }

  it('starts both single dapp and batch recommendations after an external pending nonce', async () => {
    const { rpc } = nonceFixture({ pending: 1 });
    await expect(wallet.getRecommendedEvmNonce(signer.address)).resolves.toBe(
      1
    );
    await expect(
      wallet.getRecommendedNonceForBatch(signer.address)
    ).resolves.toBe(1);
    expect(
      rpc.send.mock.calls.some(
        ([method, params]: [string, string[]]) =>
          method === 'eth_getTransactionCount' && params[1] === 'pending'
      ) ||
        rpc.getTransactionCount.mock.calls.some(
          (call: [string, string]) => call[1] === 'pending'
        )
    ).toBe(true);
  });

  it('does not recommend a nonce beyond an unseen dropped signed predecessor', async () => {
    const predecessor = {
      chainId: '123',
      from: signer.address,
      hash: entry.hash,
      nonce: 0,
      phase: 'signed',
    };
    const { rpc } = nonceFixture({ pending: 0, retained: [predecessor] });
    await expect(
      wallet.getRecommendedEvmNonce(signer.address)
    ).rejects.toThrow();
    await expect(
      wallet.getRecommendedNonceForBatch(signer.address)
    ).rejects.toThrow();
    expect(
      rpc.send.mock.calls.filter(
        ([method]: [string]) => method === 'eth_sendRawTransaction'
      )
    ).toHaveLength(0);
  });

  it('can advance over a same-endpoint observed pending predecessor despite lagging counts', async () => {
    const predecessor = {
      chainId: '123',
      from: signer.address,
      hash: entry.hash,
      nonce: 0,
      phase: 'signed',
    };
    nonceFixture({ pending: 0, retained: [predecessor], observed: true });
    await expect(wallet.getRecommendedEvmNonce(signer.address)).resolves.toBe(
      1
    );
  });
});

it.each(['erc20', 'erc721', 'erc1155'] as const)(
  'refuses a %s submission boundary without an explicit reviewed nonce',
  (operation) => {
    expect(() =>
      captureEvmSubmission(
        { ...context, operation },
        () => undefined,
        () =>
          wallet.captureEvmSignedSubmission(keyring, { ...context, operation })
      )
    ).toThrow('PALI_TRANSACTION_CONTEXT_CHANGED');
    expect(records.append).not.toHaveBeenCalled();
    expect(provider.send).not.toHaveBeenCalledWith(
      'eth_sendRawTransaction',
      expect.anything()
    );
  }
);

it.each(['send', 'erc20', 'erc721', 'erc1155'] as const)(
  'uses the authenticated %s operation for held asset verification',
  async (operation) => {
    const sdkKeyring = Object.assign(
      Object.create(SoftwareKeyring.prototype),
      keyring,
      {
        sessionPassword: { isCleared: () => false },
        sessionMnemonic: { isCleared: () => false },
        privateRecordSessionRevision: 0,
        getDecryptedMnemonic: () => 'Public journal nonce test fixture',
      }
    );
    wallet.getActiveKeyring.mockReturnValue(sdkKeyring);
    let saved: string | undefined;
    const journal = new EvmSignedRecords({
      async read() {
        return saved;
      },
      async compareAndSet(_id, expected, next, assertCurrent) {
        assertCurrent();
        if (saved !== expected) return false;
        saved = next;
        return true;
      },
    });
    wallet.getRetainedEvmRecords.mockReturnValue(journal);
    wallet.captureFreshEvmRead = jest.fn(() => ({
      keyring: sdkKeyring,
      network: context.network,
      assertCurrent: () => undefined,
    }));
    const inspect = jest
      .spyOn(wallet, 'inspectOrdinaryEvmNonce')
      .mockResolvedValue({ nonce: 0 });
    const abi = new Interface([
      'function transferFrom(address,address,uint256)',
      'function safeTransferFrom(address,address,uint256,uint256,bytes)',
    ]);
    const data =
      operation === 'erc20'
        ? encodeErc20Transfer(receiver, '1')
        : operation === 'erc721'
        ? abi.encodeFunctionData('transferFrom', [signer.address, receiver, 1])
        : operation === 'erc1155'
        ? abi.encodeFunctionData('safeTransferFrom', [
            signer.address,
            receiver,
            1,
            1,
            '0x',
          ])
        : '0x1234';
    const signed = await signer.signTransaction({
      type: 2,
      chainId: 123,
      nonce: 0,
      to: receiver,
      value: 0,
      data,
      gasLimit: 42000,
      maxFeePerGas: 3,
      maxPriorityFeePerGas: 1,
    });
    const approved = {
      ...context,
      operation,
      walletNonce: { nonce: 0, source: 'automatic' as const },
    };
    const boundary = captureEvmSubmission(
      approved,
      () => undefined,
      () => wallet.captureEvmSignedSubmission(sdkKeyring, approved)
    );
    const broadcast = jest.fn(
      async (bytes: string) => Transaction.from(bytes).hash
    );
    await expect(
      submitSignedEvmTransaction(
        signed,
        ({ rawTransaction, admit }) => admit(() => broadcast(rawTransaction)),
        boundary,
        undefined,
        Transaction.from(signed).unsignedSerialized
      )
    ).resolves.toBe(Transaction.from(signed).hash);
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(inspect).toHaveBeenCalledWith(
      expect.anything(),
      signer.address,
      expect.objectContaining({ reviewed: { nonce: 0, source: 'automatic' } })
    );
    const options = inspect.mock.calls[0][2];
    if (operation === 'send') expect(options).not.toHaveProperty('asset');
    else
      expect(options).toMatchObject({
        asset: { type: operation.toUpperCase() },
      });
    expect(options).not.toHaveProperty('protectedAssetContract');
    expect(options).not.toHaveProperty('protectedAssetPolicy');
  }
);

it.each([
  'unchanged',
  'pending count',
  'legacy pending',
  'lock',
  'account',
  'network',
])(
  'checks automatic dapp submission with %s before dispatch',
  async (change) => {
    const sdkKeyring = Object.assign(
      Object.create(SoftwareKeyring.prototype),
      keyring,
      {
        sessionPassword: { isCleared: () => false },
        sessionMnemonic: { isCleared: () => false },
        privateRecordSessionRevision: 0,
        getDecryptedMnemonic: () => 'Public journal nonce test fixture',
      }
    );
    wallet.getActiveKeyring.mockReturnValue(sdkKeyring);
    let saved: string | undefined;
    const journal = new EvmSignedRecords({
      async read() {
        return saved;
      },
      async compareAndSet(_id, expected, next, assertCurrent) {
        assertCurrent();
        if (saved !== expected) return false;
        saved = next;
        return true;
      },
    });
    wallet.getRetainedEvmRecords.mockReturnValue(journal);
    const admission = jest.spyOn(journal, 'withReplayAdmission');
    const legacyHash = `0x${'ab'.repeat(32)}`;
    if (change === 'legacy pending')
      mockState.vault.accountTransactions.HDAccount[0].ethereum[123][0].hash =
        legacyHash;
    const rpc = {
      signal: new AbortController().signal,
      verifyConfiguredChainId: jest.fn(async () => undefined),
      send: jest.fn(async (method: string, params: unknown[]) => {
        if (method === 'eth_getBlockByNumber')
          return {
            number: '0x10',
            hash: '0x' + 'a'.repeat(64),
            gasLimit: '0x1c9c380',
            baseFeePerGas: '0x1',
          };
        if (method === 'eth_estimateGas') return '0x5208';
        if (method === 'eth_getTransactionCount')
          return params[1] === 'pending' && change === 'pending count'
            ? '0x1'
            : '0x0';
        if (method === 'eth_getBalance') return '0xde0b6b3a7640000';
        if (
          method === 'eth_getTransactionByHash' &&
          change === 'legacy pending'
        )
          return {
            hash: legacyHash,
            from: signer.address,
            nonce: '0x0',
            chainId: '0x7b',
            blockHash: null,
            blockNumber: null,
            transactionIndex: null,
          };
        throw Error('Unexpected fixture RPC');
      }),
    };
    wallet.captureFreshEvmRead = jest.fn(() => ({
      keyring: sdkKeyring,
      network: context.network,
      overrides: {},
      assertCurrent: () => undefined,
      run: (work: (freshProvider: typeof rpc) => unknown) => work(rpc),
    }));
    const approved = {
      ...context,
      walletNonce: { nonce: 0, source: 'automatic' as const },
    };
    const boundary = captureEvmSubmission(
      approved,
      () => undefined,
      () => wallet.captureEvmSignedSubmission(sdkKeyring, approved)
    );
    const broadcast = jest.fn(
      async (bytes: string) => Transaction.from(bytes).hash
    );
    if (change === 'lock') keyring.isUnlocked.mockReturnValue(false);
    if (change === 'account') mockState.vault.activeAccount.id = 1;
    if (change === 'network')
      mockState.vault.activeNetwork.url = 'https://changed.invalid';
    const submit = submitSignedEvmTransaction(
      raw,
      ({ rawTransaction, admit }) => admit(() => broadcast(rawTransaction)),
      boundary,
      undefined,
      Transaction.from(raw).unsignedSerialized
    );
    if (change === 'unchanged') {
      await expect(submit).resolves.toBe(Transaction.from(raw).hash);
      expect(broadcast).toHaveBeenCalledTimes(1);
      expect(admission).toHaveBeenCalledTimes(1);
      expect(saved).toBeDefined();
    } else {
      const message =
        change === 'pending count'
          ? 'The account nonce changed. Review this transfer again.'
          : change === 'legacy pending'
          ? 'A previous transaction is still pending. Check Activity before trying again.'
          : change === 'lock'
          ? 'Wallet session changed. Unlock the wallet and try again.'
          : 'PALI_TRANSACTION_CONTEXT_CHANGED';
      await expect(submit).rejects.toThrow(message);
      expect(broadcast).not.toHaveBeenCalled();
      if (change === 'pending count' || change === 'legacy pending') {
        expect(saved).toBeDefined();
        expect(admission).toHaveBeenCalledTimes(1);
        expect(rpc.send).toHaveBeenCalledWith('eth_getTransactionCount', [
          signer.address,
          'pending',
        ]);
        if (change === 'legacy pending')
          expect(rpc.send).toHaveBeenCalledWith('eth_getTransactionByHash', [
            legacyHash,
          ]);
      } else {
        expect(admission).not.toHaveBeenCalled();
      }
    }
  }
);

describe('legacy pending guard in the shared nonce inspector', () => {
  const install = (pending: number, pendingLookup: unknown) => {
    const assertCurrent = jest.fn();
    const rpc = {
      signal: new AbortController().signal,
      verifyConfiguredChainId: jest.fn(async () => undefined),
      send: jest.fn(async (method: string, params: unknown[]) => {
        if (method === 'eth_getBlockByNumber')
          return { number: '0x10', hash: '0x' + 'a'.repeat(64) };
        if (method === 'eth_getTransactionCount')
          return params[1] === 'pending' ? `0x${pending.toString(16)}` : '0x0';
        if (method === 'eth_getTransactionByHash') return pendingLookup;
        throw Error(`Unexpected RPC: ${method}`);
      }),
    };
    const read = {
      keyring,
      network: context.network,
      assertCurrent,
      run: (work: (freshProvider: any) => unknown) => work(rpc),
    };
    const snapshot = {
      owner: 'legacy-test',
      minimumNonce: 0,
      retained: [],
      readMaximumCost: async () => BigInt(0),
      readAssetDebit: async () => BigInt(0),
    };
    records.autoNonceAcceptance = new EvmAutoNonceAcceptance();
    records.captureAutoNonceSnapshot = jest.fn(async () => snapshot);
    wallet.captureFreshEvmRead = jest.fn(() => read);
    return { rpc, read, snapshot };
  };
  it('checks the same candidate at quote and when a held snapshot is supplied', async () => {
    const legacyPendingTx = {
      hash: entry.hash,
      from: signer.address,
      nonce: '0x0',
      chainId: '0x7b',
      blockHash: null,
      blockNumber: null,
      transactionIndex: null,
    };
    const { read, snapshot } = install(0, legacyPendingTx);
    await expect(wallet.getRecommendedEvmNonce(signer.address)).rejects.toThrow(
      'A previous transaction is still pending'
    );
    await expect(
      wallet.inspectOrdinaryEvmNonce(read, signer.address, {
        snapshot,
        reviewed: { nonce: 0, source: 'automatic' },
      })
    ).rejects.toThrow('A previous transaction is still pending');
  });
  it('lets the pending count account for the predecessor and preserves explicit manual nonce policy', async () => {
    const legacyPendingTx = {
      hash: entry.hash,
      from: signer.address,
      nonce: '0x0',
      chainId: '0x7b',
      blockHash: null,
      blockNumber: null,
      transactionIndex: null,
    };
    const { rpc, read, snapshot } = install(1, legacyPendingTx);
    await expect(wallet.getRecommendedEvmNonce(signer.address)).resolves.toBe(
      1
    );
    await expect(
      wallet.inspectOrdinaryEvmNonce(read, signer.address, {
        snapshot,
        reviewed: { nonce: 0, source: 'manual' },
      })
    ).resolves.toMatchObject({ nonce: 0 });
    expect(
      rpc.send.mock.calls.filter(
        ([method]) => method === 'eth_getTransactionByHash'
      )
    ).toHaveLength(0);
  });
});

describe('worker-owned token state at review and initial held POST', () => {
  const token = '0x' + '3'.repeat(40);
  const blockHash = '0x' + 'a'.repeat(64);
  const word = (n: bigint) => `0x${n.toString(16).padStart(64, '0')}`;
  function rpcFixture(
    options: {
      advanceAfterBlock?: boolean;
      onLatest?: () => void;
      pendingPredecessor?: boolean;
      staleBalance?: boolean;
    } = {}
  ) {
    const controller = new AbortController();
    let latestReads = 0;
    const rpc = {
      signal: controller.signal,
      verifyConfiguredChainId: jest.fn(async () => undefined),
      send: jest.fn(async (method: string, params: unknown[]) => {
        if (method === 'eth_getBlockByNumber')
          return { number: '0x10', hash: blockHash };
        if (method === 'eth_getCode') return '0x6000';
        if (method === 'eth_getTransactionCount') {
          if (params[1] === 'pending' && options.pendingPredecessor)
            return '0x1';
          if (params[1] === 'latest') {
            options.onLatest?.();
            latestReads++;
            return options.advanceAfterBlock && latestReads > 0 ? '0x1' : '0x0';
          }
          return '0x0';
        }
        if (method === 'eth_call') {
          const tx = params[0] as { from?: string };
          return tx.from
            ? word(BigInt(1))
            : word(options.staleBalance ? BigInt(1) : BigInt(100));
        }
        if (method === 'eth_getBalance') return '0xde0b6b3a7640000';
        if (method === 'eth_getTransactionByHash') return null;
        throw Error('Unexpected fixture RPC ' + method);
      }),
    };
    return rpc;
  }
  function configuredRead(
    rpc: ReturnType<typeof rpcFixture>,
    sdkKeyring: unknown
  ) {
    return {
      keyring: sdkKeyring,
      network: context.network,
      assertCurrent: () => undefined,
      run: (work: (fresh: typeof rpc) => unknown) => work(rpc),
    };
  }
  function tokenPayload() {
    return {
      type: 'ERC20' as const,
      transaction: {
        networkUrl: context.network.url,
        receiver,
        tokenAddress: token,
        tokenAmountUnits: '60',
        gasLimit: '42000',
        isLegacy: false as const,
        maxFeePerGas: '3',
        maxPriorityFeePerGas: '1',
      },
    };
  }
  it('validates the captured exact token request and rejects stale holdings before review', async () => {
    mockState.vault.accountTransactions.HDAccount[0].ethereum[123] = [];
    const good = rpcFixture();
    records.captureAutoNonceSnapshot = jest.fn(async () => ({
      owner: 'unit',
      minimumNonce: 0,
      retained: [],
      readMaximumCost: async () => BigInt(0),
      readAssetDebit: async () => BigInt(0),
    }));
    records.autoNonceAcceptance = new EvmAutoNonceAcceptance();
    const read = configuredRead(good, keyring);
    const result = await wallet.inspectOrdinaryEvmNonce(read, signer.address, {
      asset: tokenPayload(),
    });
    expect(result.nonce).toBe(0);
    const call = good.send.mock.calls.find(
      ([method, args]) =>
        method === 'eth_call' && Boolean((args[0] as { from?: string }).from)
    );
    expect(call?.[1][0]).toMatchObject({
      from: signer.address,
      to: token,
      gas: '0xa410',
      nonce: '0x0',
      type: '0x2',
      maxFeePerGas: '0x3',
      maxPriorityFeePerGas: '0x1',
    });
    expect(good.verifyConfiguredChainId).toHaveBeenCalledTimes(2);
    expect(good.verifyConfiguredChainId).toHaveBeenNthCalledWith(1, true);
    expect(good.verifyConfiguredChainId).toHaveBeenNthCalledWith(2, true);
    const simulationIndex = good.send.mock.calls.findIndex(
      ([method, args]) =>
        method === 'eth_call' && Boolean((args[0] as { from?: string }).from)
    );
    expect(
      good.verifyConfiguredChainId.mock.invocationCallOrder[1]
    ).toBeGreaterThan(good.send.mock.invocationCallOrder[simulationIndex]);
    expect(good.send).toHaveBeenLastCalledWith('eth_getTransactionCount', [
      signer.address,
      'latest',
    ]);
    expect(
      good.send.mock.calls.filter(
        ([method, args]) =>
          method === 'eth_getBlockByNumber' && args[0] === '0x10'
      )
    ).toHaveLength(1);
    expect(
      good.send.mock.calls.filter(
        ([method, args]) =>
          method === 'eth_getTransactionCount' && args[1] === '0x10'
      )
    ).toHaveLength(1);
    const bad = rpcFixture({ staleBalance: true });
    await expect(
      wallet.inspectOrdinaryEvmNonce(
        configuredRead(bad, keyring),
        signer.address,
        { asset: tokenPayload() }
      )
    ).rejects.toMatchObject({ transactionNotBroadcast: true });
  });
  it('rejects a same-sender nonce advancement after asset simulation and before review', async () => {
    const rpc = rpcFixture({ advanceAfterBlock: true });
    records.captureAutoNonceSnapshot = jest.fn(async () => ({
      owner: 'unit',
      minimumNonce: 0,
      retained: [],
      readMaximumCost: async () => BigInt(0),
      readAssetDebit: async () => BigInt(0),
    }));
    records.autoNonceAcceptance = new EvmAutoNonceAcceptance();
    await expect(
      wallet.inspectOrdinaryEvmNonce(
        configuredRead(rpc, keyring),
        signer.address,
        { asset: tokenPayload() }
      )
    ).rejects.toMatchObject({ transactionNotBroadcast: true });
  });
  it.each([
    { scenario: 'healthy', staleBalance: false, fault: 'none' },
    { scenario: 'stale holdings', staleBalance: true, fault: 'unsent' },
    { scenario: 'queued sufficient', staleBalance: false, fault: 'none' },
    { scenario: 'queued overcommit', staleBalance: false, fault: 'unsent' },
    {
      scenario: 'plain nonce RPC failure',
      staleBalance: false,
      fault: 'unsent',
    },
    {
      scenario: 'wallet session revoked',
      staleBalance: false,
      fault: 'revoked',
    },
  ] as const)(
    'actual signed-token journal admission: $scenario',
    async ({ scenario, staleBalance, fault }) => {
      const sdkKeyring = Object.assign(
        Object.create(SoftwareKeyring.prototype),
        keyring,
        {
          sessionPassword: { isCleared: () => false },
          sessionMnemonic: { isCleared: () => false },
          privateRecordSessionRevision: 0,
          getDecryptedMnemonic: () => 'Public journal nonce test fixture',
        }
      );
      wallet.getActiveKeyring.mockReturnValue(sdkKeyring);
      let saved: string | undefined;
      const journal = new EvmSignedRecords({
        async read() {
          return saved;
        },
        async compareAndSet(_id, expected, next, assertCurrent) {
          assertCurrent();
          if (saved !== expected) return false;
          saved = next;
          return true;
        },
      });
      wallet.getRetainedEvmRecords.mockReturnValue(journal);
      const onLatest =
        scenario === 'plain nonce RPC failure'
          ? () => {
              throw new Error('synthetic private provider error');
            }
          : scenario === 'wallet session revoked'
          ? () => {
              wallet.walletSessionGeneration++;
              throw new Error('synthetic private provider error');
            }
          : undefined;
      const pendingPredecessor = scenario.startsWith('queued');
      const candidateNonce = pendingPredecessor ? 1 : 0;
      const rpc = rpcFixture({
        staleBalance,
        pendingPredecessor,
        ...(onLatest ? { onLatest } : {}),
      });
      wallet.captureFreshEvmRead = jest.fn(() =>
        configuredRead(rpc, sdkKeyring)
      );
      const tokenContext = {
        ...context,
        operation: 'erc20' as const,
        walletNonce: { nonce: candidateNonce, source: 'automatic' as const },
      };
      const signed = await signer.signTransaction({
        type: 2,
        chainId: 123,
        nonce: candidateNonce,
        to: token,
        value: 0,
        data: encodeErc20Transfer(receiver, '60'),
        gasLimit: 42000,
        maxFeePerGas: 3,
        maxPriorityFeePerGas: 1,
      });
      if (pendingPredecessor) {
        const predecessorRaw = await signer.signTransaction({
          type: 2,
          chainId: 123,
          nonce: 0,
          to: token,
          value: 0,
          data: encodeErc20Transfer(
            receiver,
            scenario === 'queued overcommit' ? '41' : '40'
          ),
          gasLimit: 42000,
          maxFeePerGas: 3,
          maxPriorityFeePerGas: 1,
        });
        const predecessor = Transaction.from(predecessorRaw);
        const session = { keyring: sdkKeyring, assertCurrent: () => undefined };
        await journal.append(session, {
          context: {
            ...tokenContext,
            walletNonce: { nonce: 0, source: 'automatic' },
          },
          rawTransaction: predecessorRaw,
          hash: predecessor.hash!,
          from: signer.address,
          chainId: '123',
          nonce: 0,
          type: predecessor.type,
        });
        await journal.updatePhase(
          session,
          '123',
          signer.address,
          predecessor.hash!,
          'submitted'
        );
      }
      const boundary = captureEvmSubmission(
        tokenContext,
        () => undefined,
        () => wallet.captureEvmSignedSubmission(sdkKeyring, tokenContext)
      );
      const broadcast = jest.fn(
        async (bytes: string) => Transaction.from(bytes).hash
      );
      const submit = submitSignedEvmTransaction(
        signed,
        ({ rawTransaction, admit }) => admit(() => broadcast(rawTransaction)),
        boundary,
        undefined,
        Transaction.from(signed).unsignedSerialized
      );
      if (fault !== 'none') {
        const failure = await submit.then(
          () => {
            throw new Error('unexpected POST');
          },
          (
            error: Error & { code?: string; transactionNotBroadcast?: boolean }
          ) => error
        );
        expect(failure).toMatchObject({ transactionNotBroadcast: true });
        expect(retainedEvmAssetPreflightConflict(failure)).toBeNull();
        if (fault === 'unsent') {
          expect(failure).toMatchObject({ code: 'EVM_ASSET_REVIEW_REQUIRED' });
          expect(failure.message).not.toContain(
            'synthetic private provider error'
          );
        }
        expect(broadcast).not.toHaveBeenCalled();
        const retained = await journal.readExact(
          { keyring: sdkKeyring, assertCurrent: () => undefined },
          '123',
          signer.address,
          Transaction.from(signed).hash!
        );
        if (fault === 'revoked') {
          expect(retained?.phase).toBe('signed');
        } else {
          expect(retained).toBeNull();
          await expect(
            journal.assertSpendingNonce(
              { keyring: sdkKeyring, assertCurrent: () => undefined },
              '123',
              signer.address,
              candidateNonce
            )
          ).resolves.toBeUndefined();
        }
      } else {
        await expect(submit).resolves.toBe(Transaction.from(signed).hash);
        expect(broadcast).toHaveBeenCalledTimes(1);
      }
      expect(saved).toBeDefined();
      const call = rpc.send.mock.calls.find(
        ([method, args]) =>
          method === 'eth_call' && Boolean((args[0] as { from?: string }).from)
      );
      if (
        fault === 'none' ||
        scenario === 'plain nonce RPC failure' ||
        scenario === 'wallet session revoked'
      )
        expect(call?.[1][0]).toMatchObject({
          from: signer.address,
          to: token,
          gas: '0xa410',
          nonce: pendingPredecessor ? '0x1' : '0x0',
          type: '0x2',
          maxFeePerGas: '0x3',
          maxPriorityFeePerGas: '0x1',
        });
      else expect(call).toBeUndefined();
      expect(rpc.verifyConfiguredChainId).toHaveBeenCalledWith(true);
    }
  );

  it.each(['sdk preflight failure', 'timeout', 'wire uncertain'] as const)(
    'classifies an authenticated token record at %s',
    async (scenario) => {
      const sdkKeyring = Object.assign(
        Object.create(SoftwareKeyring.prototype),
        keyring,
        {
          sessionPassword: { isCleared: () => false },
          sessionMnemonic: { isCleared: () => false },
          privateRecordSessionRevision: 0,
          getDecryptedMnemonic: () => 'Public journal nonce test fixture',
        }
      );
      wallet.getActiveKeyring.mockReturnValue(sdkKeyring);
      let saved: string | undefined;
      const journal = new EvmSignedRecords({
        async read() {
          return saved;
        },
        async compareAndSet(_id, expected, next, assertCurrent) {
          assertCurrent();
          if (
            saved !== expected ||
            (scenario === 'sdk preflight failure' && expected !== undefined)
          )
            return false;
          saved = next;
          return true;
        },
      });
      wallet.getRetainedEvmRecords.mockReturnValue(journal);
      const rpc = rpcFixture();
      wallet.captureFreshEvmRead = jest.fn(() =>
        configuredRead(rpc, sdkKeyring)
      );
      const tokenContext = {
        ...context,
        operation: 'erc20' as const,
        walletNonce: { nonce: 0, source: 'automatic' as const },
      };
      const signed = await signer.signTransaction({
        type: 2,
        chainId: 123,
        nonce: 0,
        to: token,
        value: 0,
        data: encodeErc20Transfer(receiver, '60'),
        gasLimit: 42000,
        maxFeePerGas: 3,
        maxPriorityFeePerGas: 1,
      });
      const boundary = captureEvmSubmission(
        tokenContext,
        () => undefined,
        () => wallet.captureEvmSignedSubmission(sdkKeyring, tokenContext)
      );
      const entered = deferred();
      const held = deferred();
      const broadcast = jest.fn(
        async (bytes: string) => Transaction.from(bytes).hash
      );
      if (scenario === 'timeout') jest.useFakeTimers();
      try {
        const submit = submitSignedEvmTransaction(
          signed,
          ({ rawTransaction, admit }) =>
            admit(
              () => {
                if (scenario === 'wire uncertain') {
                  void broadcast(rawTransaction);
                  throw new Error('synthetic uncertain wire');
                }
                return broadcast(rawTransaction);
              },
              async () => {
                if (scenario === 'sdk preflight failure')
                  throw Object.freeze(new Error('synthetic private SDK error'));
                if (scenario === 'timeout') {
                  entered.resolve();
                  await held.promise;
                }
              }
            ),
          boundary,
          undefined,
          Transaction.from(signed).unsignedSerialized
        );
        const failurePromise = submit.then(
          () => {
            throw new Error('unexpected success');
          },
          (error) => error
        );
        if (scenario === 'timeout') {
          await entered.promise;
          await jest.advanceTimersByTimeAsync(12001);
        }
        const failure = await failurePromise;
        const conflict = retainedEvmAssetPreflightConflict(failure);
        if (scenario === 'wire uncertain') {
          expect(conflict).toBeNull();
          expect(evmSubmissionFailure(failure)?.transactionNotBroadcast).toBe(
            false
          );
          expect(broadcast).toHaveBeenCalledTimes(1);
        } else {
          if (scenario === 'sdk preflight failure')
            expect(conflict?.code).toBe('EVM_SIGNED_RECORD_NONCE_CONFLICT');
          else expect(conflict).toBeNull();
          expect(evmSubmissionFailure(failure)?.transactionNotBroadcast).toBe(
            true
          );
          expect(failure.message).not.toContain('synthetic private SDK error');
          expect(broadcast).not.toHaveBeenCalled();
          if (scenario === 'sdk preflight failure') {
            // Exercise the actual token controller catch with the authentic
            // SDK-propagated marker; an expired port authority must win.
            wallet.assertWalletReadyForSigning = jest.fn();
            wallet.getWalletSetupStatus = jest.fn(() => null);
            wallet.inspectOrdinaryEvmNonce = jest.fn(async () => ({
              nonce: 0,
            }));
            jest
              .spyOn(blacklistService, 'checkAddress')
              .mockResolvedValue({ isBlacklisted: false } as any);
            const abort = new AbortController();
            const authority = {
              nonce: 0,
              signal: abort.signal,
              assertCurrent: () => {
                if (abort.signal.aborted)
                  throw new Error('synthetic approval expired');
              },
            };
            const send = jest.fn(async () => {
              abort.abort();
              throw failure;
            });
            (getController as jest.Mock).mockReturnValue({
              wallet: {
                ethereumTransaction: { sendSignedErc20Transaction: send },
              },
            });
            await expect(
              wallet.sendAndSaveTokenTransaction(tokenPayload(), authority)
            ).rejects.toThrow('synthetic approval expired');
            expect(send).toHaveBeenCalledTimes(1);
            const active = new AbortController();
            const activeAuthority = {
              nonce: 0,
              signal: active.signal,
              assertCurrent: () => undefined,
            };
            send.mockImplementationOnce(async () => {
              throw failure;
            });
            // The node test's default chrome.storage mock never calls back.
            // Keep real navigation cleanup, with an empty saved state.
            const navigationRead = jest
              .spyOn(chromeStorage, 'getItem')
              .mockResolvedValueOnce(null);
            await expect(
              wallet.sendAndSaveTokenTransaction(
                tokenPayload(),
                activeAuthority
              )
            ).rejects.toMatchObject({
              code: 'EVM_SIGNED_RECORD_NONCE_CONFLICT',
              transactionNotBroadcast: true,
            });
            expect(navigationRead).toHaveBeenCalledWith(
              'pali_navigation_state'
            );
          }
        }
        const retained = await journal.readExact(
          { keyring: sdkKeyring, assertCurrent: () => undefined },
          '123',
          signer.address,
          Transaction.from(signed).hash!
        );
        if (scenario === 'timeout') expect(retained).toBeNull();
        else expect(retained?.phase).toBe('signed');
      } finally {
        held.resolve();
        await Promise.resolve();
        if (scenario === 'timeout') jest.useRealTimers();
      }
    }
  );

  it('does not trust an unbranded marker-like SDK error', () => {
    expect(
      retainedEvmAssetPreflightConflict(
        new Error('EVM_SIGNED_ASSET_PREFLIGHT_FAILED')
      )
    ).toBeNull();
  });
});

it('captures the retained session before returning the signing lifecycle without reading other networks', () => {
  wallet.captureFreshEvmRead = jest.fn();
  const lifecycle = wallet.captureEvmSignedSubmission(keyring, context);
  expect(records.captureSession).toHaveBeenCalledTimes(2);
  expect(wallet.captureFreshEvmRead).not.toHaveBeenCalled();
  expect(provider.send).not.toHaveBeenCalled();
  wallet.advanceWalletSession();
  expect(() => lifecycle.assertCurrent()).toThrow();
});

it('resolves saved-chain retirement from configured routes while preserving the active submission context', async () => {
  const original = signedRecordModule.createEvmSignedRecordLifecycle;
  let options: Parameters<typeof original>[2] | undefined;
  jest
    .spyOn(signedRecordModule, 'createEvmSignedRecordLifecycle')
    .mockImplementation((journal, session, captured) => {
      options = captured;
      return original(journal, session, captured);
    });
  const configured = {
    ...context.network,
    chainId: 456,
    url: 'https://configured-other.invalid',
  };
  mockState.vaultGlobal.networks = {
    ethereum: { 123: { ...context.network }, 456: configured },
  };
  const run = jest.fn(async (work) => work({ send: async () => '0x1c8' }));
  wallet.captureFreshEvmRead = jest.fn((_scope, network) => ({
    keyring,
    network,
    run,
  }));
  wallet.captureEvmSignedSubmission(keyring, context);
  expect(wallet.captureFreshEvmRead).not.toHaveBeenCalled();
  const aggregate = new AbortController();
  const guard = jest.fn();
  const resolve = options!.retirementReadForChain!;
  expect(resolve('999999', aggregate.signal, guard)).toBeNull();
  expect(wallet.captureFreshEvmRead).not.toHaveBeenCalled();
  const read = resolve('456', aggregate.signal, guard)!;
  expect(wallet.captureFreshEvmRead).toHaveBeenCalledWith(
    getWalletNavigationScope(),
    configured
  );
  await expect(read('eth_chainId', [])).resolves.toBe('0x1c8');
  expect(run).toHaveBeenCalledWith(expect.any(Function), aggregate.signal);
  expect(mockState.vault.activeNetwork).toEqual(context.network);
  expect(keyring.ethereumTransaction.web3Provider).toBe(provider);
  const count = run.mock.calls.length;
  wallet.networkRequestGeneration++;
  await expect(read('eth_chainId', [])).rejects.toThrow();
  expect(run).toHaveBeenCalledTimes(count);
});

it.each(['configured route', 'active context', 'aggregate signal'])(
  'aborts an owned cross-chain retirement read when %s changes and removes its subscription',
  async (change) => {
    const configured = {
      ...context.network,
      chainId: 456,
      url: 'https://configured-other.invalid',
    };
    mockState.vaultGlobal.networks = {
      ethereum: { 123: { ...context.network }, 456: configured },
    };
    const providerLifetime = new AbortController();
    Object.assign(provider, { signal: providerLifetime.signal });
    keyring.ethereumTransaction.getGasOverrides = () => ({});
    const listeners = new Set<() => void>();
    const unsubscribe = jest.fn();
    (store.subscribe as jest.Mock).mockImplementation((listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        unsubscribe();
      };
    });
    let heldSignal: AbortSignal | undefined;
    wallet.withReceiptReadProvider = jest.fn((signal, network, work) => {
      expect(network).toEqual(configured);
      heldSignal = signal;
      return work({
        send: () =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
          }),
      });
    });
    const read = wallet.captureFreshEvmRead(
      getWalletNavigationScope(),
      configured
    );
    const aggregate = new AbortController();
    const pending = read.run(
      (transport) => transport.send('eth_chainId', []),
      aggregate.signal
    );
    expect(heldSignal?.aborted).toBe(false);
    if (change === 'configured route')
      mockState.vaultGlobal.networks.ethereum[456] = {
        ...configured,
        url: 'https://changed.invalid',
      };
    else if (change === 'active context') wallet.walletSessionGeneration++;
    else aggregate.abort(new Error('aggregate expired'));
    for (const listener of listeners) listener();
    await expect(pending).rejects.toThrow();
    expect(heldSignal?.aborted).toBe(true);
    expect(listeners.size).toBe(0);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(mockState.vault.activeNetwork).toEqual(context.network);
    expect(keyring.ethereumTransaction.web3Provider).toBe(provider);
  }
);
