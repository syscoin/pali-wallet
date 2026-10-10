import {
  BigNumber,
  serializeTransaction,
} from '@sidhujag/sysweb3-keyring/cjs/ethers-v6';
import { KeyringManager } from '@sidhujag/sysweb3-keyring/cjs/keyring-manager';
import { EthereumTransactions } from '@sidhujag/sysweb3-keyring/cjs/transactions/ethereum';
import {
  privateKeyToAccount,
  sendLocalEvmTransaction,
} from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-local-signer';
import { Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';

import { INetworkType, KeyringAccountType } from 'types/network';

jest.mock(
  '@sidhujag/sysweb3-keyring/cjs/transactions/evm-local-signer',
  () => ({
    ...jest.requireActual(
      '@sidhujag/sysweb3-keyring/cjs/transactions/evm-local-signer'
    ),
    privateKeyToAccount: jest.fn(),
    sendLocalEvmTransaction: jest.fn(),
  })
);
jest.mock('crypto-js', () => ({
  ...jest.requireActual('crypto-js'),
  AES: { ...jest.requireActual('crypto-js').AES, decrypt: jest.fn() },
}));
jest.mock('syscoinjs-lib', () => ({
  utils: { bitcoinjs: {} },
  networks: { bitcoin: {}, syscoin: {} },
}));
jest.mock(
  '@sidhujag/sysweb3-keyring/cjs/hardware-wallet-manager-singleton',
  () => ({
    HardwareWalletManagerSingleton: { getInstance: () => ({}) },
  })
);
jest.mock('@sidhujag/sysweb3-keyring/cjs/ledger', () => ({
  LedgerKeyring: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring/cjs/trezor', () => ({
  TrezorKeyring: jest.fn(),
}));

const mockAes = jest.requireMock('crypto-js').AES;

// Deliberately public deterministic test keys, with no provider or live account.
const hardwareWallet = new Wallet(`0x${'11'.repeat(32)}`);
const otherHardwareWallet = new Wallet(`0x${'22'.repeat(32)}`);
const PAYER = hardwareWallet.address;
const SMART = `0x${'22'.repeat(20)}`;
const TARGET = `0x${'33'.repeat(20)}`;
const ORIGINAL = `0x${'44'.repeat(32)}`;
const REPLACEMENT = `0x${'55'.repeat(32)}`;
const CHAIN = 5700;
const payer = { type: KeyringAccountType.HDAccount, id: 3 };
const smart = { type: KeyringAccountType.SmartAccount, id: 7 };
const response = { hash: REPLACEMENT, from: PAYER, nonce: 8, chainId: CHAIN };
const deviceSignature = async (params: any, wallet = hardwareWallet) => {
  const tx = Transaction.from(
    typeof params === 'string' ? params : serializeTransaction(params)
  );
  const signed = await wallet.signTransaction({
    chainId: tx.chainId,
    nonce: tx.nonce,
    type: tx.type,
    to: tx.to,
    value: tx.value,
    data: tx.data,
    gasLimit: tx.gasLimit,
    ...(tx.type === 0
      ? { gasPrice: tx.gasPrice }
      : {
          maxFeePerGas: tx.maxFeePerGas,
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
        }),
  });
  const signature = Transaction.from(signed).signature!;
  return { r: signature.r, s: signature.s, v: signature.v };
};
const transaction = (fields: any = {}) => ({
  hash: ORIGINAL,
  from: PAYER,
  to: TARGET,
  nonce: 8,
  chainId: CHAIN,
  value: BigNumber.from(7),
  data: '0x1234',
  gasLimit: BigNumber.from(21000),
  gasPrice: BigNumber.from(100),
  maxFeePerGas: BigNumber.from(100),
  maxPriorityFeePerGas: BigNumber.from(10),
  ...fields,
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => (resolve = finish));
  return { promise, resolve };
};

describe('published keyring account-scoped replacement signing', () => {
  let state: any;
  let sdk: EthereumTransactions;
  let provider: any;
  let currentProvider: any;
  let getKey: jest.Mock;
  let ledger: any;
  let trezor: any;
  let current: boolean;
  let beforeBroadcast: jest.Mock;
  let validateOriginal: jest.Mock;

  const options = (targetAccount = payer) => ({
    targetAccount,
    assertCurrentContext: () => {
      if (!current) throw new Error('PALI_TRANSACTION_CONTEXT_CHANGED');
    },
    validateOriginal,
    beforeBroadcast,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    current = true;
    state = {
      activeAccountType: smart.type,
      activeAccountId: smart.id,
      activeNetwork: {
        chainId: CHAIN,
        kind: INetworkType.Ethereum,
        slip44: 60,
        currency: 'tsys',
        url: 'https://rpc-a.example',
      },
      accounts: {
        [payer.type]: { [payer.id]: { address: PAYER } },
        [smart.type]: { [smart.id]: { address: SMART } },
        [KeyringAccountType.Ledger]: { 4: { address: PAYER } },
        [KeyringAccountType.Trezor]: { 5: { address: PAYER } },
      },
    };
    provider = {
      getTransaction: jest.fn().mockResolvedValue(transaction()),
      getNetwork: jest.fn().mockResolvedValue({ chainId: CHAIN }),
      getBalance: jest.fn().mockResolvedValue(BigNumber.from('1000000000')),
      getGasPrice: jest.fn().mockResolvedValue(BigNumber.from(1000)),
      getBlock: jest
        .fn()
        .mockResolvedValue({ baseFeePerGas: BigNumber.from(50) }),
      send: jest.fn().mockResolvedValue('0x2'),
      sendTransaction: jest.fn().mockResolvedValue(response),
    };
    currentProvider = provider;
    getKey = jest.fn().mockReturnValue({
      address: PAYER,
      decryptedPrivateKey: 'mocked-private-key',
    });
    ledger = {
      evm: {
        signEVMTransaction: jest.fn(async ({ rawTx }) => {
          const signature = await deviceSignature(`0x${rawTx}`);
          return {
            r: signature.r.slice(2),
            s: signature.s.slice(2),
            v: signature.v.toString(16),
          };
        }),
      },
    };
    trezor = {
      signEthTransaction: jest.fn(async ({ tx }) => ({
        success: true,
        payload: await deviceSignature(tx),
      })),
    };
    sdk = new EthereumTransactions(
      () => state.activeNetwork,
      getKey,
      () => state,
      ledger,
      trezor
    );
    Object.defineProperty(sdk, 'web3Provider', {
      configurable: true,
      get: () => currentProvider,
    });
    beforeBroadcast = jest.fn();
    validateOriginal = jest.fn((tx) => {
      if (tx.hash !== ORIGINAL || tx.nonce !== 8)
        throw new Error('Original transaction changed');
    });
    jest
      .mocked(sendLocalEvmTransaction)
      .mockImplementation(async (capturedProvider, _key, _tx, before) => {
        await Promise.resolve();
        before?.();
        return capturedProvider.sendTransaction('mocked-signed-transaction');
      });
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([false, true])(
    'signs through the explicit outer payer without changing the active SmartAccount (legacy=%s)',
    async (legacy) => {
      await expect(
        sdk.sendTransactionWithEditedFee(ORIGINAL, legacy, options())
      ).resolves.toMatchObject({ isSpeedUp: true, transaction: response });
      expect(getKey).toHaveBeenCalledWith(payer);
      expect(state.activeAccountType).toBe(smart.type);
      expect(state.activeAccountId).toBe(smart.id);
      const [, key, tx] = jest.mocked(sendLocalEvmTransaction).mock.calls[0];
      expect(key).toBe('mocked-private-key');
      expect(tx).toMatchObject({
        from: PAYER,
        to: TARGET,
        nonce: 8,
        chainId: CHAIN,
        data: '0x1234',
      });
      expect(tx.value.toString()).toBe('7');
      expect(tx.gasLimit.toString()).toBe('25200');
      expect((legacy ? tx.gasPrice : tx.maxFeePerGas).toString()).toBe('120');
      expect(beforeBroadcast).toHaveBeenCalledTimes(1);
      expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
    }
  );

  it('retains the default two-argument EOA call', async () => {
    state.activeAccountType = payer.type;
    state.activeAccountId = payer.id;
    await expect(
      sdk.sendTransactionWithEditedFee(ORIGINAL, false)
    ).resolves.toMatchObject({ isSpeedUp: true, transaction: response });
    expect(getKey).toHaveBeenCalledWith(undefined);
    expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it.each([
    { type: payer.type, id: 99 },
    { type: smart.type, id: smart.id },
  ])(
    'rejects unavailable signing target %j before RPC/signing',
    async (target) => {
      await expect(
        sdk.sendTransactionWithEditedFee(ORIGINAL, false, options(target))
      ).rejects.toThrow('Replacement signing account is unavailable');
      expect(provider.getTransaction).not.toHaveBeenCalled();
      expect(getKey).not.toHaveBeenCalled();
      expect(provider.sendTransaction).not.toHaveBeenCalled();
    }
  );

  it.each([
    { from: TARGET },
    { chainId: 1 },
    { hash: REPLACEMENT },
    { nonce: 9 },
  ])(
    'rejects incompatible original lookup %j before signing',
    async (fields) => {
      provider.getTransaction.mockResolvedValue(transaction(fields));
      await expect(
        sdk.sendTransactionWithEditedFee(ORIGINAL, false, options())
      ).rejects.toThrow();
      expect(getKey).not.toHaveBeenCalled();
      expect(sendLocalEvmTransaction).not.toHaveBeenCalled();
      expect(provider.sendTransaction).not.toHaveBeenCalled();
    }
  );

  it.each(['lookup', 'balance', 'fee'])(
    'rejects stale context after deferred %s before signing',
    async (phase) => {
      const pending = deferred<any>();
      const started = deferred<void>();
      if (phase === 'lookup')
        provider.getTransaction.mockImplementationOnce(() => {
          started.resolve();
          return pending.promise;
        });
      if (phase === 'balance')
        provider.getBalance.mockImplementationOnce(() => {
          started.resolve();
          return pending.promise;
        });
      if (phase === 'fee') {
        provider.getTransaction.mockResolvedValue(
          transaction({ gasPrice: BigNumber.from(0) })
        );
        provider.getGasPrice.mockImplementationOnce(() => {
          started.resolve();
          return pending.promise;
        });
      }
      const sending = sdk.sendTransactionWithEditedFee(
        ORIGINAL,
        phase === 'fee',
        options()
      );
      await started.promise;
      current = false;
      pending.resolve(
        phase === 'lookup' ? transaction() : BigNumber.from(1000)
      );
      await expect(sending).rejects.toThrow('PALI_TRANSACTION_CONTEXT_CHANGED');
      expect(getKey).not.toHaveBeenCalled();
      expect(provider.sendTransaction).not.toHaveBeenCalled();
    }
  );

  it('rejects a context change at credential handoff before invoking the local sender', async () => {
    getKey.mockImplementationOnce(() => {
      current = false;
      return { address: PAYER, decryptedPrivateKey: 'mocked-private-key' };
    });
    await expect(
      sdk.sendTransactionWithEditedFee(ORIGINAL, false, options())
    ).resolves.toMatchObject({ isSpeedUp: false, error: true });
    expect(sendLocalEvmTransaction).not.toHaveBeenCalled();
    expect(provider.sendTransaction).not.toHaveBeenCalled();
  });

  it('rejects a different decrypted signer before invoking the local sender', async () => {
    getKey.mockReturnValue({
      address: TARGET,
      decryptedPrivateKey: 'mocked-key',
    });
    await expect(
      sdk.sendTransactionWithEditedFee(ORIGINAL, false, options())
    ).resolves.toMatchObject({ isSpeedUp: false, error: true });
    expect(sendLocalEvmTransaction).not.toHaveBeenCalled();
    expect(provider.sendTransaction).not.toHaveBeenCalled();
  });

  it('checks context after local signing work and before broadcast', async () => {
    jest
      .mocked(sendLocalEvmTransaction)
      .mockImplementationOnce(async (capturedProvider, _key, _tx, before) => {
        await Promise.resolve();
        current = false;
        before?.();
        return capturedProvider.sendTransaction('mocked-signed-transaction');
      });
    await expect(
      sdk.sendTransactionWithEditedFee(ORIGINAL, false, options())
    ).resolves.toMatchObject({ isSpeedUp: false, error: true });
    expect(beforeBroadcast).not.toHaveBeenCalled();
    expect(provider.sendTransaction).not.toHaveBeenCalled();
  });

  it('rechecks context if the broadcast hook changes it', async () => {
    beforeBroadcast.mockImplementation(() => (current = false));
    await expect(
      sdk.sendTransactionWithEditedFee(ORIGINAL, false, options())
    ).resolves.toMatchObject({ isSpeedUp: false, error: true });
    expect(beforeBroadcast).toHaveBeenCalledTimes(1);
    expect(provider.sendTransaction).not.toHaveBeenCalled();
  });

  it('keeps acknowledged success after context changes while broadcast is in flight', async () => {
    provider.sendTransaction.mockImplementationOnce(async () => {
      current = false;
      return response;
    });
    await expect(
      sdk.sendTransactionWithEditedFee(ORIGINAL, false, options())
    ).resolves.toMatchObject({ isSpeedUp: true, transaction: response });
    expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('uses the captured provider for zero-fee enrichment and broadcast', async () => {
    provider.getTransaction.mockResolvedValue(
      transaction({ maxFeePerGas: BigNumber.from(0) })
    );
    const otherProvider = { getBalance: jest.fn(), sendTransaction: jest.fn() };
    provider.getBalance.mockImplementationOnce(async () => {
      currentProvider = otherProvider;
      return BigNumber.from('1000000000');
    });
    await expect(
      sdk.sendTransactionWithEditedFee(ORIGINAL, false, options())
    ).resolves.toMatchObject({ isSpeedUp: true, transaction: response });
    expect(provider.getBlock).toHaveBeenCalledWith('latest');
    expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
    expect(otherProvider.sendTransaction).not.toHaveBeenCalled();
  });

  it.each([
    { type: KeyringAccountType.Ledger, id: 4, legacy: false },
    { type: KeyringAccountType.Trezor, id: 5, legacy: false },
    { type: KeyringAccountType.Ledger, id: 4, legacy: true },
    { type: KeyringAccountType.Trezor, id: 5, legacy: true },
  ])(
    'preserves original nonce and selected device account for %j',
    async (target) => {
      provider.getTransaction.mockResolvedValue(transaction({ nonce: 0 }));
      validateOriginal.mockImplementation((tx) => {
        if (tx.nonce !== 0) throw new Error('Original nonce changed');
      });
      await expect(
        sdk.sendTransactionWithEditedFee(
          ORIGINAL,
          target.legacy,
          options(target)
        )
      ).resolves.toMatchObject({ isSpeedUp: true, transaction: response });
      expect(getKey).not.toHaveBeenCalled();
      const signed = provider.sendTransaction.mock.calls[0][0];
      const parsed = Transaction.from(signed);
      expect(parsed.nonce).toBe(0);
      expect(Number(parsed.chainId)).toBe(CHAIN);
      expect(parsed.from?.toLowerCase()).toBe(PAYER.toLowerCase());
      expect(parsed.to?.toLowerCase()).toBe(TARGET);
      if (target.type === KeyringAccountType.Ledger)
        expect(ledger.evm.signEVMTransaction).toHaveBeenCalledWith(
          expect.objectContaining({ accountIndex: 4 })
        );
      else
        expect(trezor.signEthTransaction).toHaveBeenCalledWith(
          expect.objectContaining({ index: '5', slip44: 60 })
        );
      expect(beforeBroadcast).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    { type: KeyringAccountType.Ledger, id: 4 },
    { type: KeyringAccountType.Trezor, id: 5 },
  ])(
    'rejects context changes during %j device signing before broadcast',
    async (target) => {
      if (target.type === KeyringAccountType.Ledger)
        ledger.evm.signEVMTransaction.mockImplementationOnce(
          async ({ rawTx }) => {
            const signature = await deviceSignature(`0x${rawTx}`);
            current = false;
            return {
              r: signature.r.slice(2),
              s: signature.s.slice(2),
              v: signature.v.toString(16),
            };
          }
        );
      else
        trezor.signEthTransaction.mockImplementationOnce(async ({ tx }) => {
          const signature = await deviceSignature(tx);
          current = false;
          return { success: true, payload: signature };
        });
      await expect(
        sdk.sendTransactionWithEditedFee(ORIGINAL, false, options(target))
      ).resolves.toMatchObject({ isSpeedUp: false, error: true });
      expect(provider.sendTransaction).not.toHaveBeenCalled();
    }
  );

  it.each([
    { type: KeyringAccountType.Ledger, id: 4 },
    { type: KeyringAccountType.Trezor, id: 5 },
  ])(
    'rejects a valid %j signature from a different device payer',
    async (target) => {
      if (target.type === KeyringAccountType.Ledger)
        ledger.evm.signEVMTransaction.mockImplementationOnce(
          async ({ rawTx }) => {
            const signature = await deviceSignature(
              `0x${rawTx}`,
              otherHardwareWallet
            );
            return {
              r: signature.r.slice(2),
              s: signature.s.slice(2),
              v: signature.v.toString(16),
            };
          }
        );
      else
        trezor.signEthTransaction.mockImplementationOnce(async ({ tx }) => ({
          success: true,
          payload: await deviceSignature(tx, otherHardwareWallet),
        }));
      await expect(
        sdk.sendTransactionWithEditedFee(ORIGINAL, false, options(target))
      ).resolves.toMatchObject({ isSpeedUp: false, error: true });
      expect(beforeBroadcast).not.toHaveBeenCalled();
      expect(provider.sendTransaction).not.toHaveBeenCalled();
    }
  );

  it.each([
    { type: KeyringAccountType.Ledger, id: 4 },
    { type: KeyringAccountType.Trezor, id: 5 },
  ])(
    'rejects a malformed %j device signature without broadcasting',
    async (target) => {
      if (target.type === KeyringAccountType.Ledger)
        ledger.evm.signEVMTransaction.mockResolvedValueOnce({
          r: 'invalid',
          s: 'invalid',
          v: '1b',
        });
      else
        trezor.signEthTransaction.mockResolvedValueOnce({
          success: true,
          payload: { r: 'invalid', s: 'invalid', v: 27 },
        });
      await expect(
        sdk.sendTransactionWithEditedFee(ORIGINAL, false, options(target))
      ).resolves.toMatchObject({ isSpeedUp: false, error: true });
      expect(beforeBroadcast).not.toHaveBeenCalled();
      expect(provider.sendTransaction).not.toHaveBeenCalled();
    }
  );

  it('passes the exact account to the actual keyring credential getter without replacing the vault getter', async () => {
    const manager: any = new KeyringManager();
    const vault = {
      activeNetwork: state.activeNetwork,
      activeAccount: smart,
      accounts: {
        ...state.accounts,
        [payer.type]: {
          [payer.id]: { address: PAYER, xprv: 'synthetic-payer-ciphertext' },
        },
        [smart.type]: {
          [smart.id]: { address: SMART, xprv: 'synthetic-smart-ciphertext' },
        },
      },
    };
    manager.setVaultStateGetter(() => vault);
    const replaceGetter = jest.spyOn(manager, 'setVaultStateGetter');
    manager.sessionPassword = {};
    manager.withSecureData = (read: (password: string) => unknown) =>
      read('synthetic-session-password');
    mockAes.decrypt.mockImplementation((ciphertext: string) => ({
      toString: () =>
        ciphertext === 'synthetic-smart-ciphertext' ? '' : 'mocked-private-key',
    }));
    jest.mocked(privateKeyToAccount).mockReturnValue({ address: PAYER } as any);
    Object.defineProperty(manager.ethereumTransaction, 'web3Provider', {
      get: () => provider,
    });
    const result =
      await manager.ethereumTransaction.sendTransactionWithEditedFee(
        ORIGINAL,
        false,
        options()
      );
    expect(mockAes.decrypt).toHaveBeenCalledWith(
      'synthetic-payer-ciphertext',
      'synthetic-session-password'
    );
    expect(result).toMatchObject({ isSpeedUp: true, transaction: response });
    expect(replaceGetter).not.toHaveBeenCalled();
    expect(vault.activeAccount).toBe(smart);
    expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('blocks actual local signing after context changes during provider preflight', async () => {
    const localSigner = jest.requireActual(
      '@sidhujag/sysweb3-keyring/cjs/transactions/evm-local-signer'
    );
    jest.spyOn(localSigner, 'privateKeyToAccount').mockReturnValue({
      address: PAYER,
    });
    const sign = jest
      .spyOn(localSigner, 'signTransaction')
      .mockReturnValue('mocked-signed-transaction');
    provider.verifyConfiguredChainId = jest.fn(async () => {
      current = false;
    });
    await expect(
      localSigner.sendLocalEvmTransaction(
        provider,
        'mocked-private-key',
        transaction(),
        beforeBroadcast,
        options().assertCurrentContext
      )
    ).rejects.toThrow('PALI_TRANSACTION_CONTEXT_CHANGED');
    expect(sign).not.toHaveBeenCalled();
    expect(beforeBroadcast).not.toHaveBeenCalled();
    expect(provider.sendTransaction).not.toHaveBeenCalled();
  });

  it('passes the pre-sign context guard through the scoped SDK sender', async () => {
    const localSigner = jest.requireActual(
      '@sidhujag/sysweb3-keyring/cjs/transactions/evm-local-signer'
    );
    jest.spyOn(localSigner, 'privateKeyToAccount').mockReturnValue({
      address: PAYER,
    });
    const sign = jest
      .spyOn(localSigner, 'signTransaction')
      .mockReturnValue('mocked-signed-transaction');
    provider.verifyConfiguredChainId = jest.fn(async () => {
      current = false;
    });
    jest
      .mocked(sendLocalEvmTransaction)
      .mockImplementationOnce(localSigner.sendLocalEvmTransaction);
    await expect(
      sdk.sendTransactionWithEditedFee(ORIGINAL, false, options())
    ).resolves.toMatchObject({ isSpeedUp: false, error: true });
    expect(sign).not.toHaveBeenCalled();
    expect(beforeBroadcast).not.toHaveBeenCalled();
    expect(provider.sendTransaction).not.toHaveBeenCalled();
  });
});
