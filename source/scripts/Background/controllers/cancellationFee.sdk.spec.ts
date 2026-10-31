/** @jest-environment node */
import { BigNumber } from '@sidhujag/sysweb3-keyring/cjs/ethers-v6';
import { EthereumTransactions } from '@sidhujag/sysweb3-keyring/cjs/transactions/ethereum';
import { KeyringAccountType } from '@sidhujag/sysweb3-keyring/cjs/types';
import { Wallet, Transaction } from 'ethers';

const signer = new Wallet(`0x${'11'.repeat(32)}`); // disposable public test key
const guard = { assertCurrentContext: jest.fn(), validateOriginal: jest.fn() };

describe.each([true, false])(
  'cancellation fee approval (legacy=%s)',
  (legacy) => {
    it('previews without signing, signs a bounded envelope, and rejects a higher later fee', async () => {
      const signed = await signer.signTransaction(
        legacy
          ? {
              chainId: 1,
              type: 0,
              nonce: 0,
              to: signer.address,
              gasLimit: 21000,
              gasPrice: 10,
              value: 0,
            }
          : {
              chainId: 1,
              type: 2,
              nonce: 0,
              to: signer.address,
              gasLimit: 21000,
              maxFeePerGas: 10,
              maxPriorityFeePerGas: 2,
              value: 0,
            }
      );
      const original = Transaction.from(signed);
      const row = {
        ...original.toJSON(),
        hash: original.hash,
        from: original.from,
        signature: original.signature,
        gasPrice:
          original.gasPrice === null ? null : BigNumber.from(original.gasPrice),
        maxFeePerGas:
          original.maxFeePerGas === null
            ? null
            : BigNumber.from(original.maxFeePerGas),
        maxPriorityFeePerGas:
          original.maxPriorityFeePerGas === null
            ? null
            : BigNumber.from(original.maxPriorityFeePerGas),
        gasLimit: BigNumber.from(original.gasLimit),
        value: BigNumber.from(original.value),
        blockNumber: null,
        blockHash: null,
      };
      const state: any = {
        activeAccountType: KeyringAccountType.HDAccount,
        activeAccountId: 0,
        accounts: { HDAccount: { 0: { address: signer.address } } },
        activeNetwork: {
          kind: 'ethereum',
          chainId: 1,
          slip44: 60,
          url: 'https://fixture.invalid',
        },
      };
      let price = 10;
      const provider: any = {
        getTransaction: jest.fn(async () => row),
        getGasPrice: jest.fn(async () => BigNumber.from(price)),
        verifyConfiguredChainId: jest.fn(async () => undefined),
        getNetwork: jest.fn(async () => ({ chainId: 1 })),
        sendTransaction: jest.fn(async (raw: string) => ({
          hash: Transaction.from(raw).hash,
          raw,
        })),
      };
      const key = jest.fn(() => ({
        address: signer.address,
        decryptedPrivateKey: signer.privateKey,
      }));
      const sdk = new EthereumTransactions(
        () => state.activeNetwork,
        key,
        () => state,
        {} as any,
        {} as any
      );
      Object.defineProperty(sdk, 'web3Provider', { get: () => provider });
      jest
        .spyOn(sdk, 'getFeeDataWithDynamicMaxPriorityFeePerGas')
        .mockImplementation(
          async () =>
            ({
              maxFeePerGas: BigNumber.from(price),
              maxPriorityFeePerGas: BigNumber.from(2),
            } as any)
        );
      const preview = await sdk.cancelSentTransaction(
        original.hash!,
        legacy,
        0,
        { ...guard, previewOnly: true }
      );
      expect(preview.maximumFee).toBe('504000');
      expect(key).not.toHaveBeenCalled();
      expect(provider.sendTransaction).not.toHaveBeenCalled();
      const accepted = await sdk.cancelSentTransaction(
        original.hash!,
        legacy,
        0,
        { ...guard, approvedMaximumFee: preview.maximumFee }
      );
      expect(accepted.isCanceled).toBe(true);
      const broadcast = Transaction.from(
        provider.sendTransaction.mock.calls[0][0]
      );
      const cap = legacy ? broadcast.gasPrice! : broadcast.maxFeePerGas!;
      expect(broadcast.gasLimit * cap).toBeLessThanOrEqual(
        BigInt(preview.maximumFee!)
      );
      provider.sendTransaction.mockClear();
      key.mockClear();
      price = 20;
      await expect(
        sdk.cancelSentTransaction(original.hash!, legacy, 0, {
          ...guard,
          approvedMaximumFee: preview.maximumFee,
        })
      ).rejects.toThrow('Cancellation fee exceeds approval');
      expect(key).not.toHaveBeenCalled();
      expect(provider.sendTransaction).not.toHaveBeenCalled();
    });
  }
);

