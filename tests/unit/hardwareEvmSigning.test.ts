jest.unmock('syscoinjs-lib');
jest.unmock('tiny-secp256k1');
jest.mock('@trezor/connect-webextension', () => ({
  __esModule: true,
  default: {
    ethereumSignTransaction: jest.fn(),
    dispose: jest.fn(),
    on: jest.fn(),
  },
  DEVICE_EVENT: 'device-event',
}));

import { HardwareWalletManager } from '@sidhujag/sysweb3-keyring/cjs/hardware-wallet-manager';
import { LedgerKeyring } from '@sidhujag/sysweb3-keyring/cjs/ledger';
import { EthereumTransactions } from '@sidhujag/sysweb3-keyring/cjs/transactions/ethereum';
import { TrezorKeyring } from '@sidhujag/sysweb3-keyring/cjs/trezor';
import { Interface } from 'ethers/abi';
import { Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';
import http from 'http';
import https from 'https';

// These are the installed keyring's transitive hardware packages, not new
// runtime dependencies of Pali. Connect is the explicitly mocked I/O boundary.
const { ledgerService } = jest.requireActual('@ledgerhq/hw-app-eth');
const TrezorConnect = jest.requireMock('@trezor/connect-webextension').default;

// Public deterministic test key only. Real SDK serializers, Ledger APDU encoder,
// Trezor request adapter and retry classification; no physical device or RPC.
const wallet = new Wallet(`0x${'11'.repeat(32)}`);
const recipient = `0x${'22'.repeat(20)}`;
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
};

