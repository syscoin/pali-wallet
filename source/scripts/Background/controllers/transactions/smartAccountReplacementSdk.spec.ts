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
// Connect's protocol encoder is real; its unused standalone serialization
// dependencies need no crypto implementation in these device-I/O tests.
jest.mock('@ethereumjs/common', () => ({}));
jest.mock('@ethereumjs/tx', () => ({}));

const mockAes = jest.requireMock('crypto-js').AES;

// Deliberately public deterministic test keys, with no provider or live account.
const hardwareWallet = new Wallet(`0x${'11'.repeat(32)}`);
const otherHardwareWallet = new Wallet(`0x${'22'.repeat(32)}`);
const PAYER = hardwareWallet.address;
const SMART = `0x${'22'.repeat(20)}`;
const TARGET = `0x${'33'.repeat(20)}`;
const REPLACEMENT = `0x${'55'.repeat(32)}`;
const CHAIN = 5700;
const payer = { type: KeyringAccountType.HDAccount, id: 3 };
const smart = { type: KeyringAccountType.SmartAccount, id: 7 };
const response = { hash: REPLACEMENT, from: PAYER, nonce: 8, chainId: CHAIN };
const ACCESS_LIST = [
  { address: TARGET, storageKeys: [`0x${'66'.repeat(32)}`] },
];
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
    accessList: tx.accessList,
    ...(tx.type === 0 || tx.type === 1
      ? { gasPrice: tx.gasPrice }
      : {
          maxFeePerGas: tx.maxFeePerGas,
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
        }),
  });
  const signature = Transaction.from(signed).signature!;
  return { r: signature.r, s: signature.s, v: signature.v };
};
const transaction = (fields: any = {}, wallet = hardwareWallet) => {
  const type = fields.type ?? 2;
  const scalar = (value: any) => value.toString();
  const signed = Transaction.from({
    type,
    to: fields.to ?? TARGET,
    nonce: fields.nonce ?? 8,
    chainId: scalar(fields.chainId ?? CHAIN),
    value: scalar(fields.value ?? 7),
    data: fields.data ?? '0x1234',
    gasLimit: scalar(fields.gasLimit ?? 21000),
    ...(type === 0 || type === 1
      ? { gasPrice: scalar(fields.gasPrice ?? 100) }
      : {
          maxFeePerGas: scalar(fields.maxFeePerGas ?? 100),
          maxPriorityFeePerGas: scalar(fields.maxPriorityFeePerGas ?? 10),
        }),
    ...(type === 1 || type === 2
      ? { accessList: fields.accessList ?? [] }
      : {}),
  });
  signed.signature = wallet.signingKey.sign(signed.unsignedHash);
  return {
    hash: signed.hash!,
    from: signed.from!,
    to: signed.to,
    type: signed.type,
    nonce: signed.nonce,
    chainId: Number(signed.chainId),
    value: BigNumber.from(signed.value),
    data: signed.data,
    gasLimit: BigNumber.from(signed.gasLimit),
    gasPrice: BigNumber.from(signed.gasPrice ?? signed.maxFeePerGas ?? 0),
    maxFeePerGas:
      signed.maxFeePerGas === null ? null : BigNumber.from(signed.maxFeePerGas),
    maxPriorityFeePerGas:
      signed.maxPriorityFeePerGas === null
        ? null
        : BigNumber.from(signed.maxPriorityFeePerGas),
    accessList: signed.accessList,
    signature: signed.signature,
    ...fields,
  };
};
const ORIGINAL = transaction().hash;
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
  const useOriginal = (original: any) => {
    provider.getTransaction.mockResolvedValue(original);
    validateOriginal.mockImplementation((tx) => {
      if (tx.hash !== original.hash || tx.nonce !== Number(original.nonce))
        throw new Error('Original transaction changed');
    });
    return original.hash as string;
  };

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
      const hash = useOriginal(transaction({ type: legacy ? 0 : 2 }));
      await expect(
        sdk.sendTransactionWithEditedFee(hash, legacy, options())
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

  describe.each(['scoped', 'ordinary'] as const)(
    'authenticated originals through the %s API',
    (caller) => {
      const send = (hash: string, legacy = false) => {
        if (caller === 'ordinary') {
          state.activeAccountType = payer.type;
          state.activeAccountId = payer.id;
          return sdk.sendTransactionWithEditedFee(hash, legacy);
        }
        return sdk.sendTransactionWithEditedFee(hash, legacy, options());
      };
      const expectNoSigning = () => {
        expect(provider.getBalance).not.toHaveBeenCalled();
        expect(getKey).not.toHaveBeenCalled();
        expect(sendLocalEvmTransaction).not.toHaveBeenCalled();
        expect(ledger.evm.signEVMTransaction).not.toHaveBeenCalled();
        expect(trezor.signEthTransaction).not.toHaveBeenCalled();
        expect(beforeBroadcast).not.toHaveBeenCalled();
        expect(provider.sendTransaction).not.toHaveBeenCalled();
      };

      it.each([
        { type: 0, raw: false },
        { type: 1, raw: false },
        { type: 2, raw: false },
        { type: 0, raw: true },
        { type: 1, raw: true },
        { type: 2, raw: true },
      ])(
        'accepts the signed original representation %j',
        async ({ type, raw }) => {
          const original: any = transaction({
            type,
            ...(type ? { accessList: ACCESS_LIST } : {}),
          });
          if (raw) {
            const signature = Transaction.from(
              serializeTransaction(original, original.signature)
            ).signature!;
            original.r = signature.r;
            original.s = signature.s;
            original.v = Number(signature.networkV ?? signature.v);
            delete original.signature;
          }
          const hash = useOriginal(original);
          await expect(send(hash, type !== 2)).resolves.toMatchObject({
            isSpeedUp: true,
            transaction: response,
          });
          const tx = jest.mocked(sendLocalEvmTransaction).mock.calls[0][2];
          expect(tx.nonce).toBe(8);
          expect(tx.value.toString()).toBe('7');
          expect(tx.data).toBe('0x1234');
          if (type) expect(tx.accessList).toEqual(ACCESS_LIST);
          if (type === 1) expect(tx.type).toBe(1);
          expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
        }
      );

      it('accepts an ethers-style type2 original with null derived gasPrice', async () => {
        const original = transaction();
        const hash = useOriginal({ ...original, gasPrice: null });
        await expect(send(hash)).resolves.toMatchObject({ isSpeedUp: true });
        const tx = jest.mocked(sendLocalEvmTransaction).mock.calls[0][2];
        expect(tx.maxFeePerGas.toString()).toBe('120');
        expect(tx.data).toBe('0x1234');
        expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
      });

      it.each([1, 2])(
        'accepts raw RPC parity v for signed type%s',
        async (type) => {
          const original: any = transaction({ type });
          original.r = original.signature.r;
          original.s = original.signature.s;
          original.v = original.signature.yParity;
          delete original.signature;
          const hash = useOriginal(original);
          await expect(send(hash, type === 1)).resolves.toMatchObject({
            isSpeedUp: true,
          });
          expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
        }
      );

      it.each([
        { type: 0, encoding: 'decimal' },
        { type: 0, encoding: 'hex' },
        { type: 2, encoding: 'decimal' },
        { type: 2, encoding: 'hex' },
      ])(
        'accepts equivalent numeric fields and raw signature v %j',
        async ({ type, encoding }) => {
          const original: any = transaction({ type });
          const signature = Transaction.from(
            serializeTransaction(original, original.signature)
          ).signature!;
          original.r = signature.r;
          original.s = signature.s;
          original.v = signature.networkV ?? signature.v;
          delete original.signature;
          const fields = [
            'type',
            'nonce',
            'chainId',
            'value',
            'gasLimit',
            'v',
            ...(type === 0
              ? ['gasPrice']
              : ['maxFeePerGas', 'maxPriorityFeePerGas']),
          ];
          for (const field of fields) {
            const number = BigInt(original[field].toString());
            original[field] =
              encoding === 'hex'
                ? `0x${number.toString(16)}`
                : number.toString();
          }
          const hash = useOriginal(original);
          await expect(send(hash, type === 0)).resolves.toMatchObject({
            isSpeedUp: true,
          });
          const tx = jest.mocked(sendLocalEvmTransaction).mock.calls[0][2];
          expect(tx.nonce).toBe(8);
          expect(Number(tx.chainId)).toBe(CHAIN);
          expect(tx.value.toString()).toBe('7');
          expect((type === 0 ? tx.gasPrice : tx.maxFeePerGas).toString()).toBe(
            '120'
          );
          expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
        }
      );

      it.each([
        ['missing signature', { signature: undefined }],
        [
          'zero signature',
          {
            signature: undefined,
            r: `0x${'00'.repeat(32)}`,
            s: `0x${'00'.repeat(32)}`,
            v: 27,
          },
        ],
        ['incomplete signature', { signature: undefined, v: 27 }],
        ['different hash', { hash: REPLACEMENT }],
        ['different sender', { from: TARGET }],
        ['different chain', { chainId: 1 }],
        [
          'substituted signature',
          { signature: transaction({}, otherHardwareWallet).signature },
        ],
        ['substituted supported type', { type: 1 }],
        ['substituted nonce', { nonce: 9 }],
        ['substituted recipient', { to: SMART }],
        ['substituted value', { value: BigNumber.from(8) }],
        ['substituted calldata', { data: '0x5678' }],
        ['substituted gas limit', { gasLimit: BigNumber.from(22000) }],
        ['substituted max fee', { maxFeePerGas: BigNumber.from(101) }],
        [
          'substituted priority fee',
          { maxPriorityFeePerGas: BigNumber.from(11) },
        ],
        ['substituted access list', { accessList: ACCESS_LIST }],
        ['unsupported blob type', { type: 3 }],
        ['unsupported authorization type', { type: 4 }],
      ])(
        'rejects %s before balance, credentials, or devices',
        async (_label, fields) => {
          provider.getTransaction.mockResolvedValue({
            ...transaction(),
            ...fields,
          });
          await expect(send(ORIGINAL)).rejects.toThrow();
          expectNoSigning();
        }
      );

      it('rejects a substituted legacy gas price before credentials or devices', async () => {
        const original = transaction({ type: 0 });
        const hash = useOriginal(original);
        provider.getTransaction.mockResolvedValue({
          ...original,
          gasPrice: BigNumber.from(101),
        });
        await expect(send(hash, true)).rejects.toThrow();
        expectNoSigning();
      });

      it.each([0, 1])(
        'rejects an intact signed original on incompatible chain %s before signer access',
        async (chainId) => {
          const hash = useOriginal(
            transaction({ chainId, ...(chainId === 0 ? { type: 0 } : {}) })
          );
          await expect(send(hash, chainId === 0)).rejects.toThrow();
          expectNoSigning();
        }
      );

      it('rejects an intact signed original from another payer before signer access', async () => {
        const hash = useOriginal(transaction({}, otherHardwareWallet));
        await expect(send(hash)).rejects.toThrow();
        expectNoSigning();
      });

      it.each([false, true])(
        'authenticates a transaction first found on retry (tampered=%s)',
        async (tampered) => {
          jest.useFakeTimers();
          try {
            provider.getTransaction
              .mockResolvedValueOnce(null)
              .mockResolvedValueOnce({
                ...transaction(),
                ...(tampered ? { data: '0x5678' } : {}),
              });
            const pending = send(ORIGINAL);
            const assertion = tampered
              ? expect(pending).rejects.toThrow()
              : expect(pending).resolves.toMatchObject({ isSpeedUp: true });
            await jest.advanceTimersByTimeAsync(500);
            await assertion;
            expect(provider.getTransaction).toHaveBeenCalledTimes(2);
            if (tampered) expectNoSigning();
            else expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
          } finally {
            jest.useRealTimers();
          }
        }
      );

      it('detaches the authenticated body before deferred balance work', async () => {
        const original: any = transaction({
          accessList: JSON.parse(JSON.stringify(ACCESS_LIST)),
        });
        const expectedAccessList = JSON.parse(
          JSON.stringify(original.accessList)
        );
        const hash = useOriginal(original);
        const pendingBalance = deferred<any>();
        const started = deferred<void>();
        provider.getBalance.mockImplementationOnce(() => {
          started.resolve();
          return pendingBalance.promise;
        });
        const pending = send(hash);
        await started.promise;
        Object.assign(original, {
          hash: REPLACEMENT,
          from: SMART,
          to: SMART,
          nonce: 9,
          chainId: 1,
          value: BigNumber.from(8),
          data: '0x5678',
          gasLimit: BigNumber.from(1),
          maxFeePerGas: BigNumber.from(1),
          maxPriorityFeePerGas: BigNumber.from(1),
          signature: undefined,
        });
        original.accessList[0].storageKeys[0] = `0x${'77'.repeat(32)}`;
        pendingBalance.resolve(BigNumber.from('1000000000'));
        await expect(pending).resolves.toMatchObject({ isSpeedUp: true });
        const tx = jest.mocked(sendLocalEvmTransaction).mock.calls[0][2];
        expect(tx).toMatchObject({
          from: PAYER,
          to: TARGET,
          nonce: 8,
          chainId: CHAIN,
          data: '0x1234',
          accessList: expectedAccessList,
        });
        expect(tx.value.toString()).toBe('7');
        expect(tx.gasLimit.toString()).toBe('25200');
        expect(tx.maxFeePerGas.toString()).toBe('120');
        expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
      });
    }
  );

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
      provider.getTransaction.mockResolvedValue({
        ...transaction(),
        ...fields,
      });
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
      let hash = ORIGINAL;
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
        hash = useOriginal(
          transaction({ type: 0, gasPrice: BigNumber.from(0) })
        );
        provider.getGasPrice.mockImplementationOnce(() => {
          started.resolve();
          return pending.promise;
        });
      }
      const sending = sdk.sendTransactionWithEditedFee(
        hash,
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
    const hash = useOriginal(
      transaction({
        maxFeePerGas: BigNumber.from(0),
        maxPriorityFeePerGas: BigNumber.from(0),
      })
    );
    const otherProvider = { getBalance: jest.fn(), sendTransaction: jest.fn() };
    provider.getBalance.mockImplementationOnce(async () => {
      currentProvider = otherProvider;
      return BigNumber.from('1000000000');
    });
    await expect(
      sdk.sendTransactionWithEditedFee(hash, false, options())
    ).resolves.toMatchObject({ isSpeedUp: true, transaction: response });
    expect(provider.getBlock).toHaveBeenCalledWith('latest');
    expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
    expect(otherProvider.sendTransaction).not.toHaveBeenCalled();
  });

  it.each([
    { type: KeyringAccountType.Ledger, id: 4, legacy: false, originalType: 2 },
    { type: KeyringAccountType.Trezor, id: 5, legacy: false, originalType: 2 },
    { type: KeyringAccountType.Ledger, id: 4, legacy: true, originalType: 0 },
    { type: KeyringAccountType.Trezor, id: 5, legacy: true, originalType: 0 },
    { type: KeyringAccountType.Ledger, id: 4, legacy: true, originalType: 1 },
  ])(
    'preserves original nonce and selected device account for %j',
    async (target) => {
      const hash = useOriginal(
        transaction({
          nonce: 0,
          type: target.originalType,
          ...(target.originalType ? { accessList: ACCESS_LIST } : {}),
        })
      );
      await expect(
        sdk.sendTransactionWithEditedFee(hash, target.legacy, options(target))
      ).resolves.toMatchObject({ isSpeedUp: true, transaction: response });
      expect(getKey).not.toHaveBeenCalled();
      const signed = provider.sendTransaction.mock.calls[0][0];
      const parsed = Transaction.from(signed);
      expect(parsed.nonce).toBe(0);
      expect(parsed.type).toBe(target.originalType);
      expect(Number(parsed.chainId)).toBe(CHAIN);
      expect(parsed.from?.toLowerCase()).toBe(PAYER.toLowerCase());
      expect(parsed.to?.toLowerCase()).toBe(TARGET);
      if (target.originalType) expect(parsed.accessList).toEqual(ACCESS_LIST);
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

  it.each(['scoped', 'ordinary'] as const)(
    'rejects unsupported Trezor type1 legacy signing through the %s API before balance or device access',
    async (caller) => {
      const target = { type: KeyringAccountType.Trezor, id: 5 };
      const hash = useOriginal(
        transaction({ type: 1, accessList: ACCESS_LIST })
      );
      if (caller === 'ordinary') {
        state.activeAccountType = target.type;
        state.activeAccountId = target.id;
      }
      await expect(
        sdk.sendTransactionWithEditedFee(
          hash,
          true,
          caller === 'scoped' ? options(target) : undefined
        )
      ).rejects.toThrow('Trezor does not support type 1 replacement signing');
      expect(provider.getBalance).not.toHaveBeenCalled();
      expect(getKey).not.toHaveBeenCalled();
      expect(sendLocalEvmTransaction).not.toHaveBeenCalled();
      expect(trezor.signEthTransaction).not.toHaveBeenCalled();
      expect(ledger.evm.signEVMTransaction).not.toHaveBeenCalled();
      expect(provider.sendTransaction).not.toHaveBeenCalled();
    }
  );

  it.each(['scoped', 'ordinary'] as const)(
    'converts a Trezor type1 original to supported dynamic fees through the %s API using Connect access-list encoding',
    async (caller) => {
      const target = { type: KeyringAccountType.Trezor, id: 5 };
      const hash = useOriginal(
        transaction({ type: 1, nonce: 0, accessList: ACCESS_LIST })
      );
      const connect = jest.requireActual(
        '@trezor/connect/lib/api/ethereum/ethereumSignTx'
      );
      const strip = (value: string) => value.replace(/^0x/, '');
      const typedCall = jest.fn(async (method, _response, message) => {
        expect(method).toBe('EthereumSignTxEIP1559');
        const signature = await deviceSignature({
          type: 2,
          chainId: message.chain_id,
          nonce: `0x${message.nonce || '0'}`,
          to: message.to,
          value: `0x${message.value || '0'}`,
          data: `0x${message.data_initial_chunk}`,
          gasLimit: `0x${message.gas_limit}`,
          maxFeePerGas: `0x${message.max_gas_fee}`,
          maxPriorityFeePerGas: `0x${message.max_priority_fee}`,
          accessList: message.access_list.map((entry: any) => ({
            address: entry.address,
            storageKeys: entry.storage_keys,
          })),
        });
        return {
          message: {
            ['signature_v']: signature.v - 27,
            ['signature_r']: strip(signature.r),
            ['signature_s']: strip(signature.s),
          },
        };
      });
      trezor.signEthTransaction.mockImplementationOnce(async ({ tx }) => {
        expect(tx.type).toBe(2);
        expect(tx.gasPrice).toBeUndefined();
        expect(typeof tx.maxFeePerGas).toBe('string');
        expect(typeof tx.maxPriorityFeePerGas).toBe('string');
        return {
          success: true,
          payload: await connect.ethereumSignTxEIP1559(
            typedCall,
            [],
            tx.to,
            strip(tx.value),
            strip(tx.gasLimit),
            strip(tx.maxFeePerGas),
            strip(tx.maxPriorityFeePerGas),
            strip(tx.nonce),
            tx.chainId,
            false,
            strip(tx.data),
            tx.accessList
          ),
        };
      });
      if (caller === 'ordinary') {
        state.activeAccountType = target.type;
        state.activeAccountId = target.id;
      }
      await expect(
        sdk.sendTransactionWithEditedFee(
          hash,
          false,
          caller === 'scoped' ? options(target) : undefined
        )
      ).resolves.toMatchObject({ isSpeedUp: true, transaction: response });
      expect(typedCall).toHaveBeenCalledWith(
        'EthereumSignTxEIP1559',
        'EthereumTxRequest',
        expect.objectContaining({
          ['chain_id']: CHAIN,
          ['access_list']: ACCESS_LIST.map((entry) => ({
            address: entry.address,
            ['storage_keys']: entry.storageKeys,
          })),
        })
      );
      expect(getKey).not.toHaveBeenCalled();
      expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
      const parsed = Transaction.from(
        provider.sendTransaction.mock.calls[0][0]
      );
      expect(parsed.type).toBe(2);
      expect(parsed.nonce).toBe(0);
      expect(Number(parsed.chainId)).toBe(CHAIN);
      expect(parsed.from?.toLowerCase()).toBe(PAYER.toLowerCase());
      expect(parsed.to?.toLowerCase()).toBe(TARGET);
      expect(parsed.value).toBe(BigInt(7));
      expect(parsed.data).toBe('0x1234');
      expect(parsed.accessList).toEqual(ACCESS_LIST);
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
    { type: KeyringAccountType.Ledger, id: 4, ordinary: false },
    { type: KeyringAccountType.Trezor, id: 5, ordinary: false },
    { type: KeyringAccountType.Ledger, id: 4, ordinary: true },
    { type: KeyringAccountType.Trezor, id: 5, ordinary: true },
  ])(
    'rejects a valid %j signature from a different device payer',
    async (target) => {
      if (target.ordinary) {
        state.activeAccountType = target.type;
        state.activeAccountId = target.id;
      }
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
        sdk.sendTransactionWithEditedFee(
          ORIGINAL,
          false,
          target.ordinary ? undefined : options(target)
        )
      ).resolves.toMatchObject({ isSpeedUp: false, error: true });
      expect(beforeBroadcast).not.toHaveBeenCalled();
      expect(provider.sendTransaction).not.toHaveBeenCalled();
    }
  );

  it.each([
    { type: KeyringAccountType.Ledger, id: 4, ordinary: false },
    { type: KeyringAccountType.Trezor, id: 5, ordinary: false },
    { type: KeyringAccountType.Ledger, id: 4, ordinary: true },
    { type: KeyringAccountType.Trezor, id: 5, ordinary: true },
  ])(
    'rejects a malformed %j device signature without broadcasting',
    async (target) => {
      if (target.ordinary) {
        state.activeAccountType = target.type;
        state.activeAccountId = target.id;
      }
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
        sdk.sendTransactionWithEditedFee(
          ORIGINAL,
          false,
          target.ordinary ? undefined : options(target)
        )
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
