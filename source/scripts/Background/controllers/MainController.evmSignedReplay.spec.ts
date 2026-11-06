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
  default: { getState: () => mockState, dispatch: jest.fn() },
}));

import {
  captureEvmSubmission,
  evmSubmissionFailure,
  SoftwareKeyring,
  submitSignedEvmTransaction,
} from '@sidhujag/sysweb3-keyring/cjs/software.js';
import { submitSignedHardwareEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-submission.js';
import { webcrypto } from 'crypto';
import { Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';

import { EvmAutoNonceAcceptance } from '../../../shared/evmAutoNonce';
import { EvmSignedRecords } from '../../../wallet/evmSignedRecords';
import { walletPersistenceGate } from 'state/paliStorage';
import { KeyringAccountType } from 'types/network';
import { getWalletNavigationScope } from 'utils/navigationState';

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
let provider: { _send: jest.Mock; send: jest.Mock };
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
    retained: [],
    readMaximumCost: async () => {
      throw Error('Unexpected predecessor read in replacement fixture');
    },
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
    readExact: jest.fn(async () => entry),
    readForObservation: jest.fn(async () => observed()),
    readPage: jest.fn(async () => ({ entries: [entry], nextCursor: null })),
    withReplayAdmission: jest.fn(
      async (_session, _target, admit, _predecessorNonce, preflight) => {
        await runReplayPreflight(preflight);
        return { result: admit([]) };
      }
    ),
    append: jest.fn(async () => undefined),
    captureVerifiedReplacement: jest.fn(async () => undefined),
    updatePhase: jest.fn(async () => undefined),
    updateObservedPhase: jest.fn(async () => undefined),
    reconcileMinedCancellation: jest.fn(async () => undefined),
  };
  provider = {
    _send: jest.fn(async ({ id }) => [{ jsonrpc: '2.0', id, result: '0x7b' }]),
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
  'watch conversion',
  'provider',
  'session',
  'locked',
  'network request A-B-A',
])(
  'rejects %s change during a retained read before any RPC',
  async (change) => {
    mockState.vault.activeAccount.type = KeyringAccountType.Imported;
    mockState.vault.accounts.Imported[0] = {
      address: signer.address,
      xpub: signer.signingKey.publicKey,
      xprv: 'encrypted fixture',
    };
    const entered = deferred(),
      released = deferred<ReturnType<typeof observed>>();
    records.readForObservation.mockImplementationOnce(async () => {
      entered.resolve();
      return released.promise;
    });
    const pending = wallet.prepareEvmSignedReplay(entry.hash);
    const rejected = expect(pending).rejects.toThrow();
    await Promise.race([
      entered.promise,
      rejected.then(() => {
        throw Error(
          'Replay rejected before reaching the held observation read'
        );
      }),
    ]);
    const navigation = getWalletNavigationScope();
    if (change === 'watch conversion')
      delete mockState.vault.accounts.Imported[0].xprv;
    if (change === 'provider')
      wallet.ethereumTransaction.web3Provider = { send: jest.fn() };
    if (change === 'session') wallet.walletSessionGeneration += 1;
    if (change === 'locked') keyring.isUnlocked.mockReturnValue(false);
    if (change === 'network request A-B-A') {
      mockState.vault.activeNetwork.url = 'https://b.invalid';
      wallet.networkRequestGeneration += 1;
      mockState.vault.activeNetwork.url = context.network.url;
      wallet.networkRequestGeneration += 1;
      expect(getWalletNavigationScope()).toEqual(navigation);
    }
    released.resolve(observed());
    await rejected;
    expect(provider.send).not.toHaveBeenCalled();
  }
);
it('advanceWalletSession cancels the retained review owner and pending preparation', async () => {
  const entered = deferred(),
    released = deferred<ReturnType<typeof observed>>();
  records.readForObservation.mockImplementationOnce(async () => {
    entered.resolve();
    return released.promise;
  });
  const pending = wallet.prepareEvmSignedReplay(entry.hash);
  const rejected = expect(pending).rejects.toThrow();
  await Promise.race([
    entered.promise,
    rejected.then(() => {
      throw Error('Replay rejected before reaching the held observation read');
    }),
  ]);
  const oldReplay = wallet.retainedEvmReplay,
    cancel = jest.spyOn(oldReplay, 'cancel');
  wallet.advanceWalletSession();
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(wallet.retainedEvmReplay).toBeUndefined();
  expect(wallet.retainedEvmRecords).toBeUndefined();
  released.resolve(observed());
  await rejected;
  expect(provider.send).not.toHaveBeenCalled();
});
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
  'checks a direct empty self fee replacement only when self=%s',
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
    provider.send.mockImplementation(async (method) => {
      if (method === 'eth_getTransactionCount') return '0x0';
      if (method === 'eth_getCode') return '0xef0100' + '33'.repeat(20);
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
      expect(provider._send).toHaveBeenCalledTimes(1);
      expect(dispatch).not.toHaveBeenCalled();
    } else {
      await expect(submit).resolves.toBe(entry.hash);
      expect(provider._send).not.toHaveBeenCalled();
      expect(provider.send).not.toHaveBeenCalled();
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
    expect(provider._send).toHaveBeenCalledTimes(1);
  }
);

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
          return { result: admit([]) };
        }
      );
    }
    provider.send.mockImplementation(async (method, [, tag]) => {
      if (method === 'eth_getTransactionCount')
        return blocked === 'consumed' ? '0x1' : '0x0';
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
it('fresh explicit replay uses exact stored bytes and consumes its confirmation once', async () => {
  const prepared = await wallet.prepareEvmSignedReplay(entry.hash);
  expect(prepared.status).toBe('review');
  expect(
    provider.send.mock.calls.some(
      ([method]) => method === 'eth_sendRawTransaction'
    )
  ).toBe(false);
  await expect(
    wallet.confirmEvmSignedReplay(prepared.review.id)
  ).resolves.toEqual({ status: 'submitted', hash: entry.hash });
  await expect(
    wallet.confirmEvmSignedReplay(prepared.review.id)
  ).rejects.toThrow('EXPIRED');
  expect(
    provider.send.mock.calls.filter(
      ([method]) => method === 'eth_sendRawTransaction'
    )
  ).toEqual([['eth_sendRawTransaction', [raw]]]);
  expect(
    provider.send.mock.calls.some(([method]) => method === 'eth_getCode')
  ).toBe(false);
  // Prepare and confirm each bracket observation with live chain reads.
  // Dispatch then checks the chain once more under admission.
  expect(provider._send).toHaveBeenCalledTimes(5);
});

it('refuses the exact provider send when final shared replay admission fails', async () => {
  const prepared = await wallet.prepareEvmSignedReplay(entry.hash);
  expect(prepared.status).toBe('review');
  records.withReplayAdmission.mockResolvedValueOnce(null);
  await expect(
    wallet.confirmEvmSignedReplay(prepared.review.id)
  ).rejects.toThrow('CONTEXT_CHANGED');
  expect(
    provider.send.mock.calls.some(
      ([method]) => method === 'eth_sendRawTransaction'
    )
  ).toBe(false);
});

async function retainCancellation() {
  const cancellation = await signer.signTransaction({
    type: 2,
    chainId: 123,
    nonce: 1,
    to: signer.address,
    value: 0,
    gasLimit: 42000,
    maxFeePerGas: 4,
    maxPriorityFeePerGas: 2,
  });
  entry = {
    ...entry,
    originalHash: entry.hash,
    hash: Transaction.from(cancellation).hash,
    nonce: 1,
    operation: 'cancel',
    rawTransaction: cancellation,
  };
  records.readExact.mockResolvedValue(entry);
  return cancellation;
}

it.each(['latest', 'pending', 'queued', 'consumed', 'ready'])(
  'handles %s only for authenticated cancellation replay',
  async (blocked) => {
    const cancellation = await retainCancellation();
    let nonceReads = 0;
    const changedNonce = blocked === 'queued' || blocked === 'consumed';
    provider.send.mockImplementation(async (method, params) => {
      if (method === 'eth_chainId') return '0x7b';
      if (method === 'eth_getTransactionReceipt') return null;
      if (method === 'eth_getTransactionCount') {
        if (++nonceReads < 3) return '0x1';
        return blocked === 'queued'
          ? '0x0'
          : blocked === 'consumed'
          ? '0x2'
          : '0x1';
      }
      if (method === 'eth_getCode')
        return params[1] === blocked ? '0xef0100' + '33'.repeat(20) : '0x';
      if (method === 'eth_sendRawTransaction') {
        expect(params).toEqual([cancellation]);
        return entry.hash;
      }
      throw Error('Unexpected RPC');
    });
    const prepared = await wallet.prepareEvmSignedReplay(entry.hash);
    expect(prepared.status).toBe('review');
    expect(
      provider.send.mock.calls.some(([method]) => method === 'eth_getCode')
    ).toBe(false);
    const confirmation = wallet.confirmEvmSignedReplay(prepared.review.id);
    if (blocked === 'ready')
      await expect(confirmation).resolves.toEqual({
        status: 'submitted',
        hash: entry.hash,
      });
    else
      await expect(confirmation).rejects.toThrow(
        changedNonce
          ? 'Unable to verify a ready cancellation nonce'
          : 'Unable to verify a code-free cancellation payer'
      );
    // Both observations and the final admitted dispatch use the live chain.
    expect(provider._send).toHaveBeenCalledTimes(5);
    expect(nonceReads).toBe(3);
    expect(
      provider.send.mock.calls.filter(([method]) => method === 'eth_getCode')
    ).toEqual(
      changedNonce
        ? []
        : [
            ['eth_getCode', [signer.address, 'latest']],
            ['eth_getCode', [signer.address, 'pending']],
          ]
    );
    expect(
      provider.send.mock.calls.filter(
        ([method]) => method === 'eth_sendRawTransaction'
      )
    ).toHaveLength(blocked === 'ready' ? 1 : 0);
  }
);

it.each(['send', 'cancel'] as const)(
  'bypasses the installed provider chain cache after final journal admission for %s replay',
  async (operation) => {
    const { CustomJsonRpcProvider } = jest.requireActual(
      '@sidhujag/sysweb3-keyring/cjs/providers'
    );
    if (operation === 'cancel') await retainCancellation();
    const reached = deferred();
    const release = deferred();
    const admit = records.withReplayAdmission.getMockImplementation();

    const abort = new AbortController();
    const live = new CustomJsonRpcProvider(
      abort.signal,
      context.network.url,
      context.network.chainId
    );
    keyring.ethereumTransaction.web3Provider = live;
    const wire: Array<{ method: string; params: unknown[] }> = [];
    let chain = '0x7b';
    jest.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      expect(url).toBe(context.network.url);
      expect(init?.signal).toBe(abort.signal);
      const { id, method, params } = JSON.parse(init!.body as string);
      wire.push({ method, params });
      const replies = new Map<string, unknown>([
        ['eth_chainId', chain],
        ['eth_getTransactionReceipt', null],
        ['eth_getTransactionCount', `0x${entry.nonce.toString(16)}`],
        ['eth_getCode', '0x'],
        ['eth_sendRawTransaction', entry.hash],
      ]);
      expect(replies.has(method)).toBe(true);
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: '2.0', id, result: replies.get(method) }),
      } as Response;
    });
    try {
      await expect(live.send('eth_chainId', [])).resolves.toBe('0x7b');
      const prepared = await wallet.prepareEvmSignedReplay(entry.hash);
      expect(prepared.status).toBe('review');
      records.withReplayAdmission.mockImplementationOnce(async (...args) => {
        reached.resolve();
        await release.promise;
        return admit(...args);
      });
      const confirmation = wallet.confirmEvmSignedReplay(prepared.review.id);
      await Promise.race([reached.promise, confirmation]);
      const before = wire.length;
      chain = '0x1';
      await expect(live.send('eth_chainId', [])).resolves.toBe('0x7b');
      expect(wire).toHaveLength(before);
      release.resolve();
      await expect(confirmation).rejects.toThrow('CONTEXT_CHANGED');
      expect(wire.slice(before)).toEqual([
        { method: 'eth_chainId', params: [] },
      ]);
    } finally {
      release.resolve();
      abort.abort();
      live.destroy();
    }
  }
);

