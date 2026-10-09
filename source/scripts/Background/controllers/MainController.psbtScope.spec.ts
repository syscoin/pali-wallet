jest.mock('..', () => ({ getController: jest.fn() }));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: { toPali: (psbt: unknown) => psbt },
}));
jest.mock('utils/navigationState', () => ({
  clearNavigationState: jest.fn().mockResolvedValue(undefined),
}));

import store from 'state/store';
import { INetworkType, KeyringAccountType } from 'types/network';
import { UTXO_SIGNING_CONTEXT_CHANGED } from 'utils/utxoSigningContext';

import MainController from './MainController';

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
    ).rejects.toThrow(UTXO_SIGNING_CONTEXT_CHANGED);
    expect(keyring.syscoinTransaction.sendTransaction).not.toHaveBeenCalled();
    expect(wallet.sendAndSaveTransaction).not.toHaveBeenCalled();
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