describe.each([KeyringAccountType.Ledger, KeyringAccountType.Trezor])(
  '%s cancellation device boundary',
  (type) => {
    it.each([true, false])(
      'approves the device envelope and rejects repricing (legacy=%s)',
      async (legacy) => {
        const state: any = {
          activeAccountType: type,
          activeAccountId: 0,
          accounts: { [type]: { 0: { address: signer.address } } },
          activeNetwork: {
            kind: 'ethereum',
            chainId: 1,
            slip44: 60,
            currency: 'ETH',
            url: 'https://fixture.invalid',
          },
        };
        let price = 10;
        const provider: any = {
          getTransaction: jest.fn(async () => null),
          getGasPrice: jest.fn(async () => BigNumber.from(price)),
          sendTransaction: jest.fn(),
        };
        const ledger = {
          evm: {
            signEVMTransaction: jest.fn(async (params: any) => {
              void params;
              return undefined;
            }),
          },
        };
        const trezor = {
          signEthTransaction: jest.fn(async (params: any) => {
            void params;
            return { success: false };
          }),
        };
        const validateOriginal = jest.fn();
        const options = { assertCurrentContext: jest.fn(), validateOriginal };
        const sdk = new EthereumTransactions(
          () => state.activeNetwork,
          jest.fn(),
          () => state,
          ledger as any,
          trezor as any
        );
        Object.defineProperty(sdk, 'web3Provider', { get: () => provider });
        jest
          .spyOn(sdk, 'getFeeDataWithDynamicMaxPriorityFeePerGas')
          .mockImplementation(
            async () =>
              ({
                maxFeePerGas: BigNumber.from(price),
                maxPriorityFeePerGas: BigNumber.from(2),
              } as any)
          );
        const preview = await sdk.cancelSentTransaction(
          `0x${'22'.repeat(32)}`,
          legacy,
          7,
          { ...options, previewOnly: true }
        );
        expect(validateOriginal).toHaveBeenCalledWith(null);
        expect(ledger.evm.signEVMTransaction).not.toHaveBeenCalled();
        expect(trezor.signEthTransaction).not.toHaveBeenCalled();
        expect(provider.sendTransaction).not.toHaveBeenCalled();
        await sdk.cancelSentTransaction(`0x${'22'.repeat(32)}`, legacy, 7, {
          ...options,
          approvedMaximumFee: preview.maximumFee,
        });
        const envelope =
          type === KeyringAccountType.Ledger
            ? Transaction.from(
                `0x${ledger.evm.signEVMTransaction.mock.calls[0][0].rawTx}`
              )
            : Transaction.from(trezor.signEthTransaction.mock.calls[0][0].tx);
        expect(
          envelope.gasLimit *
            (legacy ? envelope.gasPrice! : envelope.maxFeePerGas!)
        ).toBeLessThanOrEqual(BigInt(preview.maximumFee!));
        ledger.evm.signEVMTransaction.mockClear();
        trezor.signEthTransaction.mockClear();
        price = 20;
        await expect(
          sdk.cancelSentTransaction(`0x${'22'.repeat(32)}`, legacy, 7, {
            ...options,
            approvedMaximumFee: preview.maximumFee,
          })
        ).rejects.toThrow('Cancellation fee exceeds approval');
        expect(ledger.evm.signEVMTransaction).not.toHaveBeenCalled();
        expect(trezor.signEthTransaction).not.toHaveBeenCalled();
        expect(provider.sendTransaction).not.toHaveBeenCalled();
      }
    );
  }
);

it.each([undefined, '', '-1', '00', '1e6', '1'.repeat(79)])(
  'rejects invalid cancellation approval %p before lookup',
  async (approvedMaximumFee) => {
    const state: any = {
      activeAccountType: KeyringAccountType.HDAccount,
      activeAccountId: 0,
      accounts: { HDAccount: { 0: { address: signer.address } } },
      activeNetwork: {
        kind: 'ethereum',
        chainId: 1,
        slip44: 60,
        url: 'https://fixture.invalid',
      },
    };
    const provider: any = {
      getTransaction: jest.fn(),
      sendTransaction: jest.fn(),
    };
    const key = jest.fn();
    const sdk = new EthereumTransactions(
      () => state.activeNetwork,
      key,
      () => state,
      {} as any,
      {} as any
    );
    Object.defineProperty(sdk, 'web3Provider', { get: () => provider });
    await expect(
      sdk.cancelSentTransaction(`0x${'22'.repeat(32)}`, true, 0, {
        ...guard,
        approvedMaximumFee,
      })
    ).rejects.toThrow('Cancellation fee approval required');
    expect(provider.getTransaction).not.toHaveBeenCalled();
    expect(key).not.toHaveBeenCalled();
    expect(provider.sendTransaction).not.toHaveBeenCalled();
  }
);