it.each([
  'wrong-before-observation',
  'wrong-during-observation',
  'unchanged',
] as const)(
  'checks the live provider chain while observing a saved transaction: %s',
  async (scenario) => {
    const { CustomJsonRpcProvider } = jest.requireActual(
      '@sidhujag/sysweb3-keyring/cjs/providers'
    );
    const abort = new AbortController();
    const live = new CustomJsonRpcProvider(
      abort.signal,
      context.network.url,
      context.network.chainId
    );
    keyring.ethereumTransaction.web3Provider = live;
    const wire: string[] = [];
    let chain = '0x7b';
    jest.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      expect(url).toBe(context.network.url);
      expect(init?.signal).toBe(abort.signal);
      const { id, method } = JSON.parse(init!.body as string);
      wire.push(method);
      let result: unknown;
      if (method === 'eth_chainId') result = chain;
      else if (method === 'eth_getTransactionReceipt') result = null;
      else if (method === 'eth_getTransactionCount') {
        result = scenario === 'unchanged' ? '0x0' : '0x1';
        if (scenario === 'wrong-during-observation') chain = '0x1';
      } else throw Error('Unexpected RPC');
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: '2.0', id, result }),
      } as Response;
    });
    try {
      // The real installed provider caches the first result for send().
      await expect(live.send('eth_chainId', [])).resolves.toBe('0x7b');
      if (scenario === 'wrong-before-observation') chain = '0x1';
      const before = wire.length;
      await expect(live.send('eth_chainId', [])).resolves.toBe('0x7b');
      expect(wire).toHaveLength(before);
      const result = wallet.prepareEvmSignedReplay(entry.hash);
      if (scenario === 'unchanged') {
        await expect(result).resolves.toMatchObject({ status: 'review' });
        expect(wire).not.toContain('eth_sendRawTransaction');
      } else {
        await expect(result).rejects.toMatchObject({ code: 'CONTEXT_CHANGED' });
        expect(wire.slice(before)).toEqual(
          scenario === 'wrong-before-observation'
            ? ['eth_chainId']
            : [
                'eth_chainId',
                'eth_getTransactionReceipt',
                'eth_getTransactionCount',
                'eth_chainId',
              ]
        );
      }
      // A wrong backend may not mark this transaction consumed or dispatch it.
      expect(records.updateObservedPhase).not.toHaveBeenCalled();
      expect(records.updatePhase).not.toHaveBeenCalled();
      expect(records.reconcileMinedCancellation).not.toHaveBeenCalled();
      expect(records.append).not.toHaveBeenCalled();
      expect(wire).not.toContain('eth_sendRawTransaction');
    } finally {
      abort.abort();
      live.destroy();
    }
  }
);

