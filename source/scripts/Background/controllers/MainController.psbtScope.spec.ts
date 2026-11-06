jest.unmock('syscoinjs-lib');

jest.mock('..', () => ({ getController: jest.fn() }));
jest.mock('./providers/walletHttpIdentity', () => ({
  withWalletBackend: (_endpoint: string, read: () => Promise<unknown>) =>
    read(),
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {
    toPali: (psbt: unknown) => psbt,
    fromPali: jest.fn(),
  },
}));
jest.mock('utils/navigationState', () => ({
  clearNavigationState: jest.fn().mockResolvedValue(undefined),
  clearTransactionNavigationState: jest.fn().mockResolvedValue(undefined),
}));

import { PsbtUtils } from '@sidhujag/sysweb3-keyring';
import { getNetworkConfig } from '@sidhujag/sysweb3-network';
import { webcrypto } from 'crypto';
import { utils as syscoinUtils } from 'syscoinjs-lib';

import {
  captureDappUtxoSubmission,
  watchApprovalSubmission,
} from '../handlers/approvalSubmission';
import store from 'state/store';
import { INetworkType, KeyringAccountType } from 'types/network';
import {
  captureSentryCollateralAdmission,
  reserveSentryCollateral,
} from 'utils/sentry/collateral';
import { SENTRY_NETWORKS } from 'utils/sentry/network';
import { chromeStorage } from 'utils/storageAPI';
import {
  createUtxoFeeReview,
  getVerifiedSyscoinPsbtValueSummary,
} from 'utils/syscoinPsbtValues';
import {
  createUtxoAcknowledgedInputs,
  UTXO_NETWORK_CATCHING_UP,
} from 'utils/utxoAcknowledgedInputs';
import { UTXO_SIGNING_CONTEXT_CHANGED } from 'utils/utxoSigningContext';

import MainController from './MainController';

// A structurally finalized public fixture, with dummy witness bytes only. No
// private key or cryptographic signature is generated, and no network is used.
const syntheticPsbt = (fee: bigint, finalized = true, replaceable = false) => {
  const psbt = new syscoinUtils.bitcoinjs.Psbt();
  const script = Buffer.from('0014' + '00'.repeat(20), 'hex');
  psbt.addInput({
    hash: Buffer.alloc(32, 1),
    index: 0,
    witnessUtxo: { script, value: BigInt(10000000) },
  });
  if (replaceable) psbt.setInputSequence(0, 0xfffffffd);
  psbt.addOutput({ script, value: BigInt(10000000) - fee });
  if (finalized)
    psbt.updateInput(0, {
      finalScriptWitness: Buffer.concat([
        Buffer.from([2, 72]),
        Buffer.alloc(72),
        Buffer.from([33]),
        Buffer.alloc(33),
      ]),
    });
  return psbt;
};

const syntheticSummary = (psbt: ReturnType<typeof syntheticPsbt>) => ({
  feeSatoshis: '1000',
  inputScripts: psbt.data.inputs.map((input) => input.witnessUtxo!.script),
});

