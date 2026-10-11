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
jest.mock('utils/storageAPI', () => ({
  chromeStorage: { getItem: jest.fn(), setItem: jest.fn() },
}));

import { walletPersistenceGate } from 'state/paliStorage';
import { chromeStorage } from 'utils/storageAPI';

import MainController from './MainController';

describe('startup main-state cleanup persistence ownership', () => {
  let wallet: any;
  const original = {
    vault: { accounts: { Imported: { 7: { xprv: 'synthetic ciphertext' } } } },
    vaultGlobal: { activeSlip44: 57 },
  };

  beforeEach(() => {
    walletPersistenceGate.blocked = false;
    wallet = Object.create(MainController.prototype);
    wallet.walletStateGeneration = 0;
    jest.mocked(chromeStorage.getItem).mockReset().mockResolvedValue(original);
    jest.mocked(chromeStorage.setItem).mockReset().mockResolvedValue(undefined);
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    walletPersistenceGate.blocked = false;
    jest.restoreAllMocks();
  });

  it('preserves the ordinary cleanup of legacy inline vault copies', async () => {
    await expect(wallet.cleanupMainStateVault()).resolves.toBe(true);
    expect(chromeStorage.setItem).toHaveBeenCalledWith('state', {
      vaultGlobal: original.vaultGlobal,
    });
    expect(original.vault.accounts.Imported[7].xprv).toBe(
      'synthetic ciphertext'
    );
  });

  it('does not read or write while recovery restoration owns persistence', async () => {
    walletPersistenceGate.blocked = true;
    await expect(wallet.cleanupMainStateVault()).resolves.toBe(false);
    expect(chromeStorage.getItem).not.toHaveBeenCalled();
    expect(chromeStorage.setItem).not.toHaveBeenCalled();
  });

  it.each(['pending restoration', 'later wallet generation'])(
    'does not publish a delayed cleanup read after %s',
    async (change) => {
      let finish!: (value: any) => void;
      let started!: () => void;
      const reading = new Promise<void>((resolve) => {
        started = resolve;
      });
      jest.mocked(chromeStorage.getItem).mockImplementationOnce(() => {
        started();
        return new Promise((resolve) => {
          finish = resolve;
        });
      });
      const cleanup = wallet.cleanupMainStateVault();
      await reading;
      if (change === 'pending restoration')
        walletPersistenceGate.blocked = true;
      else wallet.walletStateGeneration += 1;
      finish(original);
      await expect(cleanup).resolves.toBe(false);
      expect(chromeStorage.setItem).not.toHaveBeenCalled();
    }
  );
});