it('does not POST when an ordinary replay expires during the fresh chain check', async () => {
  const prepared = await wallet.prepareEvmSignedReplay(entry.hash);
  expect(prepared.status).toBe('review');
  const reached = deferred(),
    response = deferred<unknown[]>();
  let requestId: number | undefined;
  provider._send.mockImplementationOnce(async ({ id }) => {
    requestId = id;
    reached.resolve();
    return response.promise;
  });
  const replay = wallet.retainedEvmReplay;
  const now = replay.now();
  const confirmation = wallet.confirmEvmSignedReplay(prepared.review.id);
  expect(
    await Promise.race([
      reached.promise.then(() => 'preflight'),
      confirmation.then(() => 'sent'),
    ])
  ).toBe('preflight');
  jest.spyOn(replay, 'now').mockReturnValue(now + 90_001);
  response.resolve([{ jsonrpc: '2.0', id: requestId, result: '0x7b' }]);
  await expect(confirmation).rejects.toThrow('EXPIRED');
  expect(
    provider.send.mock.calls.some(
      ([method]) => method === 'eth_sendRawTransaction'
    )
  ).toBe(false);
  expect(records.updatePhase).not.toHaveBeenCalled();
  expect(records.updateObservedPhase).not.toHaveBeenCalled();
  expect(records.reconcileMinedCancellation).not.toHaveBeenCalled();
  await expect(
    wallet.confirmEvmSignedReplay(prepared.review.id)
  ).rejects.toThrow('EXPIRED');
});

