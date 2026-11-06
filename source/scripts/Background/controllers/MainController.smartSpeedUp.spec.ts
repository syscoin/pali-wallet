import { BigNumber } from '@sidhujag/sysweb3-keyring/cjs/ethers-v6';
import { HardwareWalletManager } from '@sidhujag/sysweb3-keyring/cjs/hardware-wallet-manager';
import {
  privateKeyToAccount,
  sendLocalEvmTransaction,
} from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-local-signer';
import { Interface } from 'ethers/abi';
import { Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';
import { webcrypto } from 'node:crypto';

import { createTestKeyringManager } from '../../../../tests/fixtures/extensionKeyring';
import { createTestEvmSubmissionCapture } from '../../../../tests/helpers/evmSubmission';
import { EvmSignedRecords } from '../../../wallet/evmSignedRecords';
import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import vaultReducer from 'state/vault';
import { INetworkType, KeyringAccountType } from 'types/network';
import { getWalletNavigationScope } from 'utils/navigationState';
import {
  handleUpdateTransaction,
  previewSpeedUpTransaction,
  UpdateTxAction,
} from 'utils/transactions';

import MainController from './MainController';

jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { notifyTransaction: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.requireActual(
    '@sidhujag/sysweb3-keyring/cjs/keyring-manager'
  ).KeyringManager,
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
let mockState: any;
const mockPersist = jest.fn();
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockState,
    dispatch: (action: any) => {
      mockState = {
        ...mockState,
        vault: vaultReducer(mockState.vault, action),
      };
    },
  },
  persistCommittedWalletState: (...args: any[]) => mockPersist(...args),
}));
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
jest.mock('@sidhujag/sysweb3-keyring/cjs/ledger', () => ({
  LedgerKeyring: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring/cjs/trezor', () => ({
  TrezorKeyring: jest.fn(),
}));

const aes = jest.requireMock('crypto-js').AES;
// Public deterministic fixtures; signing and broadcast remain mocked below.
const testWallet = new Wallet(`0x${'01'.repeat(32)}`);
const otherTestWallet = new Wallet(`0x${'02'.repeat(32)}`);
const PAYER = testWallet.address.toLowerCase();
const SMART = `0x${'22'.repeat(20)}`;
const TARGET = `0x${'33'.repeat(20)}`;
const REPLACEMENT = `0x${'55'.repeat(32)}`;
const CHAIN = 5700;
const APPROVED_MAXIMUM_FEE = '100000000000';
const owner = { type: KeyringAccountType.SmartAccount, id: 7 };
const signedOriginal = (
  legacy = false,
  type = legacy ? 0 : 2,
  gasLimit = 21000
) => {
  const unsigned = Transaction.from({
    type,
    chainId: CHAIN,
    nonce: 8,
    to: TARGET,
    value: BigInt(7),
    data: '0x1234',
    gasLimit: BigInt(gasLimit),
    ...(type !== 2
      ? { gasPrice: BigInt(100), ...(type === 1 ? { accessList: [] } : {}) }
      : {
          maxFeePerGas: BigInt(100),
          maxPriorityFeePerGas: BigInt(10),
          accessList: [],
        }),
  });
  unsigned.signature = testWallet.signingKey.sign(unsigned.unsignedHash);
  return signedResponse(unsigned.serialized);
};
const signedResponse = (raw: string) => {
  const signed = Transaction.from(raw);
  return {
    hash: signed.hash!,
    from: signed.from!.toLowerCase(),
    to: signed.to!,
    nonce: signed.nonce,
    chainId: Number(signed.chainId),
    type: signed.type,
    accessList: signed.accessList,
    signature: signed.signature!,
    r: signed.signature!.r,
    s: signed.signature!.s,
    v: signed.signature!.networkV?.toString() ?? signed.signature!.v,
    blockNumber: null,
    value: BigNumber.from(signed.value),
    data: signed.data,
    gasLimit: BigNumber.from(signed.gasLimit),
    gasPrice: BigNumber.from(signed.gasPrice ?? BigInt(100)),
    maxFeePerGas:
      signed.maxFeePerGas === null
        ? undefined
        : BigNumber.from(signed.maxFeePerGas),
    maxPriorityFeePerGas:
      signed.maxPriorityFeePerGas === null
        ? undefined
        : BigNumber.from(signed.maxPriorityFeePerGas),
  };
};
let original = signedOriginal();
let ORIGINAL = original.hash;
const rawOriginal = (fields: any = {}) => ({ ...original, ...fields });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => (resolve = finish));
  return { promise, resolve };
};

