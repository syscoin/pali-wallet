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

import { SoftwareKeyring } from '@sidhujag/sysweb3-keyring/cjs/software.js';
import { EthereumTransactions } from '@sidhujag/sysweb3-keyring/cjs/transactions/ethereum';
import * as prepared from '@sidhujag/sysweb3-keyring/cjs/transactions/prepared-evm.js';
import { webcrypto } from 'crypto';
import { Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';

import { getController } from '..';
import { EvmSignedRecords } from '../../../wallet/evmSignedRecords';
import { walletPersistenceGate } from 'state/paliStorage';
import { KeyringAccountType } from 'types/network';
import { getWalletNavigationScope } from 'utils/navigationState';
import { blacklistService } from 'utils/security/blacklistService';

import MainController from './MainController';

const signer = new Wallet('0x' + '1'.padStart(64, '0'));
const recipient = '0x' + '2'.repeat(40);
const blockHash = '0x' + 'ab'.repeat(32);
let mockState: any;

function fixture(
  type: 0 | 2,
  boundary: 'signing' | 'storage',
  accountType = KeyringAccountType.HDAccount
) {
  mockState = {
    vault: {
      isBitcoinBased: false,
      activeAccount: { id: 0, type: accountType },
      activeNetwork: {
        kind: 'ethereum',
        chainId: 123,
        slip44: 60,
        url: 'https://native-final.invalid',
      },
      accounts: {
        [accountType]: {
          0: { address: signer.address, xpub: signer.signingKey.publicKey },
        },
        Ledger: {},
        Trezor: {},
        SmartAccount: {},
      },
      accountTransactions: { [accountType]: { 0: { ethereum: { 123: [] } } } },
    },
    vaultGlobal: { activeSlip44: 60 },
  };
  const state = {
    gas: 21000,
    baseFee: 1,
    blockGas: 30000000,
    balance: 1000000,
    height: 16,
    reorg: false,
  };
  const calls: Array<{ method: string; params: unknown[] }> = [];
  const rpc = {
    signal: new AbortController().signal,
    verifyConfiguredChainId: jest.fn(async () => undefined),
    send: jest.fn(async (method: string, params: unknown[]) => {
      calls.push({ method, params });
      if (method === 'eth_getBlockByNumber') {
        const height =
          params[0] === 'latest' ? state.height : Number(params[0]);
        return {
          number: `0x${height.toString(16)}`,
          hash:
            state.reorg && params[0] !== 'latest'
              ? '0x' + 'cd'.repeat(32)
              : height === 16
              ? blockHash
              : '0x' + 'bc'.repeat(32),
          gasLimit: `0x${state.blockGas.toString(16)}`,
          baseFeePerGas: `0x${state.baseFee.toString(16)}`,
        };
      }
      if (method === 'eth_getTransactionCount') return '0x0';
      if (method === 'eth_getTransactionByHash') return null;
      if (method === 'eth_getBalance') return `0x${state.balance.toString(16)}`;
      if (method === 'eth_estimateGas') return `0x${state.gas.toString(16)}`;
      throw new Error(`Unexpected RPC ${method}`);
    }),
    sendTransaction: jest.fn(async (raw: string) => ({
      hash: Transaction.from(raw).hash,
      nonce: 0,
    })),
  };
  let mutate = () => undefined;
  let saved: string | undefined;
  const journal = new EvmSignedRecords({
    async read() {
      return saved;
    },
    async compareAndSet(_id, expected, next, assertCurrent) {
      assertCurrent();
      if (saved !== expected) return false;
      saved = next;
      if (boundary === 'storage') mutate();
      return true;
    },
  });
  const wallet: any = Object.create(MainController.prototype);
  const keyring: any = Object.assign(Object.create(SoftwareKeyring.prototype), {
    sessionPassword: { isCleared: () => false },
    sessionMnemonic: { isCleared: () => false },
    privateRecordSessionRevision: 0,
    getDecryptedMnemonic: () => 'Native final admission fixture',
    isUnlocked: () => true,
  });
  const sdk = new EthereumTransactions(
    () => mockState.vault.activeNetwork,
    () => ({ address: signer.address, decryptedPrivateKey: signer.privateKey }),
    () => ({
      activeAccountType: accountType,
      activeAccountId: 0,
      accounts: mockState.vault.accounts,
      activeNetwork: mockState.vault.activeNetwork,
    }),
    undefined as never,
    undefined as never,
    () => () => undefined,
    (context) => wallet.captureEvmSignedSubmission(keyring, context)
  );
  Object.defineProperty(sdk, 'web3Provider', { get: () => rpc });
  keyring.ethereumTransaction = sdk;
  wallet.walletSessionGeneration = 7;
  wallet.networkRequestGeneration = 11;
  wallet.getActiveKeyring = jest.fn(() => keyring);
  wallet.getRetainedEvmRecords = jest.fn(() => journal);
  wallet.getWalletSetupStatus = jest.fn(() => null);
  wallet.sendAndSaveTransaction = jest.fn(async () => undefined);
  wallet.captureFreshEvmRead = jest.fn(() => ({
    keyring,
    network: mockState.vault.activeNetwork,
    overrides: {},
    assertCurrent: () => undefined,
    run: (work: (provider: typeof rpc) => unknown) => work(rpc),
  }));
  (getController as jest.Mock).mockReturnValue({ wallet });
  jest
    .spyOn(blacklistService, 'checkAddress')
    .mockResolvedValue({ isBlacklisted: false } as any);
  const realSign = prepared.signPreparedEvmEnvelope;
  const signed = jest
    .spyOn(prepared, 'signPreparedEvmEnvelope')
    .mockImplementation((...args) => {
      const result = realSign(...args);
      if (boundary === 'signing') mutate();
      return result;
    });
  const input = {
    from: signer.address,
    to: recipient,
    chainId: 123,
    nonce: 0,
    value: '1',
    data: '0x',
    gasLimit: '25200',
    ...(type === 0
      ? { gasPrice: '10' }
      : { maxFeePerGas: '10', maxPriorityFeePerGas: '1' }),
  };
  return {
    wallet,
    rpc,
    calls,
    state,
    signed,
    input,
    setMutation(change: () => void) {
      mutate = () => {
        state.height = 17;
        change();
      };
    },
    async send() {
      const scope = getWalletNavigationScope();
      const review = await wallet.reviewNativeEvmFee(
        input,
        type === 0,
        '252000',
        scope
      );
      calls.length = 0;
      rpc.verifyConfiguredChainId.mockClear();
      return wallet.sendAndSaveEthTransaction(
        input,
        type === 0,
        undefined,
        undefined,
        {
          nativeReview: { id: review.id, scope },
          clearNavigation: false,
        }
      );
    },
    saved: () => saved,
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
  walletPersistenceGate.blocked = false;
});
afterEach(() => jest.restoreAllMocks());

describe.each([0, 2] as const)('native type %s final fee admission', (type) => {
  it.each(['signing', 'storage'] as const)(
    'keeps unchanged exact bytes after %s',
    async (boundary) => {
      const f = fixture(type, boundary);
      await expect(f.send()).resolves.toHaveProperty('hash');
      expect(f.signed).toHaveBeenCalledTimes(1);
      expect(f.rpc.sendTransaction).toHaveBeenCalledTimes(1);
      const transaction = Transaction.from(
        f.rpc.sendTransaction.mock.calls[0][0]
      );
      expect(transaction.gasLimit).toBe(BigInt(25200));
      expect(transaction.gasPrice ?? transaction.maxFeePerGas).toBe(BigInt(10));
      expect(f.saved()).toBeDefined();
      expect(
        f.calls.filter(({ method }) => method === 'eth_estimateGas')
      ).toHaveLength(2);
      expect(f.rpc.verifyConfiguredChainId).toHaveBeenCalledTimes(5);
      expect(f.calls).toHaveLength(14);
    }
  );

  it.each([
    ['estimate', 'signing'],
    ['estimate', 'storage'],
    ['base fee', 'signing'],
    ['base fee', 'storage'],
    ['block gas', 'signing'],
    ['block gas', 'storage'],
    ['balance', 'signing'],
    ['balance', 'storage'],
  ] as const)('rejects %s growth/loss after %s', async (change, boundary) => {
    const f = fixture(type, boundary);
    f.setMutation(() => {
      if (change === 'estimate') f.state.gas = 25201;
      if (change === 'base fee') f.state.baseFee = 11;
      if (change === 'block gas') f.state.blockGas = 25199;
      if (change === 'balance') f.state.balance = 252000;
    });
    const failure = await f.send().catch((error: unknown) => error);
    expect(failure).toMatchObject({ transactionNotBroadcast: true });
    expect((failure as Error).message).toMatch(
      change === 'estimate'
        ? /gas limit is no longer sufficient/
        : change === 'base fee'
        ? /below the current base fee/
        : change === 'block gas'
        ? /gas limit exceeds the network limit/
        : /Insufficient funds/
    );
    expect(f.signed).toHaveBeenCalledTimes(1);
    expect(f.saved()).toBeDefined();
    expect(f.rpc.sendTransaction).not.toHaveBeenCalled();
    expect(f.rpc.send).toHaveBeenCalledWith('eth_getBlockByNumber', [
      'latest',
      false,
    ]);
  });

  it('accepts a new canonical head after persistence', async () => {
    const f = fixture(type, 'storage');
    f.setMutation(() => undefined);
    await expect(f.send()).resolves.toHaveProperty('hash');
    expect(f.rpc.send).toHaveBeenCalledWith('eth_getBlockByNumber', [
      '0x11',
      false,
    ]);
    expect(f.rpc.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('rejects a replaced final canonical head after persistence', async () => {
    const f = fixture(type, 'storage');
    f.setMutation(() => {
      f.state.reorg = true;
    });
    await expect(f.send()).rejects.toThrow('Canonical balance changed');
    expect(f.rpc.send).toHaveBeenCalledWith('eth_getBlockByNumber', [
      '0x11',
      false,
    ]);
    expect(f.rpc.sendTransaction).not.toHaveBeenCalled();
  });

  it('checks an imported payer with an automatically allocated nonce', async () => {
    const f = fixture(type, 'storage', KeyringAccountType.Imported);
    delete (f.input as { nonce?: number }).nonce;
    f.setMutation(() => {
      f.state.gas = 25201;
    });
    await expect(f.send()).rejects.toThrow('gas limit is no longer sufficient');
    expect(f.signed).toHaveBeenCalledTimes(1);
    expect(f.rpc.sendTransaction).not.toHaveBeenCalled();
  });

  it('retains the original review deadline after storage', async () => {
    let now = 1000;
    jest.spyOn(performance, 'now').mockImplementation(() => now);
    const f = fixture(type, 'storage');
    f.setMutation(() => {
      now += 90001;
    });
    await expect(f.send()).rejects.toThrow('EVM fee approval expired');
    expect(f.signed).toHaveBeenCalledTimes(1);
    expect(f.saved()).toBeDefined();
    expect(f.rpc.sendTransaction).not.toHaveBeenCalled();
  });

  it.each(['estimate', 'base fee', 'block gas'] as const)(
    'rejects a changed %s before signer entry',
    async (change) => {
      const f = fixture(type, 'signing');
      if (change === 'estimate') f.state.gas = 25201;
      if (change === 'base fee') f.state.baseFee = 11;
      if (change === 'block gas') f.state.blockGas = 25199;
      await expect(f.send()).rejects.toMatchObject({
        transactionNotBroadcast: true,
      });
      expect(f.signed).not.toHaveBeenCalled();
      expect(f.saved()).toBeUndefined();
      expect(f.rpc.sendTransaction).not.toHaveBeenCalled();
    }
  );
});
