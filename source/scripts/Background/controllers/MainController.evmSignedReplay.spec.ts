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
let provider: { send: jest.Mock };
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
    append: jest.fn(async () => undefined),
    updatePhase: jest.fn(async () => undefined),
  };
  provider = {
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
});
