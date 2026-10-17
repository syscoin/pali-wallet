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
}));

import store from 'state/store';

import MainController from './MainController';

const WIF = 'L4rK1yDtCWekvXuE6oXD9jCYfFNV2cWRpVuPLBcCU2z8TrisoyY1';

describe('watch-only import public-material admission', () => {
  let wallet: any;
  let importWatchOnly: jest.Mock;
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
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
    expect(wallet.saveWalletState).toHaveBeenCalledTimes(1);
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
  });
});
