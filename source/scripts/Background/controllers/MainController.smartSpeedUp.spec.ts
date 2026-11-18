import { BigNumber } from '@sidhujag/sysweb3-keyring/cjs/ethers-v6';
import { HardwareWalletManager } from '@sidhujag/sysweb3-keyring/cjs/hardware-wallet-manager';
import {
  privateKeyToAccount,
  sendLocalEvmTransaction,
} from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-local-signer';
import { Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';
import { webcrypto } from 'node:crypto';

import {
  createOfflineTrezorHost,
  createTestKeyringManager,
} from '../../../../tests/fixtures/extensionKeyring';
import { createTestEvmSubmissionCapture } from '../../../../tests/helpers/evmSubmission';
import { encodeErc20Transfer } from '../../../shared/erc20';
import { encodeNftTransferData } from '../../../shared/nftTransfer';
import { EvmSignedRecords } from '../../../wallet/evmSignedRecords';
import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import vaultReducer from 'state/vault';
import { INetworkType, KeyringAccountType } from 'types/network';
import { getWalletNavigationScope } from 'utils/navigationState';
import { encodeERC7579Executions } from 'utils/smartAccount/account';
import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
  paliSmartAccountInterface,
} from 'utils/smartAccount/contracts';
import { getSmartAccountUserOpHash } from 'utils/smartAccount/userOperationHash';
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
const APPROVED_MAXIMUM_FEE = '100000000';
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
      trezorHost: createOfflineTrezorHost(),
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
    firstPost?: (signed: Transaction) => Promise<void>,
    legacy = true
  ) => {
    setSignedOriginal(legacy, legacy ? 0 : 2, 25_000);
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
    let balance = BigInt('1000000000');
    let pendingBalance: bigint | undefined;
    let baseFee = 150;
    let blockGasLimit = 30_000_000;
    let confirmedNonce = 8;
    let assetState: 'erc20' | 'erc721' | undefined;
    let smartOperation: any;
    const reads: string[] = [];
    const fixtureFetch = async (url, init): Promise<Response> => {
      expect(url).toBe('https://offline.example');
      const payload = JSON.parse(init!.body as string);
      if (Array.isArray(payload)) {
        const responses = await Promise.all(
          payload.map((row) =>
            fixtureFetch(url, { ...init, body: JSON.stringify(row) }).then(
              (reply) => reply.json()
            )
          )
        );
        return new Response(JSON.stringify(responses), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      const { jsonrpc, method, id, params } = payload;
      reads.push(method);
      let result: unknown;
      if (method === 'eth_chainId') result = `0x${CHAIN.toString(16)}`;
      else if (method === 'eth_getTransactionCount')
        result = `0x${confirmedNonce.toString(16)}`;
      else if (method === 'eth_getBalance')
        result = `0x${(params[1] === 'pending'
          ? pendingBalance ?? balance
          : balance
        ).toString(16)}`;
      else if (method === 'eth_getBlockByNumber')
        result = {
          number: '0x64',
          hash: `0x${'71'.repeat(32)}`,
          gasLimit: `0x${blockGasLimit.toString(16)}`,
          baseFeePerGas: `0x${baseFee.toString(16)}`,
        };
      else if (method === 'eth_getCode') result = assetState ? '0x01' : '0x';
      else if (method === 'eth_estimateGas') result = '0x61a8';
      else if (method === 'eth_getTransactionReceipt' && smartOperation)
        result = null;
      else if (method === 'eth_simulateV1' && smartOperation) {
        const calls = params[0].blockStateCalls[0].calls;
        expect(calls).toHaveLength(1);
        result = [
          {
            number: '0x65',
            parentHash: `0x${'71'.repeat(32)}`,
            transactions: calls.map((call) => ({ ...call, input: call.data })),
            calls: [
              {
                status: '0x1',
                gasUsed: '0x186a0',
                logs: [
                  {
                    address: getPaliEntryPointAddress(CHAIN),
                    ...paliEntryPointInterface.encodeEventLog(
                      paliEntryPointInterface.getEvent('UserOperationEvent')!,
                      [
                        getSmartAccountUserOpHash(smartOperation, CHAIN),
                        smartOperation.sender,
                        '0x' + '00'.repeat(20),
                        smartOperation.nonce,
                        true,
                        1,
                        1,
                      ]
                    ),
                  },
                ],
              },
            ],
          },
        ];
      } else if (method === 'eth_call' && assetState) {
        const data = params[0].data;
        const selector = data.slice(0, 10);
        if (selector === '0x70a08231') result = '0x' + '11'.padStart(64, '0');
        else if (selector === '0x6352211e') {
          if (BigInt('0x' + data.slice(10)) !== BigInt(1)) {
            return new Response(
              JSON.stringify({
                jsonrpc,
                id,
                error: { code: 3, message: 'execution reverted', data: '0x' },
              }),
              {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }
            );
          }
          result = '0x' + PAYER.slice(2).toLowerCase().padStart(64, '0');
        } else
          result =
            assetState === 'erc721' ? '0x' : '0x' + '1'.padStart(64, '0');
      } else if (method === 'eth_sendRawTransaction') {
        const signed = Transaction.from(params[0]);
        posts.push(signed);
        if (posts.length === 1 && firstPost) await firstPost(signed);
        result = signed.hash;
      } else throw new Error(`unexpected ${method}`);
      return new Response(JSON.stringify({ jsonrpc, id, result }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    jest.spyOn(global, 'fetch').mockImplementation(fixtureFetch);
    provider.getGasPrice = jest.fn(async () => BigNumber.from(baseFee));
    provider.getBlock = jest.fn(async () => ({
      gasLimit: BigNumber.from(blockGasLimit),
      baseFeePerGas: BigNumber.from(baseFee),
    }));
    provider.getNetwork = jest.fn(async () => ({ chainId: BigInt(CHAIN) }));
    provider.getBalance = jest.fn(async () => BigNumber.from(balance));
    provider.readMany = rpc.readMany.bind(rpc);
    provider.send = rpc.send.bind(rpc);
    provider.sendTransaction = jest.fn(async (raw: string) => {
      const hash = await rpc.send('eth_sendRawTransaction', [raw]);
      return { ...signedResponse(raw), hash, raw };
    });
    return {
      journal,
      journalSession,
      posts,
      reads,
      setBalance(value: bigint) {
        balance = value;
      },
      setPendingBalance(value: bigint) {
        pendingBalance = value;
      },
      setBaseFee(value: number) {
        baseFee = value;
      },
      setBlockGasLimit(value: number) {
        blockGasLimit = value;
      },
      setSmartOperation(operation: typeof smartOperation) {
        smartOperation = operation;
      },
      setAssetState(value: typeof assetState) {
        assetState = value;
      },
      setConfirmedNonce(value: number) {
        confirmedNonce = value;
      },
      dispose: () => rpc.destroy(),
    };
  };

  it.each(
    [true, false].flatMap((legacy) =>
      ['before-confirm', 'before-persist', 'after-persist', 'healthy'].map(
        (boundary) => ({ legacy, boundary })
      )
    )
  )(
    'checks ordinary replacement affordability at dispatch ($boundary, legacy $legacy)',
    async ({ legacy, boundary }) => {
      const { journal, journalSession, posts, reads, setBalance, dispose } =
        await setupDurableReplacement(undefined, legacy);
      try {
        const walletScope = getWalletNavigationScope();
        const preview = await wallet.speedUpEvmTransaction(
          ORIGINAL,
          legacy,
          CHAIN,
          PAYER,
          { previewOnly: true, walletScope }
        );
        if (boundary === 'before-confirm') setBalance(BigInt(0));
        const append = journal.append.bind(journal);
        jest.spyOn(journal, 'append').mockImplementation(async (...args) => {
          if (boundary === 'before-persist') setBalance(BigInt(0));
          const entry = await append(...args);
          if (boundary === 'after-persist') setBalance(BigInt(0));
          return entry;
        });
        reads.length = 0;
        const result = await wallet.speedUpEvmTransaction(
          ORIGINAL,
          legacy,
          CHAIN,
          PAYER,
          { approvedMaximumFee: preview.maximumFee, walletScope }
        );
        const entries = await journal.listSender(
          journalSession,
          String(CHAIN),
          PAYER
        );
        if (boundary === 'healthy') {
          expect(result).toMatchObject({ isSpeedUp: true });
          expect(posts).toHaveLength(1);
          expect(entries).toHaveLength(1);
          expect(posts[0]!.nonce).toBe(8);
          expect(posts[0]!.value).toBe(BigInt(7));
          expect(posts[0]!.data).toBe('0x1234');
          expect(posts[0]!.gasLimit).toBe(BigInt(30_000));
        } else {
          expect(result).toMatchObject({ isSpeedUp: false });
          expect(posts).toHaveLength(0);
          expect(entries).toHaveLength(0);
        }
        if (boundary !== 'before-confirm') {
          expect(
            reads.filter((method) => method === 'eth_getBalance')
          ).toHaveLength(2);
          expect(
            reads.filter((method) => method === 'eth_getBlockByNumber')
          ).toHaveLength(boundary === 'healthy' ? 2 : 1);
        }
      } finally {
        dispose();
      }
    }
  );

  it.each(
    ['base-fee', 'block-gas-limit'].flatMap((constraint) =>
      ['before-confirm', 'before-persist', 'after-persist', 'healthy'].map(
        (boundary) => ({ constraint, boundary })
      )
    )
  )(
    'retains the reviewed execution bounds ($constraint, $boundary)',
    async ({ constraint, boundary }) => {
      const {
        journal,
        journalSession,
        posts,
        setBaseFee,
        setBlockGasLimit,
        dispose,
      } = await setupDurableReplacement();
      try {
        setBaseFee(100);
        setBlockGasLimit(30_010);
        const walletScope = getWalletNavigationScope();
        const preview = await wallet.speedUpEvmTransaction(
          ORIGINAL,
          true,
          CHAIN,
          PAYER,
          { previewOnly: true, walletScope }
        );
        const invalidate = () =>
          constraint === 'base-fee'
            ? setBaseFee(125)
            : setBlockGasLimit(29_990);
        if (boundary === 'before-confirm') invalidate();
        const append = journal.append.bind(journal);
        jest.spyOn(journal, 'append').mockImplementation(async (...args) => {
          if (boundary === 'before-persist') invalidate();
          const entry = await append(...args);
          if (boundary === 'after-persist') invalidate();
          return entry;
        });
        const submission = wallet.speedUpEvmTransaction(
          ORIGINAL,
          true,
          CHAIN,
          PAYER,
          {
            approvedMaximumFee: preview.maximumFee,
            walletScope,
          }
        );
        if (boundary === 'before-confirm') {
          await expect(submission).rejects.toThrow();
          expect(posts).toHaveLength(0);
          expect(
            await journal.listSender(journalSession, String(CHAIN), PAYER)
          ).toHaveLength(0);
          return;
        }
        const result = await submission;
        const entries = await journal.listSender(
          journalSession,
          String(CHAIN),
          PAYER
        );
        expect(posts).toHaveLength(boundary === 'healthy' ? 1 : 0);
        expect(entries).toHaveLength(boundary === 'healthy' ? 1 : 0);
        expect(result.isSpeedUp).toBe(boundary === 'healthy');
      } finally {
        dispose();
      }
    }
  );

  it.each(['before-confirm', 'before-persist', 'after-persist', 'healthy'])(
    'checks canonical cancellation funds (%s)',
    async (boundary) => {
      const { journal, journalSession, posts, setBalance, dispose } =
        await setupDurableReplacement();
      try {
        const walletScope = getWalletNavigationScope();
        const preview = await wallet.cancelEvmTransaction(
          ORIGINAL,
          true,
          8,
          PAYER,
          { chainId: CHAIN, walletScope },
          { previewOnly: true }
        );
        if (boundary === 'before-confirm') setBalance(BigInt(0));
        const append = journal.append.bind(journal);
        jest.spyOn(journal, 'append').mockImplementation(async (...args) => {
          if (boundary === 'before-persist') setBalance(BigInt(0));
          const entry = await append(...args);
          if (boundary === 'after-persist') setBalance(BigInt(0));
          return entry;
        });
        const submission = wallet.cancelEvmTransaction(
          ORIGINAL,
          true,
          8,
          PAYER,
          { chainId: CHAIN, walletScope },
          { approvedMaximumFee: preview.maximumFee }
        );
        if (boundary === 'before-confirm')
          await expect(submission).rejects.toThrow('Insufficient funds');
        else expect((await submission).isCanceled).toBe(boundary === 'healthy');
        const entries = await journal.listSender(
          journalSession,
          String(CHAIN),
          PAYER
        );
        expect(entries).toHaveLength(boundary === 'healthy' ? 1 : 0);
        expect(posts).toHaveLength(boundary === 'healthy' ? 1 : 0);
      } finally {
        dispose();
      }
    }
  );

  it('refuses an unfunded cancellation preview without signing or persistence', async () => {
    const { journal, journalSession, posts, setBalance, dispose } =
      await setupDurableReplacement();
    try {
      setBalance(BigInt(0));
      await expect(
        wallet.cancelEvmTransaction(
          ORIGINAL,
          true,
          8,
          PAYER,
          { chainId: CHAIN, walletScope: getWalletNavigationScope() },
          { previewOnly: true }
        )
      ).rejects.toThrow('Insufficient funds');
      expect(posts).toHaveLength(0);
      expect(
        await journal.listSender(journalSession, String(CHAIN), PAYER)
      ).toHaveLength(0);
      expect(sendLocalEvmTransaction).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('retains canonical funding for cancellation when the pending balance is zero', async () => {
    const { posts, setPendingBalance, dispose } =
      await setupDurableReplacement();
    try {
      setPendingBalance(BigInt(0));
      const walletScope = getWalletNavigationScope();
      const preview = await wallet.cancelEvmTransaction(
        ORIGINAL,
        true,
        8,
        PAYER,
        { chainId: CHAIN, walletScope },
        { previewOnly: true }
      );
      const result = await wallet.cancelEvmTransaction(
        ORIGINAL,
        true,
        8,
        PAYER,
        { chainId: CHAIN, walletScope },
        { approvedMaximumFee: preview.maximumFee }
      );
      expect(result.isCanceled).toBe(true);
      expect(posts).toHaveLength(1);
    } finally {
      dispose();
    }
  });

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
              { ...spend, metadata: spend.metadata },
              async () => ({ result: 'eligible' })
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
          { ...entries[1]!, metadata: entries[1]!.metadata },
          async () => ({ result: 'eligible' })
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

  it.each([false, true])(
    'speeds up an authenticated local Smart Account transaction with no RPC body (nonce already consumed: %s)',
    async (consumed) => {
      const {
        journal,
        journalSession,
        posts,
        reads,
        setBaseFee,
        setSmartOperation,
        setConfirmedNonce,
      } = await setupDurableReplacement();
      mockState.vault.activeAccount = owner;
      transactions().length = 0;
      const call = encodeERC7579Executions([{ target: PAYER, value: '7' }]);
      const operation = {
        sender: SMART,
        nonce: '4',
        initCode: '0x',
        callData: paliSmartAccountInterface.encodeFunctionData('execute', [
          call.mode,
          call.executionCalldata,
        ]),
        accountGasLimits: '0x' + '000000000000000000000000000186a0'.repeat(2),
        preVerificationGas: '21000',
        gasFees: '0x' + '000000000000000000000000000000c8'.repeat(2),
        paymasterAndData: '0x',
        signature: '0x1234',
      };
      setSmartOperation(operation);
      const data = paliEntryPointInterface.encodeFunctionData('handleOps', [
        [operation],
        PAYER,
      ]);
      const nonce = original.nonce;
      const raw = await testWallet.signTransaction({
        type: 0,
        chainId: CHAIN,
        nonce,
        gasPrice: 200,
        gasLimit: 300_000,
        to: getPaliEntryPointAddress(CHAIN),
        data,
      });
      ORIGINAL = Transaction.from(raw).hash!;
      await journal.append(journalSession, {
        rawTransaction: raw,
        hash: ORIGINAL,
        from: PAYER,
        chainId: String(CHAIN),
        nonce,
        type: 0,
        context: {
          account: {
            ...mockState.vault.accounts.HDAccount[3],
            type: KeyringAccountType.HDAccount,
          },
          network: mockState.vault.activeNetwork,
          operation: 'send',
        },
      });
      provider.getTransaction.mockResolvedValue(null);
      setBaseFee(100);
      const maximumFee = await previewSpeedUpTransaction(
        ORIGINAL,
        true,
        CHAIN,
        PAYER,
        getWalletNavigationScope()
      );
      if (consumed) setConfirmedNonce(nonce + 1);
      await run(true, PAYER, maximumFee);
      expect(posts).toHaveLength(consumed ? 0 : 1);
      if (consumed) {
        expect(alert.error).toHaveBeenCalled();
        return;
      }
      expect(alert.error).not.toHaveBeenCalled();
      expect(posts[0].data).toBe(data);
      expect(posts[0].nonce).toBe(nonce);
      expect(posts[0].gasLimit).toBe(BigInt(300_000));
      expect(posts[0].gasPrice).toBeGreaterThan(BigInt(200));
      expect(reads).toContain('eth_simulateV1');
      expect(transactions()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            hash: posts[0].hash,
            replacesHash: ORIGINAL,
            smartAccountExecutionFrom: SMART,
          }),
        ])
      );
      expect(
        await journal.readSmartAccountSpeedUpIntent(
          journalSession,
          String(CHAIN),
          SMART,
          ORIGINAL
        )
      ).toBeNull();
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

  it.each([
    { legacy: false, kind: 'native' },
    { legacy: true, kind: 'native' },
    { legacy: false, kind: 'contract' },
    { legacy: false, kind: 'erc20' },
    { legacy: false, kind: 'erc721' },
  ] as const)(
    'uses authenticated replacement for a missing $kind transaction (legacy=$legacy)',
    async ({ legacy, kind }) => {
      const {
        journal,
        journalSession,
        posts,
        reads,
        setConfirmedNonce,
        setAssetState,
        dispose,
      } = await setupDurableReplacement(undefined, legacy);
      const asset = kind === 'erc20' || kind === 'erc721';
      if (asset) setAssetState(kind);
      try {
        const original = Transaction.from({
          type: legacy ? 0 : 2,
          chainId: CHAIN,
          to: TARGET,
          value: BigInt(asset ? 0 : 7),
          data:
            kind === 'contract'
              ? '0x1234'
              : kind === 'erc20'
              ? encodeErc20Transfer(PAYER, '7')
              : kind === 'erc721'
              ? encodeNftTransferData({
                  chainId: String(CHAIN),
                  kind: 'nft-transfer',
                  from: PAYER,
                  contractAddress: TARGET,
                  recipient: PAYER,
                  tokenStandard: 'ERC-721',
                  tokenId: '1',
                  amountUnits: '1',
                })
              : '0x',
          nonce: 8,
          gasLimit: BigInt(25_000),
          ...(legacy
            ? { gasPrice: BigInt(100) }
            : { maxFeePerGas: BigInt(200), maxPriorityFeePerGas: BigInt(10) }),
        });
        original.signature = testWallet.signingKey.sign(original.unsignedHash);
        const hash = original.hash!;
        mockState.vault.accountTransactions.HDAccount[3].ethereum[CHAIN] = [];
        expect(keyring.ethereumTransaction.supportsRetainedSpeedUpIntent).toBe(
          true
        );
        await journal.append(
          journalSession,
          {
            context: {
              account: { ...mockState.vault.activeAccount, address: PAYER },
              network: mockState.vault.activeNetwork,
              operation: asset ? kind : 'send',
            },
            chainId: String(CHAIN),
            from: PAYER,
            hash,
            nonce: original.nonce,
            type: original.type!,
            rawTransaction: original.serialized,
          },
          undefined,
          undefined,
          true
        );
        const savedOriginal = await journal.readExact(
          journalSession,
          String(CHAIN),
          PAYER,
          hash
        );
        expect(savedOriginal).toMatchObject({
          payloadKind: 'unsigned-eoa',
          unsignedTransaction: original.unsignedSerialized,
        });
        expect(savedOriginal).not.toHaveProperty('rawTransaction');
        provider.getTransaction.mockResolvedValue(null);
        const activity = await wallet.getSavedEvmTransaction(hash);
        expect(activity).toMatchObject({
          hash,
          from: PAYER,
          to: TARGET,
          value: original.value.toString(),
          ...(kind === 'erc20' && { tokenTransfer: { amountUnits: '7' } }),
          ...(kind === 'erc721' && { collectibleTransfer: { tokenId: '1' } }),
          nonce: original.nonce,
          gasLimit: original.gasLimit.toString(),
          speedUpAvailable: true,
          cancellationUnavailable: true,
        });
        expect(activity).not.toHaveProperty('rawTransaction');
        expect(activity).not.toHaveProperty('unsignedTransaction');
        await expect(wallet.getSavedEvmTransactions()).resolves.toMatchObject({
          transactions: [activity],
        });
        const walletScope = getWalletNavigationScope();
        const maximumFee = await previewSpeedUpTransaction(
          hash,
          legacy,
          CHAIN,
          PAYER,
          walletScope
        );
        expect(aes.decrypt).not.toHaveBeenCalled();
        expect(posts).toHaveLength(0);

        setConfirmedNonce(9);
        await expect(
          wallet.speedUpEvmTransaction(hash, legacy, CHAIN, PAYER, {
            approvedMaximumFee: maximumFee,
            walletScope,
          })
        ).rejects.toThrow('Original transaction nonce was already used');
        expect(aes.decrypt).not.toHaveBeenCalled();
        expect(posts).toHaveLength(0);

        setConfirmedNonce(8);
        await expect(
          wallet.speedUpEvmTransaction(hash, legacy, CHAIN, PAYER, {
            approvedMaximumFee: (BigInt(maximumFee) - BigInt(1)).toString(),
            walletScope,
          })
        ).rejects.toMatchObject({
          message: 'Replacement fee exceeds approval',
          transactionNotBroadcast: true,
        });
        expect(aes.decrypt).not.toHaveBeenCalled();
        expect(posts).toHaveLength(0);

        await handleUpdateTransaction({
          t: (key) => key,
          updateData: {
            alert,
            approvedMaximumFee: maximumFee,
            chainId: CHAIN,
            isLegacy: legacy,
            signerAddress: PAYER,
            txHash: hash,
            updateType: UpdateTxAction.SpeedUp,
            walletScope,
          },
        });
        expect(console.error).not.toHaveBeenCalled();
        expect(posts).toHaveLength(1);
        if (kind === 'contract') expect(reads).toContain('eth_estimateGas');
        if (asset) expect(reads).toContain('eth_call');
        expect(posts[0]).toMatchObject({
          accessList: original.accessList,
          chainId: original.chainId,
          data: original.data,
          from: original.from,
          gasLimit: original.gasLimit,
          nonce: original.nonce,
          to: original.to,
          type: original.type,
          value: original.value,
        });
        expect(posts[0].hash).not.toBe(hash);
        const savedReplacement = await journal.readExact(
          journalSession,
          String(CHAIN),
          PAYER,
          posts[0].hash!
        );
        expect(savedReplacement).toMatchObject({
          payloadKind: 'unsigned-eoa',
          unsignedTransaction: posts[0].unsignedSerialized,
        });
        expect(savedReplacement).not.toHaveProperty('rawTransaction');
        expect(posts[0].maxFeePerGas ?? posts[0].gasPrice).toBeGreaterThan(
          original.maxFeePerGas ?? original.gasPrice!
        );
        expect(alert.success).toHaveBeenCalledWith(
          'transactions.transactionAcceleratedSuccessfully'
        );
        expect(
          mockState.vault.accountTransactions.HDAccount[3].ethereum[CHAIN]
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ hash, isReplaced: true }),
            expect.objectContaining({
              hash: posts[0].hash,
              replacesHash: hash,
            }),
          ])
        );
      } finally {
        dispose();
      }
    }
  );

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
    provider.signal = new AbortController().signal;
    provider._getConnection = () => ({
      url: mockState.vault.activeNetwork.url,
    });
    provider.readMany = jest.fn(async (requests) =>
      requests.map(({ method, params }) => {
        if (method !== 'eth_chainId' || params.length)
          throw new Error('Unexpected identity read');
        return { status: 'fulfilled', value: `0x${CHAIN.toString(16)}` };
      })
    );

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
