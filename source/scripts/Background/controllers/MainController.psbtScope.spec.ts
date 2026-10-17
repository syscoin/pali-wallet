jest.unmock('syscoinjs-lib');

jest.mock('..', () => ({ getController: jest.fn() }));
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
import { webcrypto } from 'crypto';
import { utils as syscoinUtils } from 'syscoinjs-lib';

import store from 'state/store';
import { INetworkType, KeyringAccountType } from 'types/network';
import {
  captureSentryCollateralAdmission,
  reserveSentryCollateral,
} from 'utils/sentry/collateral';
import { SENTRY_NETWORKS } from 'utils/sentry/network';
import { chromeStorage } from 'utils/storageAPI';
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

describe('PSBT approval context', () => {
  let wallet: any;
  let state: any;
  let keyring: any;
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
          url: 'rpc-a',
        },
      },
      vaultGlobal: { activeSlip44: 57 },
    };
    jest.spyOn(store, 'getState').mockImplementation(() => state);
    keyring = {
      isUnlocked: jest.fn().mockReturnValue(true),
      syscoinTransaction: {
        getEstimateSysTransactionFee: jest
          .fn()
          .mockResolvedValue({ psbt: 'estimate-fixture', fee: 0.00001 }),
        signPSBT: jest.fn().mockResolvedValue('signed'),
        sendTransaction: jest.fn().mockResolvedValue({ txid: 'hash' }),
      },
    };
    wallet = Object.create(MainController.prototype);
    wallet.walletSessionGeneration = 0;
    wallet.getActiveKeyring = jest.fn(() => keyring);
    wallet.verifySyscoinPsbt = jest
      .fn()
      .mockResolvedValue({ psbt: 'verified-fixture' });
    wallet.sendAndSaveTransaction = jest.fn();
    wallet.getProtectedSentryOutpoints = jest.fn().mockResolvedValue([]);
    (PsbtUtils.fromPali as jest.Mock)
      .mockReset()
      .mockImplementation(() => syntheticPsbt(BigInt(1000)));
  });
  afterEach(() => jest.restoreAllMocks());

  it('signs an unchanged account after prevout verification', async () => {
    await expect(
      wallet.signSyscoinPsbt({ psbt: 'public-fixture' })
    ).resolves.toBe('signed');
    expect(wallet.verifySyscoinPsbt).toHaveBeenCalledTimes(1);
    expect(keyring.syscoinTransaction.signPSBT).toHaveBeenCalledTimes(1);
    expect(keyring.syscoinTransaction.signPSBT).toHaveBeenCalledWith({
      psbt: 'verified-fixture',
    });
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
    ).toHaveBeenCalledWith({
      amount: '1',
      excludedOutpoints: [reservation],
    });
  });

  it('keeps ordinary transactions on custom Syscoin networks working without Sentry support', async () => {
    wallet.getProtectedSentryOutpoints = (
      MainController.prototype as any
    ).getProtectedSentryOutpoints.bind(wallet);
    state.vault.activeNetwork.chainId = 98765;
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
          url: 'rpc-b',
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
      wallet.signSendAndSaveTransaction({ psbt: 'fixture' })
    ).rejects.toMatchObject({
      message: UTXO_SIGNING_CONTEXT_CHANGED,
      transactionNotBroadcast: true,
    });
    expect(keyring.syscoinTransaction.sendTransaction).not.toHaveBeenCalled();
    expect(wallet.sendAndSaveTransaction).not.toHaveBeenCalled();
  });

  it('classifies a signing rejection before the sender as safe to edit', async () => {
    keyring.syscoinTransaction.signPSBT.mockRejectedValueOnce(
      new Error('Device signing cancelled')
    );
    await expect(
      wallet.signSendAndSaveTransaction({ psbt: 'fixture' })
    ).rejects.toMatchObject({
      message: 'Device signing cancelled',
      transactionNotBroadcast: true,
    });
    expect(keyring.syscoinTransaction.sendTransaction).not.toHaveBeenCalled();
  });

  it('rejects a real excessive-fee finalized PSBT without invoking the sender', async () => {
    const psbt = syntheticPsbt(BigInt(1130000));
    expect(() => psbt.extractTransaction()).toThrow('10272 satoshi per byte');
    (PsbtUtils.fromPali as jest.Mock).mockReturnValueOnce(psbt);

    await expect(
      wallet.signSendAndSaveTransaction({ psbt: 'fixture' })
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
    (PsbtUtils.fromPali as jest.Mock).mockReturnValueOnce(
      syntheticPsbt(BigInt(1000), false)
    );
    await expect(
      wallet.signSendAndSaveTransaction({ psbt: 'fixture' })
    ).rejects.toMatchObject({
      message: 'Not finalized',
      transactionNotBroadcast: true,
    });
    expect(keyring.syscoinTransaction.sendTransaction).not.toHaveBeenCalled();
  });

  it('does not classify a sender timeout as safe even if its error carries an earlier safe marker', async () => {
    keyring.syscoinTransaction.sendTransaction.mockRejectedValueOnce(
      Object.assign(new Error('Network request timed out'), {
        transactionNotBroadcast: true,
      })
    );
    await expect(
      wallet.signSendAndSaveTransaction({ psbt: 'fixture' })
    ).rejects.toMatchObject({
      message: 'Network request timed out',
      transactionNotBroadcast: false,
    });
    expect(keyring.syscoinTransaction.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('extracts an ordinary finalized PSBT with the fee guard before invoking the sender', async () => {
    const psbt = syntheticPsbt(BigInt(1000));
    const extract = jest.spyOn(psbt, 'extractTransaction');
    (PsbtUtils.fromPali as jest.Mock).mockReturnValueOnce(psbt);
    keyring.syscoinTransaction.sendTransaction.mockImplementationOnce(
      async () => {
        expect(extract).toHaveBeenCalledWith();
        return { txid: 'hash' };
      }
    );
    await expect(
      wallet.signSendAndSaveTransaction({ psbt: 'fixture' })
    ).resolves.toEqual({ txid: 'hash' });
    expect(keyring.syscoinTransaction.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('returns an acknowledged broadcast after context changes without filing it under another account', async () => {
    keyring.syscoinTransaction.sendTransaction.mockImplementation(async () => {
      state.vault.activeAccount = { id: 1, type: KeyringAccountType.HDAccount };
      return { txid: 'acknowledged-hash' };
    });
    await expect(
      wallet.signSendAndSaveTransaction({ psbt: 'fixture' })
    ).resolves.toEqual({ txid: 'acknowledged-hash' });
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
    const sending = wallet.signSendAndSaveTransaction({ psbt: 'fixture' });
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
    await expect(sending).resolves.toEqual({ txid: 'hash' });
    await refused;
    expect(keyring.syscoinTransaction.sendTransaction).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
  });

  it('preserves broadcast acknowledgement when local history saving fails', async () => {
    wallet.sendAndSaveTransaction.mockRejectedValueOnce(
      new Error('storage unavailable')
    );
    await expect(
      wallet.signSendAndSaveTransaction({ psbt: 'fixture' })
    ).resolves.toEqual({ txid: 'hash' });
    expect(wallet.sendAndSaveTransaction).toHaveBeenCalledWith(
      { txid: 'hash' },
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
          networkUrl: 'rpc-a',
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
          { accountXpub: 'xpub-0', networkUrl: 'rpc-a' }
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

  it('rejects stale ordinary Confirm before invoking any signer', async () => {
    retainAcknowledgedInput();
    await expect(
      wallet.signSendAndSaveTransaction({
        psbt: 'fixture',
        ordinaryWalletSend: true,
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
    keyring.syscoinTransaction.signPSBT.mockImplementationOnce(async () => {
      retainAcknowledgedInput();
      return 'signed';
    });
    await expect(
      wallet.signSendAndSaveTransaction({
        psbt: 'fixture',
        ordinaryWalletSend: true,
      })
    ).rejects.toMatchObject({
      code: UTXO_NETWORK_CATCHING_UP,
      transactionNotBroadcast: true,
    });
    expect(keyring.syscoinTransaction.signPSBT).toHaveBeenCalledTimes(1);
    expect(keyring.syscoinTransaction.sendTransaction).not.toHaveBeenCalled();
  });

  it('does not apply the ordinary Send fence to externally approved RBF PSBTs', async () => {
    retainAcknowledgedInput();
    const replacement = syntheticPsbt(BigInt(2000), true, true);
    (PsbtUtils.fromPali as jest.Mock).mockImplementation(() => replacement);
    const expectedContext = wallet.captureUtxoSigningContext().context;
    await expect(
      wallet.signSendAndSaveTransaction({
        psbt: 'replacement',
        expectedContext,
      })
    ).resolves.toEqual({ txid: 'hash' });
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

  it('returns an ACK without saving old metadata into a replacement wallet session', async () => {
    keyring.syscoinTransaction.sendTransaction.mockImplementationOnce(
      async () => {
        wallet.walletSessionGeneration += 1;
        state.vault.accounts.HDAccount[0] = {
          address: 'replacement-wallet',
          xpub: 'replacement-wallet-xpub',
        };
        return { txid: 'acknowledged-before-reset' };
      }
    );
    await expect(
      wallet.signSendAndSaveTransaction({ psbt: 'fixture' })
    ).resolves.toEqual({ txid: 'acknowledged-before-reset' });
    expect(wallet.sendAndSaveTransaction).not.toHaveBeenCalled();
  });
});