it('rejects a cancellation quote if the original-validation or session guard changes while lookup is pending', async () => {
  const state: any = {
    activeAccountType: KeyringAccountType.HDAccount,
    activeAccountId: 0,
    accounts: { HDAccount: { 0: { address: signer.address } } },
    activeNetwork: {
      kind: 'ethereum',
      chainId: 1,
      slip44: 60,
      url: 'https://fixture.invalid',
    },
  };
  let finish!: (value: null) => void;
  const provider: any = {
    getTransaction: jest.fn(
      () =>
        new Promise<null>((resolve) => {
          finish = resolve;
        })
    ),
    getGasPrice: jest.fn(),
    sendTransaction: jest.fn(),
  };
  const key = jest.fn();
  let current = true;
  const sdk = new EthereumTransactions(
    () => state.activeNetwork,
    key,
    () => state,
    {} as any,
    {} as any
  );
  Object.defineProperty(sdk, 'web3Provider', { get: () => provider });
  const pending = sdk.cancelSentTransaction(`0x${'22'.repeat(32)}`, true, 7, {
    previewOnly: true,
    assertCurrentContext: () => {
      if (!current) throw new Error('context changed');
    },
    validateOriginal: () => {
      throw new Error('fallback not authenticated');
    },
  });
  current = false;
  finish(null);
  await expect(pending).rejects.toThrow('context changed');
  expect(provider.getGasPrice).not.toHaveBeenCalled();
  expect(key).not.toHaveBeenCalled();
  expect(provider.sendTransaction).not.toHaveBeenCalled();
});

it('keeps selected smart-account state untouched during overlapping held payer previews', async () => {
  const smartAddress = `0x${'44'.repeat(20)}`;
  const state: any = {
    activeAccountType: KeyringAccountType.SmartAccount,
    activeAccountId: 0,
    accounts: {
      SmartAccount: { 0: { address: smartAddress } },
      HDAccount: { 0: { address: signer.address } },
    },
    activeNetwork: {
      kind: 'ethereum',
      chainId: 1,
      slip44: 60,
      url: 'https://fixture.invalid',
    },
  };
  const releases: Array<(value: null) => void> = [];
  const provider: any = {
    getTransaction: jest.fn(
      () => new Promise<null>((resolve) => releases.push(resolve))
    ),
    getGasPrice: jest.fn(async () => BigNumber.from(10)),
    sendTransaction: jest.fn(),
  };
  const key = jest.fn();
  const sdk = new EthereumTransactions(
    () => state.activeNetwork,
    key,
    () => state,
    {} as any,
    {} as any
  );
  Object.defineProperty(sdk, 'web3Provider', { get: () => provider });
  const targetAccount = { type: KeyringAccountType.HDAccount, id: 0 };
  const opts = { ...guard, targetAccount, previewOnly: true };
  const first = sdk.cancelSentTransaction(
    `0x${'22'.repeat(32)}`,
    true,
    0,
    opts
  );
  const second = sdk.cancelSentTransaction(
    `0x${'33'.repeat(32)}`,
    true,
    1,
    opts
  );
  expect(state.activeAccountType).toBe(KeyringAccountType.SmartAccount);
  expect(
    state.accounts[state.activeAccountType][state.activeAccountId].address
  ).toBe(smartAddress);
  releases[0](null);
  expect((await first).maximumFee).toBe('504000');
  expect(state.activeAccountType).toBe(KeyringAccountType.SmartAccount);
  releases[1](null);
  expect((await second).maximumFee).toBe('504000');
  expect(state.activeAccountType).toBe(KeyringAccountType.SmartAccount);
  expect(key).not.toHaveBeenCalled();
  expect(provider.sendTransaction).not.toHaveBeenCalled();
  provider.getTransaction.mockResolvedValue(null);
  provider.verifyConfiguredChainId = jest.fn(async () => undefined);
  provider.getNetwork = jest.fn(async () => ({ chainId: 1 }));
  provider.sendTransaction.mockImplementation(async (raw: string) => ({
    hash: Transaction.from(raw).hash,
  }));
  key.mockImplementation((target) => {
    expect(target).toEqual(targetAccount);
    expect(state.activeAccountType).toBe(KeyringAccountType.SmartAccount);
    return { address: signer.address, decryptedPrivateKey: signer.privateKey };
  });
  const submitted = await sdk.cancelSentTransaction(
    `0x${'22'.repeat(32)}`,
    true,
    0,
    {
      ...guard,
      targetAccount,
      approvedMaximumFee: '504000',
    }
  );
  expect(submitted.isCanceled).toBe(true);
  const envelope = Transaction.from(provider.sendTransaction.mock.calls[0][0]);
  expect(envelope.from).toBe(signer.address);
  expect(envelope.gasLimit * envelope.gasPrice!).toBeLessThanOrEqual(
    BigInt(504000)
  );
  expect(state.activeAccountType).toBe(KeyringAccountType.SmartAccount);
});
