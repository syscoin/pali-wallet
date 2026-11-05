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
  submitSignedEvmTransaction,
} from '@sidhujag/sysweb3-keyring/cjs/software.js';
import { webcrypto } from 'crypto';
import { Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';

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
    readPage: jest.fn(async () => ({ entries: [entry], nextCursor: null })),
    withReplayAdmission: jest.fn(
      async (
        _session,
        _target,
        admit,
        _predecessorNonce,
        checkCancellation
      ) => {
        await checkCancellation?.();
        return { result: admit([]) };
      }
    ),
    append: jest.fn(async () => undefined),
    updatePhase: jest.fn(async () => undefined),
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
      released = deferred<any>();
    records.readExact.mockImplementationOnce(async () => {
      entered.resolve();
      return released.promise;
    });
    const pending = wallet.prepareEvmSignedReplay(entry.hash);
    const rejected = expect(pending).rejects.toThrow();
    await entered.promise;
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
    released.resolve(entry);
    await rejected;
    expect(provider.send).not.toHaveBeenCalled();
  }
);
it('advanceWalletSession cancels the retained review owner and pending preparation', async () => {
  const entered = deferred(),
    released = deferred<any>();
  records.readExact.mockImplementationOnce(async () => {
    entered.resolve();
    return released.promise;
  });
  const pending = wallet.prepareEvmSignedReplay(entry.hash);
  const rejected = expect(pending).rejects.toThrow();
  await entered.promise;
  const oldReplay = wallet.retainedEvmReplay,
    cancel = jest.spyOn(oldReplay, 'cancel');
  wallet.advanceWalletSession();
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(wallet.retainedEvmReplay).toBeUndefined();
  expect(wallet.retainedEvmRecords).toBeUndefined();
  released.resolve(entry);
  await rejected;
  expect(provider.send).not.toHaveBeenCalled();
});
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
  const dispatch = jest.fn(async () => entry.hash);
  const pending = submitSignedEvmTransaction(
    raw,
    dispatch,
    boundary,
    () => undefined
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
    const dispatch = jest.fn(async () => entry.hash);
    const submit = submitSignedEvmTransaction(replacement, dispatch, boundary);
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
    const dispatch = jest.fn(async () => hash);
    await expect(
      submitSignedEvmTransaction(replacement, dispatch, boundary)
    ).resolves.toBe(hash);
    expect(dispatch).toHaveBeenCalledWith(replacement);
    expect(provider._send).toHaveBeenCalledTimes(1);
  }
);

it.each(['latest', 'pending', 'consumed', 'ready'])(
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
    provider.send.mockImplementation(async (method, [, tag]) => {
      if (method === 'eth_getTransactionCount')
        return blocked === 'consumed' ? '0x1' : '0x0';
      expect(method).toBe('eth_getCode');
      return tag === blocked ? `0xef0100${'33'.repeat(20)}` : '0x';
    });
    const dispatch = jest.fn(async () => entry.hash);
    const result = submitSignedEvmTransaction(
      cancellation,
      dispatch,
      boundary
    ).catch((error) => error);
    await entered.promise;
    expect(provider.send).not.toHaveBeenCalled();
    released.resolve();
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
  expect(provider._send).not.toHaveBeenCalled();
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
    expect(provider._send).toHaveBeenCalledTimes(1);
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

it('bypasses the installed provider chain cache after final journal admission', async () => {
  const { CustomJsonRpcProvider } = jest.requireActual(
    '@sidhujag/sysweb3-keyring/cjs/providers'
  );
  await retainCancellation();
  const reached = deferred();
  const release = deferred();
  const admit = records.withReplayAdmission.getMockImplementation();
  records.withReplayAdmission.mockImplementation(async (...args) => {
    if (args[4]) {
      reached.resolve();
      await release.promise;
    }
    return admit(...args);
  });

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
      ['eth_getTransactionCount', '0x1'],
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
    const confirmation = wallet.confirmEvmSignedReplay(prepared.review.id);
    await Promise.race([reached.promise, confirmation]);
    const before = wire.length;
    chain = '0x1';
    await expect(live.send('eth_chainId', [])).resolves.toBe('0x7b');
    expect(wire).toHaveLength(before);
    release.resolve();
    await expect(confirmation).rejects.toThrow('CONTEXT_CHANGED');
    expect(wire.slice(before)).toEqual([{ method: 'eth_chainId', params: [] }]);
  } finally {
    release.resolve();
    abort.abort();
    live.destroy();
  }
});

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