describe('SmartAccount speedup utility to actual keyring handoff', () => {
  let wallet: any;
  let keyring: any;
  let hardware: HardwareWalletManager;
  let provider: any;
  let currentProvider: any;
  let replaceGetter: jest.SpyInstance;
  let alert: { error: jest.Mock; success: jest.Mock; warning: jest.Mock };
  let response: any;
  let useActualLifecycle: boolean;
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const transactions = () =>
    mockState.vault.accountTransactions.SmartAccount[7].ethereum[CHAIN];
  const setSignedOriginal = (
    legacy = false,
    type?: number,
    gasLimit?: number
  ) => {
    original = signedOriginal(legacy, type, gasLimit);
    ORIGINAL = original.hash;
    Object.assign(transactions()[0], rawOriginal());
    provider.getTransaction.mockResolvedValue(rawOriginal());
    response = { ...rawOriginal(), hash: REPLACEMENT };
    provider.sendTransaction.mockResolvedValue(response);
  };
  const run = (
    legacy = false,
    signer = PAYER,
    approvedMaximumFee: string | null = APPROVED_MAXIMUM_FEE,
    walletScope = getWalletNavigationScope()
  ) =>
    handleUpdateTransaction({
      t: (key, options) => (options ? `${key}: ${options.hash}` : key),
      updateData: {
        alert,
        chainId: CHAIN,
        isLegacy: legacy,
        txHash: ORIGINAL,
        updateType: UpdateTxAction.SpeedUp,
        signerAddress: signer,
        approvedMaximumFee: approvedMaximumFee ?? undefined,
        walletScope,
      },
    });

  beforeEach(() => {
    jest.clearAllMocks();
    useActualLifecycle = false;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    original = signedOriginal();
    ORIGINAL = original.hash;
    response = { ...rawOriginal(), hash: REPLACEMENT };
    const initial: any = vaultReducer(undefined, { type: 'test/init' });
    mockState = {
      vault: {
        ...initial,
        isBitcoinBased: false,
        activeAccount: owner,
        activeNetwork: {
          chainId: CHAIN,
          kind: INetworkType.Ethereum,
          slip44: 60,
          currency: 'tsys',
          url: 'rpc-a',
        },
        accounts: {
          ...initial.accounts,
          HDAccount: {
            3: { id: 3, address: PAYER, xprv: 'synthetic-payer-ciphertext' },
          },
          SmartAccount: {
            7: { id: 7, address: SMART, smartAccount: { chainId: CHAIN } },
          },
        },
        accountTransactions: {
          ...initial.accountTransactions,
          SmartAccount: {
            7: {
              syscoin: {},
              ethereum: {
                [CHAIN]: [
                  {
                    ...rawOriginal(),
                    value: '7',
                    input: '0x1234',
                    smartAccountExecutionFrom: SMART,
                  },
                ],
              },
            },
          },
        },
      },
      vaultGlobal: { activeSlip44: 60 },
    };
    provider = {
      getTransaction: jest.fn().mockResolvedValue(rawOriginal()),
      getBalance: jest.fn().mockResolvedValue(BigNumber.from('1000000000')),
      getBlock: jest
        .fn()
        .mockResolvedValue({ gasLimit: BigNumber.from(30_000_000) }),
      verifyConfiguredChainId: jest.fn().mockResolvedValue(undefined),
      sendTransaction: jest.fn().mockResolvedValue(response),
    };
    currentProvider = provider;
    hardware = new HardwareWalletManager();
    const testCapture = createTestEvmSubmissionCapture();
    keyring = createTestKeyringManager(undefined, {
      hardwareManager: hardware,
      captureEvmSubmission: (context) =>
        useActualLifecycle
          ? wallet.captureEvmSignedSubmission(keyring, context)
          : testCapture(),
    });
    keyring.setVaultStateGetter(() => mockState.vault);
    replaceGetter = jest.spyOn(keyring, 'setVaultStateGetter');
    keyring.sessionPassword = { isCleared: () => false };
    keyring.withSecureData = (read: (password: string) => unknown) =>
      read('synthetic-session-password');
    aes.decrypt.mockReturnValue({ toString: () => 'mocked-private-key' });
    jest.mocked(privateKeyToAccount).mockReturnValue({ address: PAYER } as any);
    Object.defineProperty(keyring.ethereumTransaction, 'web3Provider', {
      configurable: true,
      get: () => currentProvider,
    });
    wallet = Object.create(MainController.prototype);
    wallet.walletSessionGeneration = 5;
    wallet.isResettingWallet = false;
    wallet.getActiveKeyring = jest.fn(() => keyring);
    wallet.startRapidTransactionPolling = jest.fn();
    mockPersist.mockImplementation(async (_include, _skip, current) => {
      if (!current()) throw new Error('PALI_TRANSACTION_CONTEXT_CHANGED');
    });
    jest
      .mocked(controllerEmitter)
      .mockImplementation(async (route: string[], args: any[]) => {
        let target: any = { wallet };
        for (const name of route.slice(0, -1)) target = target[name];
        return target[route[route.length - 1]](...args);
      });
    jest
      .mocked(sendLocalEvmTransaction)
      .mockImplementation(
        async (capturedProvider, _key, _tx, beforeBroadcast, beforeSign) => {
          await Promise.resolve();
          beforeSign?.();
          beforeBroadcast?.();
          return capturedProvider.sendTransaction('mocked-signed-transaction');
        }
      );
    alert = { error: jest.fn(), warning: jest.fn(), success: jest.fn() };
  });
  afterEach(async () => {
    try {
      await hardware?.destroy();
    } finally {
      jest.restoreAllMocks();
      if (originalCrypto)
        Object.defineProperty(globalThis, 'crypto', originalCrypto);
    }
  });

  const encryptedJournalFixture = async (beforeCompareAndSet?: () => void) => {
    const profileId = `0x${'ab'.repeat(32)}`;
    const secret = await webcrypto.subtle.importKey(
      'raw',
      new Uint8Array(32).fill(71),
      'AES-GCM',
      false,
      ['encrypt', 'decrypt']
    );
    const additionalData = (domain: string, id: string) =>
      Buffer.from(JSON.stringify([domain, id]));
    Object.assign(keyring, {
      getPrivateRecordProfileId: async () => profileId,
      async encryptPrivateRecord({ domain, recordId, plaintext }) {
        const iv = webcrypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await webcrypto.subtle.encrypt(
          {
            name: 'AES-GCM',
            iv,
            additionalData: additionalData(domain, recordId),
          },
          secret,
          plaintext
        );
        return {
          version: 1,
          profileId,
          domain,
          recordId,
          nonce: Buffer.from(iv).toString('base64'),
          ciphertext: Buffer.from(ciphertext).toString('base64'),
        };
      },
      async decryptPrivateRecord({ domain, recordId, envelope }) {
        return new Uint8Array(
          await webcrypto.subtle.decrypt(
            {
              name: 'AES-GCM',
              iv: Buffer.from(envelope.nonce, 'base64'),
              additionalData: additionalData(domain, recordId),
            },
            secret,
            Buffer.from(envelope.ciphertext, 'base64')
          )
        );
      },
    });
    let encryptedJournal: string | undefined;
    const reopen = () =>
      new EvmSignedRecords({
        async read(id) {
          expect(id).toBe(profileId);
          return encryptedJournal;
        },
        async compareAndSet(id, expected, next, guard) {
          expect(id).toBe(profileId);
          beforeCompareAndSet?.();
          guard();
          if (encryptedJournal !== expected) return false;
          encryptedJournal = next;
          return true;
        },
      });
    return reopen;
  };

  const setupDurableReplacement = async (
    firstPost?: (signed: Transaction) => Promise<void>
  ) => {
    setSignedOriginal(true, 0, 25_000);
    useActualLifecycle = true;
    const payer = { id: 3, type: KeyringAccountType.HDAccount };
    mockState.vault.activeAccount = payer;
    mockState.vault.accountTransactions = {
      ...mockState.vault.accountTransactions,
      HDAccount: {
        3: {
          syscoin: {},
          ethereum: {
            [CHAIN]: [{ ...rawOriginal(), value: '7', input: '0x1234' }],
          },
        },
      },
    };
    const journal = (await encryptedJournalFixture())();
    wallet.getRetainedEvmRecords = () => journal;
    const journalSession = { keyring, assertCurrent: () => undefined };
    const actualSigner = jest.requireActual(
      '@sidhujag/sysweb3-keyring/cjs/transactions/evm-local-signer'
    );
    jest
      .mocked(sendLocalEvmTransaction)
      .mockImplementation((rpc, _key, ...args) =>
        actualSigner.sendLocalEvmTransaction(
          rpc,
          testWallet.privateKey,
          ...args
        )
      );
    const ActualProvider = jest.requireActual(
      '@sidhujag/sysweb3-keyring/cjs/providers'
    ).CustomJsonRpcProvider;
    const rpc = new ActualProvider(
      new AbortController().signal,
      'https://offline.example',
      CHAIN
    );
    const posts: Transaction[] = [];
    jest.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      expect(url).toBe('https://offline.example');
      const { jsonrpc, method, id, params } = JSON.parse(init!.body as string);
      let result: unknown;
      if (method === 'eth_chainId') result = `0x${CHAIN.toString(16)}`;
      else if (method === 'eth_getTransactionCount') result = '0x8';
      else if (method === 'eth_getCode') result = '0x';
      else if (method === 'eth_sendRawTransaction') {
        const signed = Transaction.from(params[0]);
        posts.push(signed);
        if (posts.length === 1 && firstPost) await firstPost(signed);
        result = signed.hash;
      } else throw new Error(`unexpected ${method}`);
      return new Response(JSON.stringify({ jsonrpc, id, result }), {
        status: 200,
      });
    });
    let baseFee = 150;
    provider.getGasPrice = jest.fn(async () => BigNumber.from(baseFee));
    provider.getBlock = jest.fn(async () => ({
      gasLimit: BigNumber.from(30_000_000),
      baseFeePerGas: BigNumber.from(baseFee),
    }));
    provider.getNetwork = jest.fn(async () => ({ chainId: BigInt(CHAIN) }));
    provider._send = rpc._send.bind(rpc);
    provider.send = rpc.send.bind(rpc);
    provider.sendTransaction = jest.fn(async (raw: string) => {
      const hash = await rpc.send('eth_sendRawTransaction', [raw]);
      return { ...signedResponse(raw), hash, raw };
    });
    return {
      journal,
      journalSession,
      posts,
      setBaseFee(value: number) {
        baseFee = value;
      },
      dispose: () => rpc.destroy(),
    };
  };

  it.each([false, true])(
    'blocks the spending replacement after durable Cancel with a held ACK (already persisted: %s)',
    async (alreadyPersisted) => {
      const cancelPosted = deferred<Transaction>(),
        acknowledge = deferred<void>();
      const { journal, journalSession, posts, setBaseFee, dispose } =
        await setupDurableReplacement(async (signed) => {
          cancelPosted.resolve(signed);
          await acknowledge.promise;
        });
      const walletScope = getWalletNavigationScope();
      const preview = await wallet.speedUpEvmTransaction(
        ORIGINAL,
        true,
        CHAIN,
        PAYER,
        { previewOnly: true, walletScope }
      );
      const speedUp = () =>
        wallet.speedUpEvmTransaction(ORIGINAL, true, CHAIN, PAYER, {
          walletScope,
          approvedMaximumFee: preview.maximumFee,
        });
      const spendPersisted = deferred<void>(),
        resumeSpend = deferred<void>();
      const append = journal.append.bind(journal);
      jest.spyOn(journal, 'append').mockImplementation(async (...args) => {
        const entry = await append(...args);
        if (alreadyPersisted && entry.operation === 'speed-up') {
          spendPersisted.resolve();
          await resumeSpend.promise;
        }
        return entry;
      });
      const inFlightSpend = alreadyPersisted ? speedUp() : undefined;
      if (inFlightSpend) {
        await Promise.race([
          spendPersisted.promise,
          inFlightSpend.then(() => {
            throw new Error('expected a saved replacement before Cancel');
          }),
        ]);
      }
      setBaseFee(100);
      const cancel = wallet.cancelEvmTransaction(
        ORIGINAL,
        true,
        8,
        PAYER,
        { chainId: CHAIN, walletScope },
        { approvedMaximumFee: APPROVED_MAXIMUM_FEE }
      );
      try {
        const cancellation = await Promise.race([
          cancelPosted.promise,
          cancel.then((result) => {
            throw new Error(`cancel had no POST: ${JSON.stringify(result)}`);
          }),
        ]);
        expect(cancellation.to?.toLowerCase()).toBe(PAYER);
        expect(cancellation.value).toBe(BigInt(0));
        const before = await journal.listSender(
          journalSession,
          String(CHAIN),
          PAYER
        );
        expect(before.map(({ operation }) => operation)).toEqual(
          alreadyPersisted ? ['speed-up', 'cancel'] : ['cancel']
        );
        setBaseFee(150);
        resumeSpend.resolve();
        const blocked = await (inFlightSpend ?? speedUp());
        expect(blocked).toMatchObject({
          isSpeedUp: false,
          transactionNotBroadcast: true,
        });
        expect(posts).toHaveLength(1);
        const entries = await journal.listSender(
          journalSession,
          String(CHAIN),
          PAYER
        );
        expect(entries).toEqual(before);
        if (alreadyPersisted) {
          const spend = entries[0]!;
          expect(
            await journal.withReplayAdmission(
              journalSession,
              spend,
              () => 'eligible'
            )
          ).toBeNull();
          expect(
            (
              await journal.readExact(
                journalSession,
                String(CHAIN),
                PAYER,
                spend.hash
              )
            )?.rawTransaction
          ).toBeDefined();
        }
      } finally {
        resumeSpend.resolve();
        acknowledge.resolve();
        await cancel;
        dispose();
      }
    }
  );

  it('reprices a pending durable cancellation without changing its execution gas', async () => {
    const { journal, journalSession, posts, setBaseFee, dispose } =
      await setupDurableReplacement();
    try {
      const walletScope = getWalletNavigationScope();
      setBaseFee(100);
      const cancelled = await wallet.cancelEvmTransaction(
        ORIGINAL,
        true,
        8,
        PAYER,
        { chainId: CHAIN, walletScope },
        { approvedMaximumFee: APPROVED_MAXIMUM_FEE }
      );
      expect(cancelled).toMatchObject({ isCanceled: true });
      expect(posts).toHaveLength(1);
      const cancellation = posts[0]!;
      expect(cancellation.gasLimit).toBe(BigInt(42_000));
      await wallet.setEvmTransactionCancelSubmitted(
        ORIGINAL,
        CHAIN,
        cancelled.transaction
      );
      provider.getTransaction.mockImplementation(async (hash: string) =>
        hash === cancellation.hash
          ? signedResponse(cancellation.serialized)
          : rawOriginal()
      );
      const preview = await wallet.speedUpEvmTransaction(
        cancellation.hash,
        true,
        CHAIN,
        PAYER,
        { previewOnly: true, walletScope }
      );
      const expedited = await wallet.speedUpEvmTransaction(
        cancellation.hash,
        true,
        CHAIN,
        PAYER,
        { approvedMaximumFee: preview.maximumFee, walletScope }
      );
      expect(expedited).toMatchObject({ isSpeedUp: true });
      expect(posts).toHaveLength(2);
      const replacement = posts[1]!;
      expect(replacement.hash).not.toBe(cancellation.hash);
      expect(replacement).toMatchObject({
        type: cancellation.type,
        chainId: cancellation.chainId,
        nonce: cancellation.nonce,
        to: cancellation.to,
        from: cancellation.from,
        value: cancellation.value,
        data: cancellation.data,
        gasLimit: cancellation.gasLimit,
      });
      expect(replacement.gasPrice).toBe(BigInt(144));
      expect(preview.maximumFee).toBe('6048000');
      const entries = await journal.listSender(
        journalSession,
        String(CHAIN),
        PAYER
      );
      expect(
        entries.map(({ operation, originalHash }) => [operation, originalHash])
      ).toEqual([
        ['cancel', ORIGINAL],
        ['speed-up', cancellation.hash],
      ]);
      expect(
        await journal.withReplayAdmission(
          journalSession,
          entries[1]!,
          () => 'eligible'
        )
      ).toEqual({ result: 'eligible' });
      const lookups = provider.getTransaction.mock.calls.length;
      await expect(
        wallet.speedUpEvmTransaction(cancellation.hash!, true, CHAIN, PAYER, {
          previewOnly: true,
          walletScope,
        })
      ).rejects.toMatchObject({
        message: 'EVM_SIGNED_RECORD_ORIGINAL_CHANGED',
        transactionNotBroadcast: true,
      });
      expect(provider.getTransaction).toHaveBeenCalledTimes(lookups);
    } finally {
      dispose();
    }
  });

  it.each([false, true])(
    'uses the actual recorded payer credential and preserves payload/metadata (legacy=%s)',
    async (legacy) => {
      if (legacy) setSignedOriginal(true);
      await run(legacy);
      expect(alert.success).toHaveBeenCalledWith(
        'transactions.transactionAcceleratedSuccessfully'
      );
      expect(alert.error).not.toHaveBeenCalled();
      expect(aes.decrypt).toHaveBeenCalledWith(
        'synthetic-payer-ciphertext',
        'synthetic-session-password'
      );
      expect(replaceGetter).not.toHaveBeenCalled();
      expect(mockState.vault.activeAccount).toEqual(owner);
      const replacement = jest.mocked(sendLocalEvmTransaction).mock.calls[0][2];
      expect(replacement.from.toLowerCase()).toBe(PAYER);
      expect(replacement).toMatchObject({
        to: TARGET,
        nonce: 8,
        data: '0x1234',
        chainId: CHAIN,
      });
      expect(replacement.value.toString()).toBe('7');
      expect(
        (legacy ? replacement.gasPrice : replacement.maxFeePerGas).toString()
      ).toBe('120');
      expect(
        transactions().find((tx: any) => tx.hash === REPLACEMENT)
      ).toMatchObject({
        isSpeedUp: true,
        smartAccountExecutionFrom: SMART,
        replacesHash: ORIGINAL,
        replacementRootHash: ORIGINAL,
      });
      expect(mockPersist).toHaveBeenCalledTimes(1);
      expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
      expect(
        jest.mocked(controllerEmitter).mock.calls.map(([route]) => route)
      ).toEqual([
        ['wallet', 'speedUpEvmTransaction'],
        ['wallet', 'setEvmTransactionAsAccelerated'],
      ]);
    }
  );

  function selectOrdinaryPayer() {
    mockState.vault.activeAccount = {
      type: KeyringAccountType.HDAccount,
      id: 3,
    };
    mockState.vault.accountTransactions.HDAccount = {
      ...mockState.vault.accountTransactions.HDAccount,
      3: {
        syscoin: {},
        ethereum: {
          [CHAIN]: [{ ...rawOriginal(), value: '7', input: '0x1234' }],
        },
      },
    };
  }

  it.each([
    'acknowledged',
    'lost',
    'stale-nonce',
    'mined',
    'session',
    'low-preview',
    'low-confirm',
    'low-at-wire',
    'expired-at-write',
  ] as const)(
    'cancels an authenticated saved NFT with no history after restart (%s)',
    async (outcome) => {
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: webcrypto,
      });
      selectOrdinaryPayer();
      useActualLifecycle = true;
      mockState.vault.accountTransactions = {};
      const payer = { ...mockState.vault.activeAccount, address: PAYER };
      const retained = Transaction.from({
        type: 0,
        chainId: CHAIN,
        nonce: 0,
        to: TARGET,
        value: BigInt(0),
        gasLimit: BigInt(90_000),
        gasPrice: BigInt(200),
        data: new Interface([
          'function transferFrom(address,address,uint256)',
        ]).encodeFunctionData('transferFrom', [PAYER, SMART, 0]),
      });
      retained.signature = testWallet.signingKey.sign(retained.unsignedHash);
      const hash = retained.hash!;
      let expireAtWrite = false;
      const reopen = await encryptedJournalFixture(() => {
        if (expireAtWrite)
          jest.spyOn(performance, 'now').mockImplementation(() => 1e9);
      });
      const recordSession = { keyring, assertCurrent: () => undefined };
      await reopen().append(recordSession, {
        context: {
          account: payer,
          network: mockState.vault.activeNetwork,
          operation: 'erc721',
        },
        chainId: String(CHAIN),
        from: PAYER,
        hash,
        nonce: 0,
        type: 0,
        rawTransaction: retained.serialized,
      });
      const journal = reopen();
      wallet.getRetainedEvmRecords = () => journal;

      provider.getTransaction.mockResolvedValue(null);
      provider.getGasPrice = jest.fn(async () => BigNumber.from(100));
      provider.getNetwork = jest.fn(async () => ({ chainId: BigInt(CHAIN) }));
      provider._send = jest.fn(async ({ id, method }) => {
        expect(method).toBe('eth_chainId');
        return [{ jsonrpc: '2.0', id, result: `0x${CHAIN.toString(16)}` }];
      });
      let movedNonce = false;
      let mined = false;
      let balance = outcome === 'low-preview' ? '0x0' : '0xffffff';
      const blockHash = `0x${'aa'.repeat(32)}`;
      provider.send = jest.fn(async (method: string, params: unknown[]) => {
        if (method === 'eth_getBalance') {
          expect(params).toEqual([PAYER, 'latest']);
          return balance;
        }
        if (method === 'eth_getTransactionReceipt')
          return mined
            ? {
                transactionHash: hash,
                from: PAYER,
                to: TARGET,
                blockHash,
                blockNumber: '0x10',
                status: '0x1',
              }
            : null;
        if (method === 'eth_getBlockByNumber')
          return { hash: blockHash, number: '0x10' };
        if (method === 'eth_getTransactionCount')
          return movedNonce ? '0x1' : '0x0';
        if (method === 'eth_getCode') return '0x';
        throw new Error(`unexpected ${method}`);
      });
      const actualSigner = jest.requireActual(
        '@sidhujag/sysweb3-keyring/cjs/transactions/evm-local-signer'
      );
      jest
        .mocked(sendLocalEvmTransaction)
        .mockImplementation((rpc, _key, ...args) =>
          actualSigner.sendLocalEvmTransaction(
            rpc,
            testWallet.privateKey,
            ...args
          )
        );
      let cancellationHash: string | undefined;
      const posted = deferred<void>();
      const acknowledge = deferred<void>();
      provider.sendTransaction.mockImplementation(async (raw: string) => {
        const signed = Transaction.from(raw);
        cancellationHash = signed.hash!;
        expect(signed.nonce).toBe(0);
        expect(signed.to?.toLowerCase()).toBe(PAYER);
        expect(signed.data).toBe('0x');
        expect(signed.value).toBe(BigInt(0));
        expect(signed.gasLimit).toBe(BigInt(42000));
        expect(signed.gasPrice).toBeGreaterThan(BigInt(200));
        expect(
          (
            await journal.readExact(
              recordSession,
              String(CHAIN),
              PAYER,
              cancellationHash
            )
          )?.rawTransaction
        ).toBe(raw);
        const payment = await journal.readExact(
          recordSession,
          String(CHAIN),
          PAYER,
          hash
        );
        expect(payment?.rawTransaction).toBe(retained.serialized);
        expect(
          await journal.withReplayAdmission(recordSession, payment!, () => true)
        ).toBeNull();
        posted.resolve();
        await acknowledge.promise;
        if (outcome === 'lost')
          throw new Error('Lost local relay acknowledgement');
        return { hash: cancellationHash };
      });

      if (outcome === 'low-preview') {
        await expect(
          wallet.prepareRetainedEvmCancellation(hash)
        ).rejects.toThrow('Insufficient funds for reviewed EVM transfer');
        expect(sendLocalEvmTransaction).not.toHaveBeenCalled();
        expect(provider.sendTransaction).not.toHaveBeenCalled();
        return;
      }
      const review = await wallet.prepareRetainedEvmCancellation(hash);
      expect(review).toMatchObject({
        hash,
        from: PAYER,
        chainId: CHAIN,
        nonce: 0,
      });
      expect(review).not.toHaveProperty('rawTransaction');
      expect(BigInt(review.maximumFee)).toBeGreaterThan(BigInt(42000 * 200));
      expect(sendLocalEvmTransaction).not.toHaveBeenCalled();
      expect(provider.getTransaction).not.toHaveBeenCalled();
      const append = journal.append.bind(journal);
      const shouldBlock =
        outcome === 'stale-nonce' ||
        outcome === 'mined' ||
        outcome === 'session' ||
        outcome === 'low-at-wire';
      if (shouldBlock)
        jest.spyOn(journal, 'append').mockImplementation(async (...args) => {
          const saved = await append(...args);
          if (saved.operation === 'cancel') {
            movedNonce = outcome === 'stale-nonce';
            mined = outcome === 'mined';
            if (outcome === 'session') wallet.advanceWalletSession();
            if (outcome === 'low-at-wire') balance = '0x0';
          }
          return saved;
        });

      if (outcome === 'low-confirm') balance = '0x0';
      expireAtWrite = outcome === 'expired-at-write';
      const confirmation = wallet.confirmRetainedEvmCancellation(review.id);
      void confirmation.catch(() => undefined);
      await expect(
        wallet.confirmRetainedEvmCancellation(review.id)
      ).rejects.toThrow();
      try {
        if (outcome === 'low-confirm') {
          await expect(confirmation).rejects.toThrow(
            'Insufficient funds for reviewed EVM transfer'
          );
          expect(sendLocalEvmTransaction).not.toHaveBeenCalled();
          expect(provider.sendTransaction).not.toHaveBeenCalled();
          return;
        }
        if (shouldBlock || outcome === 'expired-at-write') {
          await expect(confirmation).resolves.toEqual({
            status: 'not-dispatched',
          });
          expect(provider.sendTransaction).not.toHaveBeenCalled();
          if (outcome === 'expired-at-write') {
            const entries = await journal.listSender(
              recordSession,
              String(CHAIN),
              PAYER
            );
            expect(entries.map((entry) => entry.hash)).toEqual([hash]);
            expect(
              await journal.withReplayAdmission(
                recordSession,
                entries[0]!,
                () => true
              )
            ).toEqual({ result: true });
          }
          return;
        }
        await Promise.race([
          posted.promise,
          confirmation.then(() => {
            throw new Error('Cancellation did not enter POST');
          }),
        ]);
        // Expiry after POST cannot turn a known acknowledgement into a failure.
        jest.spyOn(performance, 'now').mockImplementation(() => 1e9);
        acknowledge.resolve();
        await expect(confirmation).resolves.toEqual({
          status: outcome === 'acknowledged' ? 'submitted' : 'unknown',
          hash: cancellationHash,
        });
        expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
        expect(provider.getTransaction).not.toHaveBeenCalled();
      } finally {
        acknowledge.resolve();
      }
    }
  );

  it('quotes then sends an ordinary pending replacement through the same guarded controller', async () => {
    selectOrdinaryPayer();
    const scope = getWalletNavigationScope();
    const maximumFee = await previewSpeedUpTransaction(
      ORIGINAL,
      false,
      CHAIN,
      PAYER,
      scope
    );
    expect(maximumFee).toBe('3024000');
    expect(aes.decrypt).not.toHaveBeenCalled();
    expect(sendLocalEvmTransaction).not.toHaveBeenCalled();
    await run(false, PAYER, maximumFee, scope);
    expect(sendLocalEvmTransaction).toHaveBeenCalledTimes(1);
    expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
    expect(mockPersist).toHaveBeenCalledTimes(1);
    expect(alert.success).toHaveBeenCalled();
    expect(replaceGetter).not.toHaveBeenCalled();
  });

  it('rejects a stale ordinary account scope before requesting the original transaction', async () => {
    selectOrdinaryPayer();
    const scope = getWalletNavigationScope();
    mockState.vault.activeNetwork.url = 'https://other-rpc.synthetic.invalid';
    await expect(
      wallet.speedUpEvmTransaction(ORIGINAL, false, CHAIN, PAYER, {
        previewOnly: true,
        walletScope: scope,
      })
    ).rejects.toMatchObject({ transactionNotBroadcast: true });
    expect(provider.getTransaction).not.toHaveBeenCalled();
    expect(aes.decrypt).not.toHaveBeenCalled();
    expect(provider.sendTransaction).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'previews the authenticated maximum without keys and carries approval through the real utility (legacy=%s)',
    async (legacy) => {
      if (legacy) setSignedOriginal(true);
      const scope = getWalletNavigationScope();
      const maximumFee = await previewSpeedUpTransaction(
        ORIGINAL,
        legacy,
        CHAIN,
        PAYER
      );
      expect(maximumFee).toBe('3024000');
      expect(aes.decrypt).not.toHaveBeenCalled();
      expect(privateKeyToAccount).not.toHaveBeenCalled();
      expect(sendLocalEvmTransaction).not.toHaveBeenCalled();
      expect(provider.sendTransaction).not.toHaveBeenCalled();
      expect(mockPersist).not.toHaveBeenCalled();
      expect(controllerEmitter).toHaveBeenLastCalledWith(
        ['wallet', 'speedUpEvmTransaction'],
        [
          ORIGINAL,
          legacy,
          CHAIN,
          PAYER,
          { previewOnly: true, walletScope: scope },
        ]
      );

      await run(legacy, PAYER, maximumFee, scope);

      expect(controllerEmitter).toHaveBeenCalledWith(
        ['wallet', 'speedUpEvmTransaction'],
        [
          ORIGINAL,
          legacy,
          CHAIN,
          PAYER,
          { approvedMaximumFee: maximumFee, walletScope: scope },
        ]
      );
      expect(aes.decrypt).toHaveBeenCalledTimes(1);
      expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
      expect(mockPersist).toHaveBeenCalledTimes(1);
      expect(alert.success).toHaveBeenCalled();
    }
  );

  it.each([false, true])(
    'derives final fee mode from signed type despite a poisoned history type (signed legacy=%s)',
    async (legacy) => {
      setSignedOriginal(legacy);
      transactions()[0].type = legacy ? 2 : 0;
      provider.getGasPrice = jest.fn();
      provider.getFeeData = jest.fn();
      const enrichFees = jest.spyOn(
        keyring.ethereumTransaction,
        'getFeeDataWithDynamicMaxPriorityFeePerGas'
      );
      const maximumFee = await previewSpeedUpTransaction(
        ORIGINAL,
        !legacy,
        CHAIN,
        PAYER
      );
      await run(!legacy, PAYER, maximumFee);
      const replacement = jest.mocked(sendLocalEvmTransaction).mock.calls[0][2];
      expect(
        (legacy ? replacement.gasPrice : replacement.maxFeePerGas).toString()
      ).toBe('120');
      expect(replacement.data).toBe('0x1234');
      expect(replacement.nonce).toBe(8);
      expect(replacement.value.toString()).toBe('7');
      expect(provider.getGasPrice).not.toHaveBeenCalled();
      expect(provider.getFeeData).not.toHaveBeenCalled();
      expect(enrichFees).not.toHaveBeenCalled();
      expect(alert.success).toHaveBeenCalled();
    }
  );

  it('uses the authenticated type1 gas price for both dynamic fee fields without RPC enrichment', async () => {
    setSignedOriginal(false, 1);
    provider.getGasPrice = jest.fn();
    provider.getFeeData = jest.fn();
    const enrichFees = jest.spyOn(
      keyring.ethereumTransaction,
      'getFeeDataWithDynamicMaxPriorityFeePerGas'
    );
    const maximumFee = await previewSpeedUpTransaction(
      ORIGINAL,
      false,
      CHAIN,
      PAYER
    );
    await run(false, PAYER, maximumFee);
    const replacement = jest.mocked(sendLocalEvmTransaction).mock.calls[0][2];
    expect(replacement.maxFeePerGas.toString()).toBe('120');
    expect(replacement.maxPriorityFeePerGas.toString()).toBe('120');
    expect(replacement.accessList).toEqual([]);
    expect(provider.getGasPrice).not.toHaveBeenCalled();
    expect(provider.getFeeData).not.toHaveBeenCalled();
    expect(enrichFees).not.toHaveBeenCalled();
    expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it.each([
    [KeyringAccountType.HDAccount, null],
    [KeyringAccountType.HDAccount, '3023999'],
    [KeyringAccountType.Ledger, null],
    [KeyringAccountType.Ledger, '3023999'],
    [KeyringAccountType.Trezor, null],
    [KeyringAccountType.Trezor, '3023999'],
  ])(
    'rejects %s missing or insufficient fee approval %p before credentials/devices',
    async (signerType, cap) => {
      mockState.vault.accounts.HDAccount =
        signerType === KeyringAccountType.HDAccount
          ? { 3: { id: 3, address: PAYER, xprv: 'synthetic-payer-ciphertext' } }
          : {};
      if (signerType !== KeyringAccountType.HDAccount)
        mockState.vault.accounts[signerType] = { 4: { id: 4, address: PAYER } };
      const ledgerSign = jest.fn();
      const trezorSign = jest.fn();
      keyring.ledgerSigner.evm = { signEVMTransaction: ledgerSign };
      keyring.trezorSigner.signEthTransaction = trezorSign;
      await run(false, PAYER, cap);
      expect(alert.error).toHaveBeenCalled();
      expect(aes.decrypt).not.toHaveBeenCalled();
      expect(privateKeyToAccount).not.toHaveBeenCalled();
      expect(sendLocalEvmTransaction).not.toHaveBeenCalled();
      expect(ledgerSign).not.toHaveBeenCalled();
      expect(trezorSign).not.toHaveBeenCalled();
      expect(provider.sendTransaction).not.toHaveBeenCalled();
      expect(mockPersist).not.toHaveBeenCalled();
    }
  );

  it.each([KeyringAccountType.Ledger, KeyringAccountType.Trezor])(
    'previews %s fees without invoking the device or broadcast',
    async (signerType) => {
      mockState.vault.accounts.HDAccount = {};
      mockState.vault.accounts[signerType] = { 4: { id: 4, address: PAYER } };
      const ledgerSign = jest.fn();
      const trezorSign = jest.fn();
      keyring.ledgerSigner.evm = { signEVMTransaction: ledgerSign };
      keyring.trezorSigner.signEthTransaction = trezorSign;
      await expect(
        previewSpeedUpTransaction(ORIGINAL, false, CHAIN, PAYER)
      ).resolves.toBe('3024000');
      expect(aes.decrypt).not.toHaveBeenCalled();
      expect(privateKeyToAccount).not.toHaveBeenCalled();
      expect(sendLocalEvmTransaction).not.toHaveBeenCalled();
      expect(ledgerSign).not.toHaveBeenCalled();
      expect(trezorSign).not.toHaveBeenCalled();
      expect(provider.sendTransaction).not.toHaveBeenCalled();
      expect(mockPersist).not.toHaveBeenCalled();
    }
  );

  it.each(['account', 'RPC', 'chain', 'provider', 'session', 'payer'])(
    'rejects a %s change while fee preview is in flight',
    async (axis) => {
      const pending = deferred<any>();
      const started = deferred<void>();
      provider.getTransaction.mockImplementationOnce(() => {
        started.resolve();
        return pending.promise;
      });
      const previewing = previewSpeedUpTransaction(
        ORIGINAL,
        false,
        CHAIN,
        PAYER
      );
      await started.promise;
      if (axis === 'account')
        mockState.vault.activeAccount = { ...owner, id: 8 };
      if (axis === 'RPC') mockState.vault.activeNetwork.url = 'rpc-b';
      if (axis === 'chain') mockState.vault.activeNetwork.chainId = 1;
      if (axis === 'provider') currentProvider = {};
      if (axis === 'session') wallet.walletSessionGeneration++;
      if (axis === 'payer')
        mockState.vault.accounts.HDAccount[3].address = TARGET;
      pending.resolve(rawOriginal());
      await expect(previewing).rejects.toThrow();
      expect(aes.decrypt).not.toHaveBeenCalled();
      expect(privateKeyToAccount).not.toHaveBeenCalled();
      expect(sendLocalEvmTransaction).not.toHaveBeenCalled();
      expect(provider.sendTransaction).not.toHaveBeenCalled();
      expect(mockPersist).not.toHaveBeenCalled();
    }
  );

  it.each(['account', 'RPC'])(
    'does not reuse fee approval after %s changes between preview and final submission',
    async (axis) => {
      const scope = getWalletNavigationScope();
      const maximumFee = await previewSpeedUpTransaction(
        ORIGINAL,
        false,
        CHAIN,
        PAYER
      );
      provider.getTransaction.mockClear();
      if (axis === 'account')
        mockState.vault.activeAccount = { ...owner, id: 8 };
      else mockState.vault.activeNetwork.url = 'rpc-b';
      await run(false, PAYER, maximumFee, scope);
      expect(alert.error).toHaveBeenCalled();
      expect(provider.getTransaction).not.toHaveBeenCalled();
      expect(aes.decrypt).not.toHaveBeenCalled();
      expect(sendLocalEvmTransaction).not.toHaveBeenCalled();
      expect(provider.sendTransaction).not.toHaveBeenCalled();
      expect(mockPersist).not.toHaveBeenCalled();
    }
  );

  it.each([
    'missing payer',
    'missing owner',
    'wrong owner chain',
    'wrong caller signer',
    'superseded original',
    'replacement status',
  ])('refuses %s before RPC or credential access', async (failure) => {
    if (failure === 'missing payer') mockState.vault.accounts.HDAccount = {};
    if (failure === 'missing owner')
      transactions()[0].smartAccountExecutionFrom = undefined;
    if (failure === 'wrong owner chain')
      mockState.vault.accounts.SmartAccount[7].smartAccount.chainId = 1;
    if (failure === 'superseded original') transactions()[0].isReplaced = true;
    if (failure === 'replacement status') transactions()[0].status = 'replaced';
    await run(false, failure === 'wrong caller signer' ? TARGET : PAYER);
    expect(alert.error).toHaveBeenCalled();
    expect(provider.getTransaction).not.toHaveBeenCalled();
    expect(aes.decrypt).not.toHaveBeenCalled();
    expect(provider.sendTransaction).not.toHaveBeenCalled();
  });

  it.each([
    { hash: REPLACEMENT },
    { from: TARGET },
    { nonce: 9 },
    { chainId: 1 },
    { to: SMART },
    { value: BigNumber.from(8) },
    { data: '0xabcd' },
    { blockNumber: 123 },
  ])('refuses changed RPC original %j before signing', async (fields) => {
    provider.getTransaction.mockResolvedValue(rawOriginal(fields));
    await run();
    expect(alert.error).toHaveBeenCalled();
    expect(aes.decrypt).not.toHaveBeenCalled();
    expect(provider.sendTransaction).not.toHaveBeenCalled();
    expect(mockPersist).not.toHaveBeenCalled();
  });

  it('rejects wrong-hash provider details before receipt queries or SmartAccount owner lookup', async () => {
    const readOwner = jest.fn(() => SMART);
    Object.defineProperty(transactions()[0], 'smartAccountExecutionFrom', {
      configurable: true,
      get: readOwner,
    });
    const wrongTransaction = rawOriginal({ hash: REPLACEMENT });
    provider.getTransaction.mockResolvedValue(wrongTransaction);
    provider.getTransactionReceipt = jest.fn().mockResolvedValue(null);
    provider.getBlockNumber = jest.fn().mockResolvedValue(123);

    await expect(
      wallet.getEvmTransactionFromProvider(ORIGINAL)
    ).resolves.toBeNull();

    expect(provider.getTransaction).toHaveBeenCalledWith(ORIGINAL);
    expect(provider.getTransactionReceipt).not.toHaveBeenCalled();
    expect(provider.getBlockNumber).not.toHaveBeenCalled();
    expect(readOwner).not.toHaveBeenCalled();
    expect(wrongTransaction).not.toHaveProperty('smartAccountExecutionFrom');
    expect(provider.sendTransaction).not.toHaveBeenCalled();
    expect(mockPersist).not.toHaveBeenCalled();
  });

  it.each([
    [KeyringAccountType.HDAccount, 'payload'],
    [KeyringAccountType.HDAccount, 'payer'],
    [KeyringAccountType.Ledger, 'payload'],
    [KeyringAccountType.Ledger, 'payer'],
    [KeyringAccountType.Trezor, 'payload'],
    [KeyringAccountType.Trezor, 'payer'],
  ])(
    'authenticates jointly changed history and RPC %s %s before any signing handoff',
    async (signerType, changedField) => {
      const selectedPayer =
        changedField === 'payer'
          ? otherTestWallet.address.toLowerCase()
          : PAYER;
      const fields =
        changedField === 'payer'
          ? { from: selectedPayer }
          : { to: SMART, value: BigNumber.from(8), data: '0xabcd' };
      Object.assign(transactions()[0], fields);
      if (changedField === 'payload') {
        transactions()[0].value = '8';
        transactions()[0].input = '0xabcd';
      }
      // Both untrusted descriptions agree; the original hash/signature still
      // authenticates the unchanged public fixture, so neither is authority.
      provider.getTransaction.mockResolvedValue(rawOriginal(fields));
      mockState.vault.accounts.HDAccount =
        signerType === KeyringAccountType.HDAccount
          ? {
              3: {
                id: 3,
                address: selectedPayer,
                xprv: 'synthetic-payer-ciphertext',
              },
            }
          : {};
      if (signerType !== KeyringAccountType.HDAccount)
        mockState.vault.accounts[signerType] = {
          4: { id: 4, address: selectedPayer },
        };
      const ledgerSign = jest
        .fn()
        .mockRejectedValue(new Error('Unexpected device signing'));
      const trezorSign = jest
        .fn()
        .mockRejectedValue(new Error('Unexpected device signing'));
      keyring.ledgerSigner.evm = { signEVMTransaction: ledgerSign };
      keyring.trezorSigner.signEthTransaction = trezorSign;
      jest
        .mocked(privateKeyToAccount)
        .mockReturnValue({ address: selectedPayer } as any);
      await run(false, selectedPayer);
      expect(alert.error).toHaveBeenCalled();
      expect(alert.warning).not.toHaveBeenCalled();
      expect(provider.getBalance).not.toHaveBeenCalled();
      expect(aes.decrypt).not.toHaveBeenCalled();
      expect(privateKeyToAccount).not.toHaveBeenCalled();
      expect(sendLocalEvmTransaction).not.toHaveBeenCalled();
      expect(ledgerSign).not.toHaveBeenCalled();
      expect(trezorSign).not.toHaveBeenCalled();
      expect(provider.sendTransaction).not.toHaveBeenCalled();
      expect(mockPersist).not.toHaveBeenCalled();
    }
  );

  it.each(['account', 'RPC', 'chain', 'provider', 'session', 'payer'])(
    'refuses a %s change during original lookup',
    async (axis) => {
      const pending = deferred<any>();
      const started = deferred<void>();
      provider.getTransaction.mockImplementationOnce(() => {
        started.resolve();
        return pending.promise;
      });
      const sending = run();
      await started.promise;
      if (axis === 'account')
        mockState.vault.activeAccount = { ...owner, id: 8 };
      if (axis === 'RPC') mockState.vault.activeNetwork.url = 'rpc-b';
      if (axis === 'chain') mockState.vault.activeNetwork.chainId = 1;
      if (axis === 'provider') currentProvider = {};
      if (axis === 'session') wallet.walletSessionGeneration++;
      if (axis === 'payer')
        mockState.vault.accounts.HDAccount[3].address = TARGET;
      pending.resolve(rawOriginal());
      await sending;
      expect(alert.error).toHaveBeenCalled();
      expect(aes.decrypt).not.toHaveBeenCalled();
      expect(provider.sendTransaction).not.toHaveBeenCalled();
    }
  );

  it('blocks software signing/broadcast when context changes after credential handoff', async () => {
    jest
      .mocked(sendLocalEvmTransaction)
      .mockImplementationOnce(
        async (_provider, _key, _tx, beforeBroadcast, beforeSign) => {
          wallet.walletSessionGeneration++;
          beforeSign?.();
          beforeBroadcast?.();
          return response as any;
        }
      );
    await run();
    expect(aes.decrypt).toHaveBeenCalledTimes(1);
    expect(provider.sendTransaction).not.toHaveBeenCalled();
    expect(mockPersist).not.toHaveBeenCalled();
    expect(alert.success).not.toHaveBeenCalled();
  });

  it('blocks credential access and signing when the original mines during a delayed fee read', async () => {
    const pending = deferred<any>();
    const started = deferred<void>();
    provider.getBalance.mockImplementationOnce(() => {
      started.resolve();
      return pending.promise;
    });
    const sending = run();
    await started.promise;
    transactions()[0].blockNumber = 123;
    transactions()[0].confirmations = 1;
    pending.resolve(BigNumber.from('1000000000'));
    await sending;
    expect(aes.decrypt).not.toHaveBeenCalled();
    expect(sendLocalEvmTransaction).not.toHaveBeenCalled();
    expect(provider.sendTransaction).not.toHaveBeenCalled();
    expect(mockPersist).not.toHaveBeenCalled();
    expect(alert.success).not.toHaveBeenCalled();
  });

  it('discards a valid hardware signature when the original is superseded during the device request', async () => {
    const hardwareWallet = testWallet;
    const hardwareAddress = hardwareWallet.address.toLowerCase();
    mockState.vault.accounts.HDAccount = {};
    mockState.vault.accounts.Ledger = {
      4: { id: 4, address: hardwareAddress },
    };
    transactions()[0].from = hardwareAddress;
    provider.getTransaction.mockResolvedValue(
      rawOriginal({ from: hardwareAddress })
    );
    const pending = deferred<void>();
    const started = deferred<void>();
    const sign = jest.fn(async ({ rawTx }) => {
      started.resolve();
      await pending.promise;
      const signature = hardwareWallet.signingKey.sign(
        Transaction.from(`0x${rawTx}`).unsignedHash
      );
      return {
        r: signature.r.slice(2),
        s: signature.s.slice(2),
        v: signature.v.toString(16),
      };
    });
    keyring.ledgerSigner.evm = { signEVMTransaction: sign };
    const sending = run(false, hardwareAddress);
    await Promise.race([
      started.promise,
      sending.then(() => {
        throw new Error('Replacement did not reach the Ledger device');
      }),
    ]);
    transactions()[0].isReplaced = true;
    transactions()[0].status = 'replaced';
    pending.resolve();
    await sending;
    expect(sign).toHaveBeenCalledTimes(1);
    expect(provider.verifyConfiguredChainId).toHaveBeenCalledTimes(1);
    expect(provider.sendTransaction).not.toHaveBeenCalled();
    expect(mockPersist).not.toHaveBeenCalled();
    expect(alert.success).not.toHaveBeenCalled();
  });

  it('waits for history persistence after broadcast before reporting success', async () => {
    const saved = deferred<void>();
    const started = deferred<void>();
    mockPersist.mockImplementationOnce(() => {
      started.resolve();
      return saved.promise;
    });
    const sending = run();
    await started.promise;
    expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
    expect(alert.success).not.toHaveBeenCalled();
    saved.resolve();
    await sending;
    expect(alert.success).toHaveBeenCalledTimes(1);
  });

  it('retains the acknowledged hash on a history save failure without sending again', async () => {
    mockPersist.mockRejectedValueOnce(new Error('Storage failed'));
    await expect(run()).resolves.toBe(REPLACEMENT);
    expect(alert.warning).toHaveBeenCalledWith(
      `transactions.replacementHistoryWarning: ${REPLACEMENT}`
    );
    expect(alert.error).not.toHaveBeenCalled();
    expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('retains the acknowledged hash when the UI account changes after broadcast', async () => {
    provider.sendTransaction.mockImplementationOnce(async () => {
      mockState.vault.activeAccount = {
        type: KeyringAccountType.HDAccount,
        id: 3,
      };
      wallet.walletSessionGeneration++;
      return response;
    });
    await expect(run()).resolves.toBe(REPLACEMENT);
    expect(alert.warning).toHaveBeenCalledWith(
      `transactions.replacementHistoryWarning: ${REPLACEMENT}`
    );
    expect(alert.error).not.toHaveBeenCalled();
    expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
    expect(mockPersist).not.toHaveBeenCalled();
  });
});