describe('PSBT approval context', () => {
  let wallet: any;
  let state: any;
  let keyring: any;
  const selectUtxoNetwork = (
    chainId: number,
    slip44: number,
    currency: string
  ) => {
    state.vault.activeNetwork = {
      ...state.vault.activeNetwork,
      chainId,
      slip44,
      currency,
    };
    state.vaultGlobal.activeSlip44 = slip44;
    state.vaultGlobal.networks.syscoin[chainId] = {
      ...state.vault.activeNetwork,
      utxoBackendChain: slip44 === 1 ? 'test' : 'main',
    };
  };
  const reviewedFee = (
    psbt: ReturnType<typeof syntheticPsbt>,
    feeSatoshis: string
  ) =>
    wallet.attestUtxoWalletReview(
      wallet.captureUtxoSigningContext().walletReviewScope,
      createUtxoFeeReview(psbt, feeSatoshis)
    );
  const authorize = {
    assertCurrent: () => undefined,
    signal: new AbortController().signal,
  };
  const approveExternalPsbt = async (
    method: 'signSyscoinPsbt' | 'signSendAndSaveTransaction',
    psbt: ReturnType<typeof syntheticPsbt>
  ) => {
    const reviewed = { psbt: psbt.toBase64(), assets: '[]' };
    const context = wallet.captureUtxoSigningContext().context;
    const documentId = 'approved-document';
    const signal = new AbortController().signal;
    const release = watchApprovalSubmission(documentId, jest.fn(), undefined, {
      method,
      psbt: reviewed,
      context,
      assertCurrent: () => undefined,
      checkDocument: async () => undefined,
      getSignal: () => signal,
    });
    const { id, getURL } = chrome.runtime;
    Object.assign(chrome.runtime, {
      id: 'pali',
      getURL: (path: string) => `chrome-extension://pali/${path}`,
    });
    try {
      const approval = captureDappUtxoSubmission(
        {
          id: 'pali',
          documentId,
          url: 'chrome-extension://pali/external.html',
        },
        method,
        { psbt: reviewed }
      );
      if (!approval) throw new Error('Fixture approval is unavailable');
      await approval.checkDocument();
      return await wallet[method](approval.input, approval.authority);
    } finally {
      Object.assign(chrome.runtime, { id, getURL });
      release();
    }
  };
  const defaultTxid = syntheticPsbt(BigInt(1000)).extractTransaction().getId();
  const dispatch = async (raw: string, port: any) => {
    const url = 'https://rpc-a.invalid/api/v2/sendtx/';
    const id = syscoinUtils.bitcoinjs.Transaction.fromHex(raw).getId();
    await port.prepare({ url, rawTransaction: raw, txid: id });
    port.assertCurrent();
    await port.fetch(url, { method: 'POST', body: raw, signal: port.signal });
    return { txid: id };
  };
  beforeEach(() => {
    Object.defineProperty(global, 'crypto', {
      value: webcrypto,
      configurable: true,
    });
    state = {
      vault: {
        isBitcoinBased: true,
        activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
        accounts: {
          HDAccount: {
            0: { address: 'account-0', xpub: 'xpub-0' },
            1: { address: 'account-1', xpub: 'xpub-1' },
          },
        },
        accountTransactions: {
          HDAccount: { 0: { syscoin: { 57: [] } } },
        },
        activeNetwork: {
          kind: INetworkType.Syscoin,
          chainId: 57,
          slip44: 57,
          url: 'https://rpc-a.invalid',
          currency: 'sys',
        },
      },
      vaultGlobal: {
        activeSlip44: 57,
        networks: {
          syscoin: {
            57: {
              kind: INetworkType.Syscoin,
              chainId: 57,
              slip44: 57,
              currency: 'sys',
              url: 'https://rpc-a.invalid',
              utxoBackendChain: 'main',
            },
          },
        },
      },
    };
    jest.spyOn(store, 'getState').mockImplementation(() => state);
    keyring = {
      isUnlocked: jest.fn().mockReturnValue(true),
      syscoinTransaction: {
        getEstimateSysTransactionFee: jest
          .fn()
          .mockResolvedValue({ psbt: 'estimate-fixture', fee: 0.00001 }),
        signPSBT: jest.fn().mockResolvedValue('signed'),
        sendTransaction: jest.fn(dispatch),
      },
    };
    wallet = Object.create(MainController.prototype);
    wallet.walletSessionGeneration = 0;
    wallet.networkRequestGeneration = 0;
    wallet.getActiveKeyring = jest.fn(() => keyring);
    wallet.verifySyscoinPsbt = jest.fn(async () => {
      const psbt = syntheticPsbt(BigInt(1000));
      return { psbt, summary: syntheticSummary(psbt) };
    });
    wallet.sendAndSaveTransaction = jest.fn();
    wallet.getProtectedSentryOutpoints = jest.fn().mockResolvedValue([]);
    wallet.getRetainedUtxoRecords = jest.fn(() => ({
      fundingExclusions: jest.fn(async () => ({
        outpoints: [],
        submitted: new Set(),
      })),
      admit: async (
        _session: unknown,
        _record: unknown,
        _intent: string,
        submit: (
          prepare: () => Promise<void>,
          release: () => void
        ) => Promise<unknown>
      ) =>
        submit(
          async () => undefined,
          () => undefined
        ),
      acknowledge: async () => undefined,
    }));
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (init?.method !== 'POST')
        throw new Error('Unexpected fixture network call');
      const raw = syscoinUtils.bitcoinjs.Transaction.fromHex(
        init.body as string
      );
      const response = Response.json({ result: raw.getId() });
      Object.defineProperty(response, 'url', { value: url });
      return response;
    });
    (PsbtUtils.fromPali as jest.Mock)
      .mockReset()
      .mockImplementation(() => syntheticPsbt(BigInt(1000)));
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(['quote', 'submit'])(
    'refuses a Bitcoin Gold ordinary software %s before funding or signing',
    async (operation) => {
      selectUtxoNetwork(156, 156, 'btg');
      await expect(
        operation === 'quote'
          ? wallet.getEstimateSysTransactionFee({ amount: '1' })
          : wallet.signSendAndSaveTransaction({
              psbt: 'fixture',
              ordinaryWalletSend: true,
              isLedger: true, // The caller cannot change the signer route.
              utxoFeeReview: await reviewedFee(
                syntheticPsbt(BigInt(1000)),
                '1000'
              ),
            })
      ).rejects.toMatchObject({ code: 'UTXO_SOFTWARE_SPEND_UNSUPPORTED' });
      expect(
        keyring.syscoinTransaction.getEstimateSysTransactionFee
      ).not.toHaveBeenCalled();
      expect(keyring.syscoinTransaction.signPSBT).not.toHaveBeenCalled();
      expect(keyring.syscoinTransaction.sendTransaction).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    }
  );

  it.each(['signSyscoinPsbt', 'signSendAndSaveTransaction'] as const)(
    'refuses a Bitcoin Gold software PSBT before owned reads through %s',
    async (method) => {
      selectUtxoNetwork(156, 156, 'btg');
      await expect(
        approveExternalPsbt(method, syntheticPsbt(BigInt(1000)))
      ).rejects.toMatchObject({ code: 'UTXO_SOFTWARE_SPEND_UNSUPPORTED' });
      expect(wallet.verifySyscoinPsbt).not.toHaveBeenCalled();
      expect(keyring.syscoinTransaction.signPSBT).not.toHaveBeenCalled();
      expect(keyring.syscoinTransaction.sendTransaction).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['recipient', 'quote'],
    ['recipient', 'submit'],
    ['prevout', 'quote'],
    ['prevout', 'submit'],
    ['recipient', 'signSyscoinPsbt'],
    ['prevout', 'signSyscoinPsbt'],
    ['recipient', 'signSendAndSaveTransaction'],
    ['prevout', 'signSendAndSaveTransaction'],
  ] as const)(
    'refuses an unqualified custom witness-v1 %s during %s',
    async (location, operation) => {
      selectUtxoNetwork(2, 2, 'ltc');
      const bitcoin = syscoinUtils.bitcoinjs;
      const v0 = Buffer.from('0014' + '01'.repeat(20), 'hex');
      const v1 = Buffer.from('5120' + '02'.repeat(32), 'hex');
      const previous = new bitcoin.Transaction();
      previous.addInput(Buffer.alloc(32, 3), 0);
      previous.addOutput(location === 'prevout' ? v1 : v0, BigInt(100000));
      const psbt = new bitcoin.Psbt();
      psbt.addInput({
        hash: previous.getId(),
        index: 0,
        nonWitnessUtxo: previous.toBuffer(),
      });
      psbt.addOutput({
        script: location === 'recipient' ? v1 : v0,
        value: BigInt(99000),
      });
      psbt.updateInput(0, {
        finalScriptWitness: Buffer.concat([
          Buffer.from([1, 64]),
          Buffer.alloc(64),
        ]),
      });
      wallet.verifySyscoinPsbt.mockImplementation(async () => ({
        psbt,
        summary: await getVerifiedSyscoinPsbtValueSummary(psbt, jest.fn()),
      }));
      (PsbtUtils.fromPali as jest.Mock).mockReturnValue(psbt);
      let result: Promise<unknown>;
      if (operation === 'quote') {
        result = wallet.getEstimateSysTransactionFee({ amount: '0.00099' });
      } else if (operation === 'submit') {
        result = wallet.signSendAndSaveTransaction({
          psbt: 'fixture',
          ordinaryWalletSend: true,
          utxoFeeReview: await reviewedFee(psbt, '1000'),
        });
      } else {
        result = approveExternalPsbt(operation, psbt);
      }
      await expect(result).rejects.toMatchObject({
        code: 'UTXO_SOFTWARE_SPEND_UNSUPPORTED',
      });
      expect(keyring.syscoinTransaction.signPSBT).not.toHaveBeenCalled();
      expect(keyring.syscoinTransaction.sendTransaction).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    }
  );

  it('preserves ordinary quote and send for the selected hardware signer', async () => {
    selectUtxoNetwork(156, 156, 'btg');
    state.vault.activeAccount.type = KeyringAccountType.Ledger;
    state.vault.accounts.Ledger = { 0: { address: 'ledger', xpub: 'ledger' } };
    const quote = await wallet.getEstimateSysTransactionFee({ amount: '1' });
    await expect(
      wallet.signSendAndSaveTransaction({
        psbt: quote.psbt,
        ordinaryWalletSend: true,
        utxoFeeReview: quote.utxoFeeReview,
      })
    ).resolves.toEqual({ txid: defaultTxid });
    expect(keyring.syscoinTransaction.signPSBT).toHaveBeenCalledTimes(1);
    expect(keyring.syscoinTransaction.sendTransaction).toHaveBeenCalledTimes(1);
    await expect(
      approveExternalPsbt('signSyscoinPsbt', syntheticPsbt(BigInt(1000)))
    ).resolves.toBe('signed');
    expect(keyring.syscoinTransaction.signPSBT).toHaveBeenCalledTimes(2);
  });

  it('retries an already signed transfer without entering ordinary software admission', async () => {
    selectUtxoNetwork(156, 156, 'btg');
    const transaction = syntheticPsbt(BigInt(1000)).extractTransaction();
    const record = {
      owner: wallet.utxoRecordOwner(
        state.vault.activeNetwork,
        wallet.captureUtxoSigningContext().context.account
      ),
      operation: 'wallet',
      txid: transaction.getId(),
      url: 'https://rpc-a.invalid/api/v2/sendtx/',
      rawTransaction: transaction.toHex(),
      outpoints: [`${'01'.repeat(32)}:0`],
      feeSatoshis: '1000',
      virtualSize: transaction.virtualSize(),
    };
    wallet.getRetainedUtxoRecords.mockReturnValue({
      ...wallet.getRetainedUtxoRecords(),
      readExact: jest.fn().mockResolvedValue(record),
    });
    const review = await wallet.prepareRetainedUtxoRetry(record.txid);
    await expect(wallet.confirmRetainedUtxoRetry(review.id)).resolves.toEqual({
      txid: record.txid,
    });
    expect(keyring.syscoinTransaction.signPSBT).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      record.url,
      expect.objectContaining({ method: 'POST', body: record.rawTransaction })
    );
  });

  it('revokes a cancelled saved review and discards a superseded read', async () => {
    const record = {
      rawTransaction: syntheticPsbt(BigInt(1000)).extractTransaction().toHex(),
      url: 'https://rpc-a.invalid/api/v2/sendtx/',
      feeSatoshis: '1000',
    };
    let resume!: (value: typeof record) => void;
    const held = new Promise<typeof record>((resolve) => {
      resume = resolve;
    });
    wallet.getRetainedUtxoRecords.mockReturnValue({
      readExact: jest.fn().mockResolvedValue(record).mockReturnValueOnce(held),
    });
    const superseded = expect(
      wallet.prepareRetainedUtxoRetry(defaultTxid)
    ).rejects.toThrow('Saved transfer is unavailable');
    const review = await wallet.prepareRetainedUtxoRetry(defaultTxid);
    resume(record);
    await superseded;
    wallet.cancelRetainedUtxoRetry(review.id);
    await expect(wallet.confirmRetainedUtxoRetry(review.id)).rejects.toThrow(
      'Review the saved transfer again'
    );
    expect(keyring.syscoinTransaction.sendTransaction).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  const verifyOwnedLegacyWif = async (
    chainId: number,
    slip44: number,
    currency: string
  ) => {
    const { SoftwareKeyring, createKeyringHost } = jest.requireActual(
      '@sidhujag/sysweb3-keyring/cjs/software.js'
    );
    const actualPsbtUtils = jest.requireActual(
      '@sidhujag/sysweb3-keyring/cjs/utils/psbt.js'
    ).PsbtUtils;
    const storage = new Map<string, unknown>();
    const ring = new SoftwareKeyring(
      createKeyringHost({
        get: async (key: string) => storage.get(key),
        set: async (key: string, value: unknown) => {
          storage.set(key, value);
        },
        deleteItem: async (key: string) => {
          storage.delete(key);
        },
        createManyIfAbsent: async (items: Record<string, unknown>) => {
          if (Object.keys(items).some((key) => storage.has(key))) return false;
          for (const [key, value] of Object.entries(items))
            storage.set(key, value);
          return true;
        },
      }),
      { captureEvmSubmission: null }
    );
    const bitcoin = syscoinUtils.bitcoinjs;
    const network = getNetworkConfig(slip44, currency).networks.mainnet;
    const key = bitcoin.ECPair.fromPrivateKey(Buffer.alloc(32, 18), {
      network,
    });
    const payer = bitcoin.payments.p2pkh({ pubkey: key.publicKey, network });
    const recipient = bitcoin.payments.p2pkh({
      hash: Buffer.alloc(20, 19),
      network,
    }).address;
    const previous = new bitcoin.Transaction();
    previous.addInput(Buffer.alloc(32, 20), 0);
    previous.addOutput(payer.output, BigInt(100000));
    const endpoint = 'https://offline.invalid';
    const txid = previous.getId();
    state.vault.activeNetwork.url = endpoint;
    selectUtxoNetwork(chainId, slip44, currency);
    state.vault.accounts = {
      HDAccount: {},
      Imported: {},
      Ledger: {},
      Trezor: {},
      SmartAccount: {},
    };
    ring.setVaultStateGetter(() => state.vault);
    try {
      const initial = await ring.initializeWalletSecurely(
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        'synthetic test password'
      );
      state.vault.accounts.HDAccount[0] = initial;
      const imported = await ring.importAccount(key.toWIF(), undefined, {
        utxoAddressType: 'p2pkh',
      });
      state.vault.accounts.Imported[imported.id] = imported;
      state.vault.activeAccount = {
        id: imported.id,
        type: KeyringAccountType.Imported,
      };
      wallet.getActiveKeyring.mockReturnValue(ring);
      wallet.verifySyscoinPsbt = async (data: any) => {
        const psbt = actualPsbtUtils.fromPali(data, state.vault.activeNetwork);
        const summary = await getVerifiedSyscoinPsbtValueSummary(
          psbt,
          async () => ({ hex: previous.toHex() })
        );
        return { psbt, summary };
      };
      (PsbtUtils.fromPali as jest.Mock).mockImplementation(
        actualPsbtUtils.fromPali
      );
      jest
        .spyOn(PsbtUtils, 'toPali')
        .mockImplementation(actualPsbtUtils.toPali);
      let advertised = 70000;
      const reply = (url: string, body: unknown) => {
        const response = Response.json(body);
        Object.defineProperty(response, 'url', { value: url });
        return response;
      };
      const fetch = jest
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (url, init) => {
          if (init?.method === 'POST')
            throw new Error('A POST is forbidden in this test');
          if (url === `${endpoint}/api/v2/utxo/${payer.address}`)
            return reply(url, [
              { txid, vout: 0, value: String(advertised), confirmations: 10 },
            ]);
          if (url === `${endpoint}/api/v2/tx/${txid}`)
            return reply(url, { hex: previous.toHex() });
          throw new Error('Unexpected fixture URL');
        });
      const request = {
        amount: '0.0004',
        receivingAddress: recipient,
        feeRate: 0.00000002,
      };
      const sign = jest.spyOn(ring.syscoinTransaction, 'signPSBT');
      await expect(
        wallet.getEstimateSysTransactionFee(request)
      ).rejects.toMatchObject({
        message: 'Mismatched owned legacy previous transaction value',
      });
      expect(sign).not.toHaveBeenCalled();
      advertised = 100000;
      const honest = await wallet.getEstimateSysTransactionFee(request);
      expect(honest.utxoFeeReview.feeSatoshis).toBe('452');
      await expect(
        wallet.signSyscoinPsbt({
          psbt: honest.psbt,
          utxoFeeReview: honest.utxoFeeReview,
        })
      ).resolves.toBeDefined();
      expect(sign).toHaveBeenCalledTimes(1);
      expect(
        fetch.mock.calls.every(([, init]) => init?.method !== 'POST')
      ).toBe(true);
    } finally {
      await ring.destroy();
    }
  };

  it.each([
    [5700, 1, 'tsys'],
    [2, 2, 'ltc'],
  ])('verifies owned Legacy/WIF funding for chain %i', verifyOwnedLegacyWif);

  it('signs an unchanged account after prevout verification', async () => {
    await expect(
      wallet.signSyscoinPsbt({ psbt: 'public-fixture' })
    ).resolves.toBe('signed');
    expect(wallet.verifySyscoinPsbt).toHaveBeenCalledTimes(1);
    expect(keyring.syscoinTransaction.signPSBT).toHaveBeenCalledTimes(1);
    expect(keyring.syscoinTransaction.signPSBT).toHaveBeenCalledWith(
      { psbt: expect.objectContaining({ txOutputs: expect.any(Array) }) },
      expect.objectContaining({
        assertCurrent: expect.any(Function),
        fetch: expect.any(Function),
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('rejects direct Sentry fee signing without a local authorization token before the signer', async () => {
    const psbt = syntheticPsbt(BigInt(1000), false);
    psbt.setVersion(81);
    wallet.verifySyscoinPsbt.mockResolvedValue({ psbt });
    await expect(
      wallet.signSyscoinPsbt({ psbt: { psbt: 'sentry' } })
    ).rejects.toThrow('SENTRY_FEE_AUTHORIZATION_REQUIRED');
    expect(keyring.syscoinTransaction.signPSBT).not.toHaveBeenCalled();
  });

  it('keeps Sentry sign-and-send unsupported while allowing ordinary PSBT routing', async () => {
    const psbt = syntheticPsbt(BigInt(1000), false);
    psbt.setVersion(81);
    (PsbtUtils.fromPali as jest.Mock).mockReturnValue(psbt);
    await expect(
      wallet.prepareSentryFeePsbt('sentry', 'https://site.test', false)
    ).rejects.toThrow('require sys_sign');
    psbt.setVersion(2);
    await expect(
      wallet.prepareSentryFeePsbt('ordinary', 'https://site.test', false)
    ).resolves.toBeUndefined();
  });

  it.each(['fresh context', 'returned transaction'])(
    'does not disclose a fee signature if %s changes after signing',
    async (failure) => {
      const psbt = syntheticPsbt(BigInt(1000), false);
      psbt.setVersion(81);
      const unsigned = Buffer.from(
        psbt.data.globalMap.unsignedTx.toBuffer()
      ).toString('hex');
      const finish = jest.fn();
      const review = jest.fn(async (_token, bytes) => {
        if (bytes !== unsigned) throw new Error('changed transaction');
        return { operation: 'updateService', feeSatoshis: '1000' };
      });
      wallet.getSentryController = jest.fn(async () => ({
        reviewFeePsbt: review,
        beginFeeSigning: () => finish,
      }));
      wallet.verifySyscoinPsbt.mockResolvedValue({
        psbt,
        summary: syntheticSummary(psbt),
      });
      const changed = syntheticPsbt(BigInt(1000), false);
      changed.setVersion(81);
      if (failure === 'returned transaction') changed.setLocktime(99);
      (PsbtUtils.fromPali as jest.Mock).mockReturnValue(changed);
      if (failure === 'fresh context')
        review
          .mockResolvedValueOnce({
            operation: 'updateService',
            feeSatoshis: '1000',
          })
          .mockRejectedValueOnce(new Error('changed node state'));
      await expect(
        wallet.signSyscoinPsbt({
          psbt: { psbt: 'sentry', sentryFeeAuthorization: 'local-token' },
        })
      ).rejects.toThrow(/changed/);
      expect(keyring.syscoinTransaction.signPSBT).toHaveBeenCalledTimes(1);
      expect(finish).not.toHaveBeenCalledWith(true);
      expect(finish).toHaveBeenCalledWith();
    }
  );

  it('rechecks the complete Sentry authorization and consumes it only at successful disclosure', async () => {
    const psbt = syntheticPsbt(BigInt(1000), false);
    psbt.setVersion(81);
    const finish = jest.fn();
    const review = jest.fn(async () => ({
      operation: 'updateService',
      feeSatoshis: '1000',
    }));
    wallet.getSentryController = jest.fn(async () => ({
      reviewFeePsbt: review,
      beginFeeSigning: () => finish,
    }));
    wallet.verifySyscoinPsbt.mockResolvedValue({
      psbt,
      summary: syntheticSummary(psbt),
    });
    (PsbtUtils.fromPali as jest.Mock).mockReturnValue(psbt);
    await expect(
      wallet.signSyscoinPsbt({
        psbt: { psbt: 'sentry', sentryFeeAuthorization: 'local-token' },
      })
    ).resolves.toBe('signed');
    expect(review).toHaveBeenCalledTimes(2);
    expect(finish.mock.calls).toEqual([[true], []]);
  });

  it('rejects protected collateral in a dapp sign-only PSBT before signing', async () => {
    wallet.getProtectedSentryOutpoints.mockResolvedValue([
      { txid: '01'.repeat(32), vout: 0, proTxHash: '02'.repeat(32) },
    ]);
    wallet.verifySyscoinPsbt.mockResolvedValue({
      psbt: syntheticPsbt(BigInt(1000), false),
    });
    await expect(wallet.signSyscoinPsbt({ psbt: 'dapp-psbt' })).rejects.toThrow(
      'protected Sentry Node collateral'
    );
    expect(keyring.syscoinTransaction.signPSBT).not.toHaveBeenCalled();
  });

  it('passes only background-owned exclusions to the builder', async () => {
    const reservation = {
      txid: '02'.repeat(32),
      vout: 3,
      proTxHash: '03'.repeat(32),
    };
    wallet.getProtectedSentryOutpoints.mockResolvedValue([reservation]);
    await wallet.getEstimateSysTransactionFee({
      amount: '1',
      excludedOutpoints: [],
    });
    expect(
      keyring.syscoinTransaction.getEstimateSysTransactionFee
    ).toHaveBeenCalledWith(
      { amount: '1', excludedOutpoints: [reservation] },
      expect.objectContaining({ fetch: expect.any(Function) })
    );
  });

  it.each([
    ['journal match', true, '01'.repeat(32) + ':0', true],
    ['signed or unknown', true, '01'.repeat(32) + ':0', false],
    ['protected collateral', true, '02'.repeat(32) + ':0', false],
    ['other outpoint', true, '01'.repeat(32) + ':1', false],
    ['ordinary send', false, '01'.repeat(32) + ':0', false],
    ['empty wallet', true, undefined, false],
  ] as const)(
    'classifies an empty native quote using only observed journal exclusions (%s)',
    async (scenario, nativeSweep, observed, catchingUp) => {
      const pending = { txid: '01'.repeat(32), vout: 0 };
      const collateral = { txid: '02'.repeat(32), vout: 0 };
      wallet.getRetainedUtxoRecords.mockReturnValue({
        fundingExclusions: jest.fn(async () => ({
          outpoints: [pending],
          submitted:
            scenario === 'signed or unknown'
              ? new Set()
              : new Set([`${pending.txid}:${pending.vout}`]),
        })),
      });
      wallet.getProtectedSentryOutpoints.mockResolvedValue([collateral]);
      const insufficient = {
        error: true,
        code: 'INSUFFICIENT_FUNDS',
        message: 'No native UTXOs are available to sweep.',
        ...(observed && { excludedNativeOutpoints: [observed] }),
      };
      keyring.syscoinTransaction.getEstimateSysTransactionFee.mockRejectedValueOnce(
        insufficient
      );
      const result = wallet.getEstimateSysTransactionFee({
        amount: '1',
        nativeSweep,
      });
      if (catchingUp)
        await expect(result).rejects.toMatchObject({
          code: UTXO_NETWORK_CATCHING_UP,
          transactionNotBroadcast: true,
        });
      else await expect(result).rejects.toBe(insufficient);
      expect(
        keyring.syscoinTransaction.getEstimateSysTransactionFee
      ).toHaveBeenCalledTimes(1);
      expect(keyring.syscoinTransaction.signPSBT).not.toHaveBeenCalled();
    }
  );

  it('discards a delayed empty-sweep explanation after the wallet endpoint changes', async () => {
    const pending = { txid: '01'.repeat(32), vout: 0 };
    wallet.getRetainedUtxoRecords.mockReturnValue({
      fundingExclusions: jest.fn(async () => ({
        outpoints: [pending],
        submitted: new Set([`${pending.txid}:${pending.vout}`]),
      })),
    });
    keyring.syscoinTransaction.getEstimateSysTransactionFee.mockImplementationOnce(
      async () => {
        state.vault.activeNetwork.url = 'https://rpc-b.invalid';
        throw Object.assign(
          new Error('No native UTXOs are available to sweep.'),
          {
            error: true,
            code: 'INSUFFICIENT_FUNDS',
            excludedNativeOutpoints: [`${pending.txid}:${pending.vout}`],
          }
        );
      }
    );
    await expect(
      wallet.getEstimateSysTransactionFee({ amount: '1', nativeSweep: true })
    ).rejects.toThrow(UTXO_SIGNING_CONTEXT_CHANGED);
  });

  it('keeps ordinary transactions on custom Syscoin networks working without Sentry support', async () => {
    wallet.getProtectedSentryOutpoints = (
      MainController.prototype as any
    ).getProtectedSentryOutpoints.bind(wallet);
    state.vault.activeNetwork = {
      kind: INetworkType.Syscoin,
      chainId: 0,
      slip44: 0,
      currency: 'btc',
      url: 'https://custom-registered.invalid',
    };
    state.vaultGlobal.activeSlip44 = 0;
    state.vaultGlobal.networks.syscoin[0] = {
      ...state.vault.activeNetwork,
      utxoBackendChain: 'main',
    };
    await expect(
      wallet.getEstimateSysTransactionFee({ amount: '1' })
    ).resolves.toMatchObject({ fee: 0.00001 });
    await expect(
      wallet.signSyscoinPsbt({ psbt: 'custom-network-psbt' })
    ).resolves.toBe('signed');
    expect(keyring.syscoinTransaction.signPSBT).toHaveBeenCalledTimes(1);
  });

  it('does not sign after account changes while reading protection records', async () => {
    wallet.getProtectedSentryOutpoints.mockImplementation(async () => {
      state.vault.activeAccount = { id: 1, type: KeyringAccountType.HDAccount };
      return [];
    });
    await expect(wallet.signSyscoinPsbt({ psbt: 'dapp-psbt' })).rejects.toThrow(
      UTXO_SIGNING_CONTEXT_CHANGED
    );
    expect(keyring.syscoinTransaction.signPSBT).not.toHaveBeenCalled();
  });

  it('does not expose a signed PSBT if its collateral becomes protected during signing', async () => {
    keyring.syscoinTransaction.signPSBT.mockImplementation(async () => {
      wallet.getProtectedSentryOutpoints.mockResolvedValue([
        { txid: '01'.repeat(32), vout: 0 },
      ]);
      return 'signed';
    });
    await expect(wallet.signSyscoinPsbt({ psbt: 'dapp-psbt' })).rejects.toThrow(
      'protected Sentry Node collateral'
    );
    expect(keyring.syscoinTransaction.sendTransaction).not.toHaveBeenCalled();
  });

  it.each(['account', 'network', 'lock', 'session', 'xpub'])(
    'does not invoke the signer after %s changes during verification',
    async (change) => {
      let finish!: () => void;
      wallet.verifySyscoinPsbt.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          })
      );
      const signing = wallet.signSyscoinPsbt({ psbt: 'public-fixture' });
      if (change === 'account')
        state.vault.activeAccount = {
          id: 1,
          type: KeyringAccountType.HDAccount,
        };
      if (change === 'network')
        state.vault.activeNetwork = {
          ...state.vault.activeNetwork,
          url: 'https://rpc-b.invalid',
        };
      if (change === 'lock') keyring.isUnlocked.mockReturnValue(false);
      if (change === 'session') wallet.walletSessionGeneration += 1;
      if (change === 'xpub')
        state.vault.accounts.HDAccount[0].xpub = 'replacement';
      finish();
      await expect(signing).rejects.toThrow(UTXO_SIGNING_CONTEXT_CHANGED);
      expect(keyring.syscoinTransaction.signPSBT).not.toHaveBeenCalled();
    }
  );

  it('rejects stale popup authorization before prevout I/O', async () => {
    const context = wallet.captureUtxoSigningContext().context;
    state.vault.activeAccount = { id: 1, type: KeyringAccountType.HDAccount };
    await expect(
      wallet.signSyscoinPsbt({ psbt: 'fixture', expectedContext: context })
    ).rejects.toThrow(UTXO_SIGNING_CONTEXT_CHANGED);
    expect(wallet.verifySyscoinPsbt).not.toHaveBeenCalled();
  });

  it('does not broadcast a signature returned after a context switch', async () => {
    keyring.syscoinTransaction.signPSBT.mockImplementation(async () => {
      state.vault.activeAccount = { id: 1, type: KeyringAccountType.HDAccount };
      return 'signed';
    });
    await expect(
      wallet.signSendAndSaveTransaction({ psbt: 'fixture' }, authorize)
    ).rejects.toMatchObject({
      message: UTXO_SIGNING_CONTEXT_CHANGED,
      transactionNotBroadcast: true,
    });
    expect(keyring.syscoinTransaction.sendTransaction).not.toHaveBeenCalled();
    expect(wallet.sendAndSaveTransaction).not.toHaveBeenCalled();
  });

  it('aborts the owned hardware transport as soon as the dapp approval closes', async () => {
    const approval = new AbortController();
    let enter!: (signal: AbortSignal) => void;
    let release!: () => void;
    const entered = new Promise<AbortSignal>((resolve) => (enter = resolve));
    const held = new Promise<void>((resolve) => (release = resolve));
    const sign = jest.fn();
    keyring.syscoinTransaction.signPSBT.mockImplementation(
      async (_psbt: unknown, read: { signal: AbortSignal }) => {
        enter(read.signal);
        await held;
        read.signal.throwIfAborted();
        return sign();
      }
    );
    const signing = wallet.signSyscoinPsbt(
      { psbt: 'external-sign-only' },
      { assertCurrent: () => undefined, signal: approval.signal }
    );
    const reached = await Promise.race([
      entered,
      signing.catch((error: unknown) => error),
    ]);
    approval.abort();
    release();
    await expect(signing).rejects.toThrow(UTXO_SIGNING_CONTEXT_CHANGED);
    expect(reached).toMatchObject({ aborted: true });
    expect(sign).not.toHaveBeenCalled();
  });

  it('classifies a signing rejection before the sender as safe to edit', async () => {
    keyring.syscoinTransaction.signPSBT.mockRejectedValueOnce(
      new Error('Device signing cancelled')
    );
    await expect(
      wallet.signSendAndSaveTransaction({ psbt: 'fixture' }, authorize)
    ).rejects.toMatchObject({
      message: 'Device signing cancelled',
      transactionNotBroadcast: true,
    });
    expect(keyring.syscoinTransaction.sendTransaction).not.toHaveBeenCalled();
  });

  it('rejects a real excessive-fee finalized PSBT without invoking the sender', async () => {
    const psbt = syntheticPsbt(BigInt(1130000));
    expect(() => psbt.extractTransaction()).toThrow('10272 satoshi per byte');
    (PsbtUtils.fromPali as jest.Mock).mockImplementation((value) =>
      value === 'signed' ? psbt : syntheticPsbt(BigInt(1000))
    );

    await expect(
      wallet.signSendAndSaveTransaction({ psbt: 'fixture' }, authorize)
    ).rejects.toMatchObject({
      code: 'UTXO_FEE_RATE_EXCEEDED',
      message:
        'Transaction fee exceeds the wallet safety limit. Lower the fee and try again.',
      transactionNotBroadcast: true,
    });
    expect(keyring.syscoinTransaction.sendTransaction).not.toHaveBeenCalled();
    expect(wallet.sendAndSaveTransaction).not.toHaveBeenCalled();
  });

  it('rejects a real unfinalized PSBT without invoking the sender', async () => {
    (PsbtUtils.fromPali as jest.Mock).mockImplementation((value) =>
      syntheticPsbt(BigInt(1000), value !== 'signed')
    );
    await expect(
      wallet.signSendAndSaveTransaction({ psbt: 'fixture' }, authorize)
    ).rejects.toMatchObject({
      message: 'Not finalized',
      transactionNotBroadcast: true,
    });
    expect(keyring.syscoinTransaction.sendTransaction).not.toHaveBeenCalled();
  });

  it('does not classify a sender timeout as safe even if its error carries an earlier safe marker', async () => {
    jest.mocked(globalThis.fetch).mockRejectedValueOnce(
      Object.assign(new Error('Network request timed out'), {
        transactionNotBroadcast: true,
      })
    );
    await expect(
      wallet.signSendAndSaveTransaction({ psbt: 'fixture' }, authorize)
    ).rejects.toMatchObject({
      message: 'Transaction submission could not be verified.',
      transactionNotBroadcast: false,
    });
    expect(keyring.syscoinTransaction.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('extracts an ordinary finalized PSBT with the fee guard before invoking the sender', async () => {
    const psbt = syntheticPsbt(BigInt(1000));
    const extract = jest.spyOn(psbt, 'extractTransaction');
    (PsbtUtils.fromPali as jest.Mock).mockImplementation((value) =>
      value === 'signed' ? psbt : syntheticPsbt(BigInt(1000))
    );
    keyring.syscoinTransaction.sendTransaction.mockImplementationOnce(
      async (...args: Parameters<typeof dispatch>) => {
        expect(extract).toHaveBeenCalledWith();
        return dispatch(...args);
      }
    );
    await expect(
      wallet.signSendAndSaveTransaction({ psbt: 'fixture' }, authorize)
    ).resolves.toEqual({ txid: defaultTxid });
    expect(keyring.syscoinTransaction.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('returns an acknowledged broadcast after context changes without filing it under another account', async () => {
    keyring.syscoinTransaction.sendTransaction.mockImplementation(
      async (...args: Parameters<typeof dispatch>) => {
        const result = await dispatch(...args);
        state.vault.activeAccount = {
          id: 1,
          type: KeyringAccountType.HDAccount,
        };
        return result;
      }
    );
    await expect(
      wallet.signSendAndSaveTransaction({ psbt: 'fixture' }, authorize)
    ).resolves.toEqual({ txid: defaultTxid });
    expect(wallet.sendAndSaveTransaction).not.toHaveBeenCalled();
  });

  it('serializes a concurrent reservation behind the final read and broadcast', async () => {
    const protectedOutput = {
      txid: '01'.repeat(32),
      vout: 0,
      proTxHash: '02'.repeat(32),
    };
    let finishRead!: () => void;
    let finalRead!: () => void;
    const reachedFinalRead = new Promise<void>((resolve) => {
      finalRead = resolve;
    });
    wallet.getProtectedSentryOutpoints
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockImplementationOnce(async () => {
        const staleSnapshot: unknown[] = [];
        finalRead();
        await new Promise<void>((resolve) => {
          finishRead = resolve;
        });
        return staleSnapshot;
      });
    const reservationScope = {
      walletIdentity: 'xpub-0',
      genesisHash: SENTRY_NETWORKS.mainnet.genesisHash,
    };
    const admission = await captureSentryCollateralAdmission(reservationScope);
    const write = jest.spyOn(chromeStorage, 'setItem');
    const sending = wallet.signSendAndSaveTransaction(
      { psbt: 'fixture' },
      authorize
    );
    await reachedFinalRead;
    const reserving = reserveSentryCollateral({
      ...reservationScope,
      admission,
      reservation: protectedOutput,
      assertCurrent: () => undefined,
    });
    const refused = expect(reserving).rejects.toThrow(
      'changed the Sentry approval'
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(write).not.toHaveBeenCalled();
    finishRead();
    await expect(sending).resolves.toEqual({ txid: defaultTxid });
    await refused;
    expect(keyring.syscoinTransaction.sendTransaction).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
  });

  it('serializes signed PSBT disclosure with a concurrent collateral reservation', async () => {
    jest.spyOn(chromeStorage, 'getItem').mockResolvedValue(undefined);
    state.vault.accounts.HDAccount[0].xpub = 'signature-release-first';
    const reservationScope = {
      walletIdentity: 'signature-release-first',
      genesisHash: SENTRY_NETWORKS.mainnet.genesisHash,
    };
    const admission = await captureSentryCollateralAdmission(reservationScope);
    let finishRead!: () => void;
    let reachedRead!: () => void;
    const finalRead = new Promise<void>((resolve) => {
      reachedRead = resolve;
    });
    wallet.getProtectedSentryOutpoints
      .mockResolvedValueOnce([])
      .mockImplementationOnce(async () => {
        reachedRead();
        await new Promise<void>((resolve) => {
          finishRead = resolve;
        });
        return [];
      });
    const write = jest
      .spyOn(chromeStorage, 'setItem')
      .mockResolvedValue(undefined);
    const signing = wallet.signSyscoinPsbt({ psbt: 'fixture' });
    await Promise.race([
      finalRead,
      signing.then(() => {
        throw new Error('Signature escaped before the final read');
      }),
    ]);
    const reserving = reserveSentryCollateral({
      ...reservationScope,
      admission,
      reservation: {
        txid: '01'.repeat(32),
        vout: 0,
        proTxHash: '03'.repeat(32),
      },
      assertCurrent: () => undefined,
    });
    const outcome = reserving.then(
      () => 'reserved',
      (error: Error) => error.message
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const writesBeforeDisclosure = write.mock.calls.length;
    finishRead();
    await expect(signing).resolves.toBe('signed');
    expect(await outcome).toContain('changed the Sentry approval');
    expect(writesBeforeDisclosure).toBe(0);
    expect(write).not.toHaveBeenCalled();
  });

  it('refuses signed PSBT disclosure when collateral was reserved while the signer ran', async () => {
    jest.spyOn(chromeStorage, 'getItem').mockResolvedValue(undefined);
    jest.spyOn(chromeStorage, 'setItem').mockResolvedValue(undefined);
    state.vault.accounts.HDAccount[0].xpub = 'signature-reservation-first';
    const reservationScope = {
      walletIdentity: 'signature-reservation-first',
      genesisHash: SENTRY_NETWORKS.mainnet.genesisHash,
    };
    const admission = await captureSentryCollateralAdmission(reservationScope);
    let finishSigning!: () => void;
    let signerStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      signerStarted = resolve;
    });
    keyring.syscoinTransaction.signPSBT.mockImplementation(async () => {
      signerStarted();
      await new Promise<void>((resolve) => {
        finishSigning = resolve;
      });
      return 'signed';
    });
    const signing = wallet.signSyscoinPsbt({ psbt: 'fixture' });
    const result = expect(signing).rejects.toThrow('protected Sentry');
    await Promise.race([
      started,
      signing.then(() => {
        throw new Error('Signature escaped before the signer barrier');
      }),
    ]);
    const reservation = {
      txid: '01'.repeat(32),
      vout: 0,
      proTxHash: '04'.repeat(32),
    };
    await reserveSentryCollateral({
      ...reservationScope,
      admission,
      reservation,
      assertCurrent: () => undefined,
    });
    wallet.getProtectedSentryOutpoints.mockResolvedValue([reservation]);
    finishSigning();
    await result;
    expect(
      (await captureSentryCollateralAdmission(reservationScope)).generation
    ).toBe(admission.generation);
  });

  it('does not release a signature or invalidate approvals when the final protection read fails', async () => {
    jest.spyOn(chromeStorage, 'getItem').mockResolvedValue(undefined);
    jest.spyOn(chromeStorage, 'setItem').mockResolvedValue(undefined);
    state.vault.accounts.HDAccount[0].xpub = 'signature-protection-read-failed';
    const reservationScope = {
      walletIdentity: 'signature-protection-read-failed',
      genesisHash: SENTRY_NETWORKS.mainnet.genesisHash,
    };
    const admission = await captureSentryCollateralAdmission(reservationScope);
    wallet.getProtectedSentryOutpoints
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('protection storage unavailable'));
    await expect(wallet.signSyscoinPsbt({ psbt: 'fixture' })).rejects.toThrow(
      'protection storage unavailable'
    );
    expect(
      (await captureSentryCollateralAdmission(reservationScope)).generation
    ).toBe(admission.generation);
    await expect(
      reserveSentryCollateral({
        ...reservationScope,
        admission,
        reservation: {
          txid: '01'.repeat(32),
          vout: 0,
          proTxHash: '05'.repeat(32),
        },
        assertCurrent: () => undefined,
      })
    ).resolves.toBeUndefined();
  });

  it('preserves broadcast acknowledgement when local history saving fails', async () => {
    wallet.sendAndSaveTransaction.mockRejectedValueOnce(
      new Error('storage unavailable')
    );
    await expect(
      wallet.signSendAndSaveTransaction({ psbt: 'fixture' }, authorize)
    ).resolves.toEqual({ txid: defaultTxid });
    expect(wallet.sendAndSaveTransaction).toHaveBeenCalledWith(
      { txid: defaultTxid },
      {
        id: 0,
        type: KeyringAccountType.HDAccount,
        address: 'account-0',
        xpub: 'xpub-0',
      },
      {
        localAcknowledgedInputs: {
          accountXpub: 'xpub-0',
          acknowledgedAt: expect.any(Number),
          networkUrl: 'https://rpc-a.invalid',
          outpoints: [`${'01'.repeat(32)}:0`],
        },
      }
    );
  });

  const retainAcknowledgedInput = () => {
    state.vault.accountTransactions.HDAccount[0].syscoin[57] = [
      {
        localAcknowledgedInputs: createUtxoAcknowledgedInputs(
          syntheticPsbt(BigInt(1000)).txInputs,
          { accountXpub: 'xpub-0', networkUrl: 'https://rpc-a.invalid' }
        ),
      },
    ];
  };

  it('does not present a stale ordinary estimate as another confirmation', async () => {
    retainAcknowledgedInput();
    await expect(
      wallet.getEstimateSysTransactionFee({ amount: '1' })
    ).rejects.toMatchObject({
      code: UTXO_NETWORK_CATCHING_UP,
      transactionNotBroadcast: true,
      message: expect.stringContaining('network is still updating'),
    });
    expect(
      keyring.syscoinTransaction.getEstimateSysTransactionFee
    ).toHaveBeenCalledTimes(1);
    expect(keyring.syscoinTransaction.signPSBT).not.toHaveBeenCalled();
    expect(keyring.syscoinTransaction.sendTransaction).not.toHaveBeenCalled();
  });

  it.each([
    'endpoint',
    'selection round trip',
    'wallet session',
    'fee',
    'unsigned hash',
    'missing proof',
  ])(
    'refuses a stale or substituted ordinary UTXO quote after %s before parse or signer entry',
    async (change) => {
      const quote = await wallet.getEstimateSysTransactionFee({ amount: '1' });
      expect(quote.utxoFeeReview.approvalTag).toMatch(/^[a-f0-9]{64}$/);
      let review = quote.utxoFeeReview;
      if (change === 'endpoint') {
        state.vault.activeNetwork.url = 'https://rpc-b.invalid';
        state.vaultGlobal.networks.syscoin[57].url =
          state.vault.activeNetwork.url;
      }
      if (change === 'selection round trip')
        wallet.networkRequestGeneration += 1;
      if (change === 'wallet session') wallet.walletSessionGeneration += 1;
      if (change === 'fee') review = { ...review, feeSatoshis: '999' };
      if (change === 'unsigned hash')
        review = { ...review, unsignedHash: '12'.repeat(32) };
      if (change === 'missing proof')
        review = createUtxoFeeReview(syntheticPsbt(BigInt(1000)), '1000');
      jest.mocked(PsbtUtils.fromPali).mockClear();
      wallet.verifySyscoinPsbt.mockClear();
      await expect(
        wallet.signSendAndSaveTransaction({
          psbt: quote.psbt,
          ordinaryWalletSend: true,
          utxoFeeReview: review,
        })
      ).rejects.toMatchObject({
        code: UTXO_SIGNING_CONTEXT_CHANGED,
        transactionNotBroadcast: true,
      });
      expect(PsbtUtils.fromPali).not.toHaveBeenCalled();
      expect(wallet.verifySyscoinPsbt).not.toHaveBeenCalled();
      expect(keyring.syscoinTransaction.signPSBT).not.toHaveBeenCalled();
      expect(keyring.syscoinTransaction.sendTransaction).not.toHaveBeenCalled();
    }
  );

  it.each([
    [57, 57, 'sys'],
    [0, 0, 'btc'],
    [2, 2, 'ltc'],
  ])(
    'sends the exact ordinary v0 quote through the captured endpoint for chain %i',
    async (chainId, slip44, currency) => {
      selectUtxoNetwork(chainId, slip44, currency);
      const quote = await wallet.getEstimateSysTransactionFee({ amount: '1' });
      await expect(
        wallet.signSendAndSaveTransaction({
          psbt: quote.psbt,
          ordinaryWalletSend: true,
          utxoFeeReview: quote.utxoFeeReview,
        })
      ).resolves.toEqual({ txid: defaultTxid });
      expect(keyring.syscoinTransaction.signPSBT).toHaveBeenCalledTimes(1);
      expect(keyring.syscoinTransaction.sendTransaction).toHaveBeenCalledTimes(
        1
      );
    }
  );

  it('rejects a substituted PSBT with a valid tag before its prevout reads', async () => {
    const quote = await wallet.getEstimateSysTransactionFee({ amount: '1' });
    (PsbtUtils.fromPali as jest.Mock).mockReturnValueOnce(
      syntheticPsbt(BigInt(1000), true, true)
    );
    wallet.verifySyscoinPsbt.mockClear();
    await expect(
      wallet.signSendAndSaveTransaction({
        psbt: 'substituted',
        ordinaryWalletSend: true,
        utxoFeeReview: quote.utxoFeeReview,
      })
    ).rejects.toMatchObject({
      code: 'UTXO_QUOTE_FEE_CHANGED',
      transactionNotBroadcast: true,
    });
    expect(wallet.verifySyscoinPsbt).not.toHaveBeenCalled();
    expect(keyring.syscoinTransaction.signPSBT).not.toHaveBeenCalled();
    expect(keyring.syscoinTransaction.sendTransaction).not.toHaveBeenCalled();
  });

  it('rejects stale ordinary Confirm before invoking any signer', async () => {
    retainAcknowledgedInput();
    await expect(
      wallet.signSendAndSaveTransaction({
        psbt: 'fixture',
        ordinaryWalletSend: true,
        utxoFeeReview: await reviewedFee(syntheticPsbt(BigInt(1000)), '1000'),
      })
    ).rejects.toMatchObject({
      code: UTXO_NETWORK_CATCHING_UP,
      transactionNotBroadcast: true,
    });
    expect(wallet.verifySyscoinPsbt).not.toHaveBeenCalled();
    expect(keyring.syscoinTransaction.signPSBT).not.toHaveBeenCalled();
    expect(keyring.syscoinTransaction.sendTransaction).not.toHaveBeenCalled();
  });

  it('also rejects a competing acknowledgement that arrives during signing', async () => {
    const psbt = syntheticPsbt(BigInt(1000));
    wallet.verifySyscoinPsbt.mockResolvedValue({
      psbt,
      summary: syntheticSummary(psbt),
    });
    keyring.syscoinTransaction.signPSBT.mockImplementationOnce(async () => {
      retainAcknowledgedInput();
      return 'signed';
    });
    await expect(
      wallet.signSendAndSaveTransaction({
        psbt: 'fixture',
        ordinaryWalletSend: true,
        utxoFeeReview: await reviewedFee(psbt, '1000'),
      })
    ).rejects.toMatchObject({
      code: UTXO_NETWORK_CATCHING_UP,
      transactionNotBroadcast: true,
    });
    expect(keyring.syscoinTransaction.signPSBT).toHaveBeenCalledTimes(1);
    expect(keyring.syscoinTransaction.sendTransaction).not.toHaveBeenCalled();
  });

  it('rejects a changed signed transaction even when its fee stayed the same', async () => {
    const psbt = syntheticPsbt(BigInt(1000));
    wallet.verifySyscoinPsbt.mockResolvedValue({
      psbt,
      summary: syntheticSummary(psbt),
    });
    (PsbtUtils.fromPali as jest.Mock).mockImplementation((value) =>
      value === 'signed' ? syntheticPsbt(BigInt(1000), true, true) : psbt
    );
    await expect(
      wallet.signSendAndSaveTransaction({
        psbt: 'fixture',
        ordinaryWalletSend: true,
        utxoFeeReview: await reviewedFee(psbt, '1000'),
      })
    ).rejects.toMatchObject({
      code: 'UTXO_QUOTE_FEE_CHANGED',
      transactionNotBroadcast: true,
    });
    expect(keyring.syscoinTransaction.signPSBT).toHaveBeenCalledTimes(1);
    expect(keyring.syscoinTransaction.sendTransaction).not.toHaveBeenCalled();
  });

  it('rejects altered final bytes even when the signed PSBT retains the attested hash and fee', async () => {
    const psbt = syntheticPsbt(BigInt(1000));
    const signed = syntheticPsbt(BigInt(1000));
    const altered = signed.extractTransaction().clone();
    altered.outs[0]!.value -= BigInt(1);
    jest.spyOn(signed, 'extractTransaction').mockReturnValue(altered);
    wallet.verifySyscoinPsbt.mockResolvedValue({
      psbt,
      summary: syntheticSummary(psbt),
    });
    (PsbtUtils.fromPali as jest.Mock).mockImplementation((value) =>
      value === 'signed' ? signed : psbt
    );
    await expect(
      wallet.signSendAndSaveTransaction({
        psbt: 'fixture',
        ordinaryWalletSend: true,
        utxoFeeReview: await reviewedFee(psbt, '1000'),
      })
    ).rejects.toMatchObject({
      code: 'UTXO_QUOTE_FEE_CHANGED',
      transactionNotBroadcast: true,
    });
    expect(keyring.syscoinTransaction.signPSBT).toHaveBeenCalledTimes(1);
    expect(keyring.syscoinTransaction.sendTransaction).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not apply the ordinary Send fence to externally approved RBF PSBTs', async () => {
    retainAcknowledgedInput();
    const replacement = syntheticPsbt(BigInt(2000), true, true);
    (PsbtUtils.fromPali as jest.Mock).mockImplementation(() => replacement);
    const expectedContext = wallet.captureUtxoSigningContext().context;
    await expect(
      wallet.signSendAndSaveTransaction(
        { psbt: 'replacement', expectedContext },
        authorize
      )
    ).resolves.toEqual({ txid: replacement.extractTransaction().getId() });
    expect(keyring.syscoinTransaction.signPSBT).toHaveBeenCalledTimes(1);
    expect(keyring.syscoinTransaction.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('does not change the externally approved sign-only PSBT path', async () => {
    retainAcknowledgedInput();
    await expect(
      wallet.signSyscoinPsbt({ psbt: 'external-sign-only' })
    ).resolves.toBe('signed');
    expect(keyring.syscoinTransaction.signPSBT).toHaveBeenCalledTimes(1);
    expect(keyring.syscoinTransaction.sendTransaction).not.toHaveBeenCalled();
  });

  it('keeps PoDA sign-only consent and refuses submission before requesting a signer', async () => {
    const psbt = syntheticPsbt(BigInt(1000), false);
    psbt.setVersion(137);
    wallet.verifySyscoinPsbt.mockResolvedValue({
      psbt,
      summary: syntheticSummary(psbt),
    });
    (PsbtUtils.fromPali as jest.Mock).mockReturnValue(psbt);
    await expect(
      wallet.signSendAndSaveTransaction({ psbt: 'poda' }, authorize)
    ).rejects.toMatchObject({
      message: 'This wallet can sign PoDA PSBTs for external submission',
      transactionNotBroadcast: true,
    });
    expect(keyring.syscoinTransaction.signPSBT).not.toHaveBeenCalled();
    await expect(
      wallet.signSyscoinPsbt({ psbt: 'poda' }, authorize)
    ).resolves.toBe('signed');
    expect(keyring.syscoinTransaction.signPSBT).toHaveBeenCalledTimes(1);
    expect(keyring.syscoinTransaction.sendTransaction).not.toHaveBeenCalled();
  });

  it('returns an ACK without saving old metadata into a replacement wallet session', async () => {
    keyring.syscoinTransaction.sendTransaction.mockImplementationOnce(
      async (...args: Parameters<typeof dispatch>) => {
        const result = await dispatch(...args);
        wallet.walletSessionGeneration += 1;
        state.vault.accounts.HDAccount[0] = {
          address: 'replacement-wallet',
          xpub: 'replacement-wallet-xpub',
        };
        return result;
      }
    );
    await expect(
      wallet.signSendAndSaveTransaction({ psbt: 'fixture' }, authorize)
    ).resolves.toEqual({ txid: defaultTxid });
    expect(wallet.sendAndSaveTransaction).not.toHaveBeenCalled();
  });
});
