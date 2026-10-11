jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('./walletRecovery', () => ({
  prepareWalletRecoveryAccess: jest.fn(),
}));

import { AsyncMutex } from 'utils/asyncMutex';

import MainController from './MainController';
import { prepareWalletRecoveryAccess } from './walletRecovery';

describe('same-worker recovery access boundaries', () => {
  let wallet: any;
  let keyring: any;
  const context = {};

  beforeEach(() => {
    jest.clearAllMocks();
    keyring = {
      isUnlocked: jest.fn(() => true),
      unlock: jest.fn(async () => ({ canLogin: true })),
    };
    wallet = Object.create(MainController.prototype);
    wallet.walletSessionGeneration = 0;
    wallet.walletStateGeneration = 0;
    wallet.recoveryJournalPending = true;
    wallet.authenticationMutex = new AsyncMutex();
    wallet.getActiveKeyring = () => keyring;
    wallet.walletRecoveryContext = () => context;
    wallet.checkRateLimit = jest.fn(async () => 0);
    wallet.resetRateLimit = jest.fn(async () => undefined);
    wallet.forgetMainWallet = jest.fn();
    jest.mocked(prepareWalletRecoveryAccess).mockReset();
  });

  it.each(['unlock', 'unlockFromController', 'forgetWallet'])(
    'rejects %s before authentication/deletion while recovery cannot be reconciled',
    async (method) => {
      jest
        .mocked(prepareWalletRecoveryAccess)
        .mockRejectedValue(
          new Error('Reload the extension to finish wallet recovery')
        );
      const errors = jest.spyOn(console, 'error').mockImplementation();
      try {
        await expect(wallet[method]('password')).rejects.toThrow(
          'wallet recovery'
        );
        expect(keyring.unlock).not.toHaveBeenCalled();
        expect(wallet.forgetMainWallet).not.toHaveBeenCalled();
        expect(prepareWalletRecoveryAccess).toHaveBeenCalledWith(
          wallet,
          context
        );
      } finally {
        errors.mockRestore();
      }
    }
  );

  it('avoids recovery I/O for normal unlock and permits retry only after cleanup succeeds', async () => {
    wallet.recoveryJournalPending = false;
    await expect(wallet.unlock('password')).resolves.toEqual({
      canLogin: true,
    });
    expect(prepareWalletRecoveryAccess).not.toHaveBeenCalled();
    wallet.recoveryJournalPending = true;
    jest.mocked(prepareWalletRecoveryAccess).mockImplementation(async () => {
      wallet.recoveryJournalPending = false;
    });
    await expect(wallet.unlock('password')).resolves.toEqual({
      canLogin: true,
    });
    expect(prepareWalletRecoveryAccess).toHaveBeenCalledTimes(1);
    expect(keyring.unlock).toHaveBeenCalledTimes(2);
  });
});
