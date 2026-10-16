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
import { utils as syscoinUtils } from 'syscoinjs-lib';

import store from 'state/store';
import { INetworkType, KeyringAccountType } from 'types/network';
import { UTXO_SIGNING_CONTEXT_CHANGED } from 'utils/utxoSigningContext';

import MainController from './MainController';

// A structurally finalized public fixture, with dummy witness bytes only. No
// private key or cryptographic signature is generated, and no network is used.
const syntheticPsbt = (fee: bigint, finalized = true) => {
  const psbt = new syscoinUtils.bitcoinjs.Psbt();
  const script = Buffer.from('0014' + '00'.repeat(20), 'hex');
  psbt.addInput({
    hash: Buffer.alloc(32, 1),
    index: 0,
    witnessUtxo: { script, value: BigInt(10000000) },
  });
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
    (PsbtUtils.fromPali as jest.Mock).mockReset().mockImplementation(() => ({
      extractTransaction: jest.fn(() => ({})),
    }));
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
      }
    );
  });
});