describe.each(['Ledger', 'Trezor'] as const)(
  'installed %s ordinary EVM signing (mock physical device)',
  (kind) => {
    let state: any;
    let sdk: EthereumTransactions;
    let provider: any;
    let otherProvider: any;
    let device: jest.Mock;
    let transport: any;
    let manager: any;
    let getPrivateKey: jest.Mock;
    let expectedUnsigned: string;
    let deviceBytes: Buffer;
    let networkSpies: jest.SpyInstance[];

    const params = (legacy = false) => ({
      from: wallet.address,
      to: recipient,
      value: '12345',
      data: '0x',
      gasLimit: '21000',
      ...(legacy
        ? { gasPrice: '100' }
        : { maxFeePerGas: '100', maxPriorityFeePerGas: '2' }),
    });
    const send = (legacy = false) =>
      sdk.sendFormattedTransaction(params(legacy), legacy);
    const finishDelay = async () => {
      // Advance only the installed Trezor adapter's documented popup interval.
      // This is not a real wait or substitute for the actual device boundary.
      if (kind === 'Trezor') await jest.advanceTimersByTimeAsync(2000);
    };

    beforeEach(() => {
      jest.clearAllMocks();
      jest.useFakeTimers();
      const denyNetwork = () => {
        throw new Error('Hardware fixture must not access a network');
      };
      networkSpies = [
        jest.spyOn(http, 'request').mockImplementation(denyNetwork),
        jest.spyOn(http, 'get').mockImplementation(denyNetwork),
        jest.spyOn(https, 'request').mockImplementation(denyNetwork),
        jest.spyOn(https, 'get').mockImplementation(denyNetwork),
        jest.spyOn(globalThis, 'fetch').mockImplementation(denyNetwork),
      ];
      state = {
        activeAccountType: kind,
        activeAccountId: 0,
        accounts: { [kind]: { 0: { id: 0, address: wallet.address } } },
        activeNetwork: {
          chainId: 57057,
          kind: 'ethereum',
          currency: 'tsys',
          slip44: 60,
          url: 'https://rpc-a.invalid',
        },
      };
      const makeProvider = () => ({
        getTransactionCount: jest.fn().mockResolvedValue(7),
        sendTransaction: jest.fn(async (raw: string) => ({
          hash: Transaction.from(raw).hash,
        })),
      });
      provider = makeProvider();
      otherProvider = makeProvider();
      manager = Object.create(HardwareWalletManager.prototype);
      manager.retryConfig = {
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 5000,
        backoffMultiplier: 2,
      };
      manager.emit = jest.fn();
      manager.on = jest.fn();
      manager.delay = jest.fn().mockResolvedValue(undefined);
      manager.ensureConnection = jest.fn().mockResolvedValue(undefined);
      deviceBytes = Buffer.alloc(0);
      device = jest.fn(async (unsigned: string) => {
        const tx = Transaction.from(unsigned);
        return wallet.signingKey.sign(tx.unsignedHash);
      });
      transport = {
        decorateAppAPIMethods: jest.fn(),
        send: jest.fn(
          async (
            cla: number,
            ins: number,
            p1: number,
            p2: number,
            data: Buffer
          ) => {
            expect([cla, ins, p2]).toEqual([0xe0, 0x04, 0]);
            if (p1 === 0) deviceBytes = Buffer.alloc(0);
            const chunk = p1 === 0 ? data.subarray(1 + data[0] * 4) : data;
            deviceBytes = Buffer.concat([deviceBytes, chunk]);
            if (deviceBytes.length < expectedUnsigned.length / 2)
              return Buffer.alloc(65);
            expect(deviceBytes.toString('hex')).toBe(expectedUnsigned);
            const signature = await device(`0x${deviceBytes.toString('hex')}`);
            const tx = Transaction.from(`0x${deviceBytes.toString('hex')}`);
            const deviceV =
              tx.type === 0
                ? Number(
                    (tx.chainId * BigInt(2) + BigInt(35 + signature.yParity)) %
                      BigInt(256)
                  )
                : signature.yParity;
            return Buffer.concat([
              Buffer.from([deviceV]),
              Buffer.from(signature.r.slice(2), 'hex'),
              Buffer.from(signature.s.slice(2), 'hex'),
            ]);
          }
        ),
      };
      manager.getLedgerConnection = jest.fn().mockResolvedValue(transport);
      jest
        .spyOn(ledgerService, 'resolveTransaction')
        .mockImplementation(async (raw: string) => {
          expectedUnsigned = raw;
          return {
            domains: [],
            plugin: [],
            externalPlugin: [],
            nfts: [],
            erc20Tokens: [],
          };
        });
      const ledger = new LedgerKeyring(manager);
      const trezor: any = Object.create(TrezorKeyring.prototype);
      trezor.initialized = true;
      trezor.hardwareWalletManager = manager;
      trezor.paths = {};
      (TrezorConnect.ethereumSignTransaction as jest.Mock).mockImplementation(
        async ({ transaction }: any) => {
          const tx = Transaction.from({
            ...transaction,
            nonce: Number(transaction.nonce),
            type: transaction.gasPrice === undefined ? 2 : 0,
            gasPrice: transaction.gasPrice?.toString(),
          });
          const signature = await device(tx.unsignedSerialized);
          return {
            success: true,
            payload: {
              r: signature.r,
              s: signature.s,
              v: signature.v.toString(16),
            },
          };
        }
      );
      getPrivateKey = jest.fn(() => {
        throw new Error(
          'Hardware account must not access a software private key'
        );
      });
      sdk = new EthereumTransactions(
        () => state.activeNetwork,
        getPrivateKey,
        () => state,
        ledger,
        trezor
      );
      // Retain the real lazy provider getter and its network identity check.
      // Substitute only provider construction/remote I/O with fixed local sinks.
      jest.spyOn(sdk, 'setWeb3Provider').mockImplementation((network: any) => {
        (sdk as any)._web3Provider =
          network.url === 'https://rpc-a.invalid' ? provider : otherProvider;
        (sdk as any)._web3ProviderKey = `${network.chainId}|${network.url}`;
      });
    });

    afterEach(() => {
      expect(getPrivateKey).not.toHaveBeenCalled();
      for (const spy of networkSpies) expect(spy).not.toHaveBeenCalled();
      jest.restoreAllMocks();
      jest.useRealTimers();
    });

    it.each([false, true])(
      'signs exact approved fields (legacy: %s) once',
      async (legacy) => {
        const sending = send(legacy);
        await finishDelay();
        const response = await sending;
        expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
        expect(otherProvider.sendTransaction).not.toHaveBeenCalled();
        const tx = Transaction.from(provider.sendTransaction.mock.calls[0][0]);
        expect(tx).toMatchObject({
          from: wallet.address,
          to: recipient,
          nonce: 7,
          chainId: BigInt(57057),
          value: BigInt(12345),
          gasLimit: BigInt(21000),
          data: '0x',
          type: legacy ? 0 : 2,
        });
        expect(response.hash).toBe(tx.hash);
        expect(device).toHaveBeenCalledTimes(1);
        if (kind === 'Trezor')
          expect(
            (TrezorConnect.ethereumSignTransaction as jest.Mock).mock
              .calls[0][0].path
          ).toBe("m/44'/60'/0'/0/0");
      }
    );

    it.each(['rejection', 'disconnect'])(
      'never broadcasts after device %s',
      async (failure) => {
        const error = Object.assign(
          new Error(
            failure === 'rejection' ? 'User rejected' : 'Device disconnected'
          ),
          failure === 'rejection'
            ? { statusCode: 0x6985 }
            : { name: 'TransportError' }
        );
        const connectRejection = kind === 'Trezor' && failure === 'rejection';
        if (connectRejection)
          TrezorConnect.ethereumSignTransaction.mockResolvedValueOnce({
            success: false,
            payload: {
              error: 'denied by the user',
              code: 'Failure_ActionCancelled',
            },
          });
        else device.mockRejectedValueOnce(error);
        const sending = send();
        const assertion = expect(sending).rejects.toMatchObject({
          transactionNotBroadcast: true,
        });
        await finishDelay();
        await assertion;
        expect(device).toHaveBeenCalledTimes(connectRejection ? 0 : 1);
        if (connectRejection) {
          expect(TrezorConnect.ethereumSignTransaction).toHaveBeenCalledTimes(
            1
          );
          expect(TrezorConnect.dispose).toHaveBeenCalledTimes(1);
          expect((sdk.trezorSigner as any).initialized).toBe(false);
        }
        expect(manager.delay).not.toHaveBeenCalled();
        expect(provider.sendTransaction).not.toHaveBeenCalled();
        expect(otherProvider.sendTransaction).not.toHaveBeenCalled();
      }
    );

    it.each(['account', 'network'])(
      'does not broadcast a stale signature after pending %s switch',
      async (change) => {
        const entered = deferred<void>();
        const resume = deferred<void>();
        const original = device.getMockImplementation()!;
        device.mockImplementationOnce(async (unsigned: string) => {
          entered.resolve();
          await resume.promise;
          return original(unsigned);
        });
        const sending = send();
        const assertion = expect(sending).rejects.toMatchObject({
          transactionNotBroadcast: true,
        });
        await finishDelay();
        await entered.promise;
        if (change === 'account') state.activeAccountId = 1;
        else
          state.activeNetwork = {
            ...state.activeNetwork,
            url: 'https://rpc-b.invalid',
          };
        resume.resolve();
        await assertion;
        expect(provider.sendTransaction).not.toHaveBeenCalled();
        expect(otherProvider.sendTransaction).not.toHaveBeenCalled();
      }
    );

    describe.each([
      [
        'ERC20 zero decimals',
        'sendSignedErc20Transaction',
        'transfer(address,uint256)',
        '2',
        0,
      ],
      [
        'ERC20 eight decimals',
        'sendSignedErc20Transaction',
        'transfer(address,uint256)',
        '200000001',
        8,
      ],
      [
        'ERC721 large id',
        'sendSignedErc721Transaction',
        'transferFrom(address,address,uint256)',
        '9007199254740993',
        0,
      ],
      [
        'ERC1155 large amount',
        'sendSignedErc1155Transaction',
        'safeTransferFrom(address,address,uint256,uint256,bytes)',
        '9007199254740993',
        0,
      ],
    ] as const)(
      '%s device bytes',
      (_name, method, fragment, atomic, decimals) => {
        it.each([false, true])(
          'signs exact standard calldata through the actual adapter (legacy %s)',
          async (legacy) => {
            const tokenAddress = `0x${'44'.repeat(20)}`;
            const sending = sdk[method]({
              tokenAddress,
              receiver: recipient,
              tokenAmount:
                method === 'sendSignedErc1155Transaction'
                  ? atomic
                  : decimals === 8
                  ? '2.00000001'
                  : '2',
              tokenId: '9007199254740993',
              decimals,
              gasLimit: '200000',
              isLegacy: legacy,
              ...(legacy
                ? { gasPrice: '100' }
                : { maxFeePerGas: '100', maxPriorityFeePerGas: '2' }),
            });
            await finishDelay();
            const response = await sending;
            expect(device).toHaveBeenCalledTimes(1);
            expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
            expect(otherProvider.sendTransaction).not.toHaveBeenCalled();
            const tx = Transaction.from(
              provider.sendTransaction.mock.calls[0][0]
            );
            expect(tx).toMatchObject({
              from: wallet.address,
              to: tokenAddress,
              value: BigInt(0),
              nonce: 7,
              chainId: BigInt(57057),
              gasLimit: BigInt(200000),
              type: legacy ? 0 : 2,
            });
            const parsed = new Interface([
              `function ${fragment}`,
            ]).parseTransaction({ data: tx.data })!;
            const expected =
              method === 'sendSignedErc20Transaction'
                ? [recipient, BigInt(atomic)]
                : method === 'sendSignedErc721Transaction'
                ? [wallet.address, recipient, BigInt(atomic)]
                : [
                    wallet.address,
                    recipient,
                    BigInt('9007199254740993'),
                    BigInt(atomic),
                    '0x',
                  ];
            expect(Array.from(parsed.args)).toEqual(expected);
            expect(response.hash).toBe(tx.hash);
          }
        );
      }
    );

    it('preserves a multi-chunk calldata payload through the actual adapter', async () => {
      const data = `0x${'12'.repeat(600)}`;
      const sending = sdk.sendFormattedTransaction(
        { ...params(), data, gasLimit: '200000' },
        false
      );
      await finishDelay();
      await sending;
      expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
      expect(
        Transaction.from(provider.sendTransaction.mock.calls[0][0]).data
      ).toBe(data);
      expect(device).toHaveBeenCalledTimes(1);
      if (kind === 'Ledger')
        expect(transport.send.mock.calls.length).toBeGreaterThan(1);
    });
  }
);