it.each([false, true])(
  'checks live fees before replaying a saved Speed Up (%s)',
  async (executable) => {
    entry.operation = 'speed-up';
    entry.originalHash = '0x' + 'a'.repeat(64);
    const previous = provider.send.getMockImplementation()!;
    provider.send.mockImplementation(async (method, params) =>
      method === 'eth_getBlockByNumber'
        ? { gasLimit: '0x1c9c380', baseFeePerGas: executable ? '0x2' : '0x4' }
        : previous(method, params)
    );
    const prepared = await wallet.prepareEvmSignedReplay(entry.hash);
    expect(prepared.status).toBe('review');
    const result = wallet.confirmEvmSignedReplay(prepared.review.id);
    if (executable)
      await expect(result).resolves.toMatchObject({
        status: 'submitted',
        hash: entry.hash,
      });
    else
      await expect(result).rejects.toThrow(
        'The signed Speed Up is no longer executable'
      );
    const posts = provider.send.mock.calls.filter(
      ([method]) => method === 'eth_sendRawTransaction'
    );
    expect(posts).toEqual(
      executable ? [['eth_sendRawTransaction', [raw]]] : []
    );
  }
);

it('refuses cancellation metadata on a signed payment before any code read or send', async () => {
  entry.operation = 'cancel';
  const prepared = await wallet.prepareEvmSignedReplay(entry.hash);
  expect(prepared.status).toBe('review');
  await expect(
    wallet.confirmEvmSignedReplay(prepared.review.id)
  ).rejects.toThrow('INVALID_RESPONSE');
  expect(
    provider.send.mock.calls.some(
      ([method]) =>
        method === 'eth_getCode' || method === 'eth_sendRawTransaction'
    )
  ).toBe(false);
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
      if (method === 'eth_getTransactionCount')
        return params[1] === 'latest' ? '0x0' : `0x${pending.toString(16)}`;
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
      retained,
      readMaximumCost: async () => BigInt(21000),
      touchesContract: async () => false,
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
      retained: [],
      readMaximumCost: async () => BigInt(0),
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
