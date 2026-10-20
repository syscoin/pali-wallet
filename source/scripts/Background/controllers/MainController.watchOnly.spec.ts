jest.unmock('syscoinjs-lib');

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
jest.mock('state/store', () => ({
  __esModule: true,
  default: { dispatch: jest.fn(), getState: jest.fn() },
  persistAccountCreation: jest.fn(
    async (_account, _accountType, assertCurrent, isSameWallet) => {
      assertCurrent();
      if (!isSameWallet()) throw new Error('Wallet changed before import');
    }
  ),
}));

import store, { persistAccountCreation } from 'state/store';

import MainController from './MainController';

const WIF = 'L4rK1yDtCWekvXuE6oXD9jCYfFNV2cWRpVuPLBcCU2z8TrisoyY1';

describe('watch-only import public-material admission', () => {
  let wallet: any;
  let importWatchOnly: jest.Mock;
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (store.getState as jest.Mock).mockReturnValue({
      vault: { accounts: { Imported: {} } },
    });
    importWatchOnly = jest.fn(async () => ({
      id: 1,
      address: 'public-address',
    }));
    wallet = Object.create(MainController.prototype);
    wallet.accountMutationContext = jest.fn(() => ({
      keyring: { importWatchOnly },
      assertCurrent: jest.fn(),
    }));
    wallet.saveWalletState = jest.fn(async () => undefined);
    wallet.resetAutoLockTimer = jest.fn();
    wallet.getLatestUpdateForCurrentAccount = jest.fn(async () => undefined);
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it.each([
    ['private hex', `0x${'11'.repeat(32)}`],
    ['WIF', WIF],
    ['private descriptor', `sh(wpkh(${WIF}))`],
  ])(
    'rejects %s before invoking SDK/backend validation',
    async (_label, value) => {
      await expect(wallet.importWatchOnlyFromController(value)).rejects.toThrow(
        /public/i
      );
      expect(importWatchOnly).not.toHaveBeenCalled();
      expect(store.dispatch).not.toHaveBeenCalled();
      expect(wallet.saveWalletState).not.toHaveBeenCalled();
      expect(persistAccountCreation).not.toHaveBeenCalled();
    }
  );

  it('retains ordinary valid public address imports', async () => {
    const address = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
    await expect(
      wallet.importWatchOnlyFromController(address, 'Watch')
    ).resolves.toEqual({
      id: 1,
      address: 'public-address',
    });
    expect(importWatchOnly).toHaveBeenCalledWith(address, 'Watch');
    expect(persistAccountCreation).toHaveBeenCalledTimes(1);
    expect(persistAccountCreation).toHaveBeenCalledWith(
      { id: 1, address: 'public-address' },
      'Imported',
      expect.any(Function),
      expect.any(Function)
    );
    expect(wallet.saveWalletState).not.toHaveBeenCalled();
  });

  it('propagates a refused staged commit without reporting an accepted import', async () => {
    const failure = new Error('Synthetic watch import persistence refusal');
    jest.mocked(persistAccountCreation).mockRejectedValueOnce(failure);
    await expect(
      wallet.importWatchOnlyFromController(
        '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
        'Watch'
      )
    ).rejects.toBe(failure);
    expect(persistAccountCreation).toHaveBeenCalledTimes(1);
    expect(wallet.saveWalletState).not.toHaveBeenCalled();
    expect(wallet.getLatestUpdateForCurrentAccount).not.toHaveBeenCalled();
  });

  it('validates public text locally without invoking SDK, storage or network paths', () => {
    expect(
      wallet.validateWatchOnlyIdentifier('1BoatSLRHtKNngkdXEeobR76b53LETtpyT')
    ).toBe(true);
    expect(wallet.validateWatchOnlyIdentifier(WIF)).toBe(false);
    expect(importWatchOnly).not.toHaveBeenCalled();
    expect(wallet.accountMutationContext).not.toHaveBeenCalled();
    expect(store.dispatch).not.toHaveBeenCalled();
    expect(wallet.saveWalletState).not.toHaveBeenCalled();
    expect(persistAccountCreation).not.toHaveBeenCalled();
  });
});
