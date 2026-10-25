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
import { INetworkType, KeyringAccountType } from 'types/network';

import MainController from './MainController';

const WIF = 'L4rK1yDtCWekvXuE6oXD9jCYfFNV2cWRpVuPLBcCU2z8TrisoyY1';
const EVM_ADDRESS = '0x52908400098527886E0F7030069857D2E4169EE7';

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

  const evmState = () => {
    const state = {
      vault: {
        isBitcoinBased: false,
        activeNetwork: {
          kind: INetworkType.Ethereum,
          slip44: 60,
          chainId: 5700,
          currency: 'tsys',
          label: 'EVM watch import',
          url: 'https://watch-import.synthetic.invalid',
        },
        accounts: Object.fromEntries(
          Object.values(KeyringAccountType).map((type) => [type, {}])
        ) as Record<string, Record<number, any>>,
      },
      vaultGlobal: { activeSlip44: 60 },
    };
    (store.getState as jest.Mock).mockReturnValue(state);
    return state;
  };

  it('creates a checksummed EVM watch record without asking a JSON-RPC endpoint for Blockbook', async () => {
    evmState();
    const account = await wallet.importWatchOnlyFromController(
      EVM_ADDRESS.toLowerCase(),
      'Public EVM'
    );
    expect(account).toMatchObject({
      id: 0,
      address: EVM_ADDRESS,
      xpub: EVM_ADDRESS,
      xprv: '',
      isImported: true,
      isLedgerWallet: false,
      isTrezorWallet: false,
      isSmartAccount: false,
      label: 'Public EVM',
    });
    expect(importWatchOnly).not.toHaveBeenCalled();
    expect(persistAccountCreation).toHaveBeenCalledWith(
      account,
      KeyringAccountType.Imported,
      expect.any(Function),
      expect.any(Function)
    );
  });

  it('allocates a free imported ID without replacing an occupied placeholder', async () => {
    const state = evmState();
    state.vault.accounts.Imported[0] = { id: 0, address: '', xpub: '' };
    state.vault.accounts.Imported[2] = {
      id: 2,
      address: 'other',
      xpub: 'other',
    };
    await expect(
      wallet.importWatchOnlyFromController(EVM_ADDRESS)
    ).resolves.toMatchObject({
      id: 1,
      label: 'Watch-only 2',
    });
    expect(state.vault.accounts.Imported[0]).toEqual({
      id: 0,
      address: '',
      xpub: '',
    });
  });

  it.each(Object.values(KeyringAccountType))(
    'refuses a case-only duplicate in the %s bucket',
    async (type) => {
      const state = evmState();
      state.vault.accounts[type][4] = { address: EVM_ADDRESS.toLowerCase() };
      await expect(
        wallet.importWatchOnlyFromController(EVM_ADDRESS)
      ).rejects.toThrow('Account already exists');
      expect(importWatchOnly).not.toHaveBeenCalled();
      expect(persistAccountCreation).not.toHaveBeenCalled();
    }
  );

  it.each([
    '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
    '0x52908400098527886E0F7030069857D2E4169Ee7',
  ])(
    'rejects non-EVM or invalid-checksum public input on EVM before persistence',
    async (identifier) => {
      evmState();
      await expect(
        wallet.importWatchOnlyFromController(identifier)
      ).rejects.toThrow();
      expect(importWatchOnly).not.toHaveBeenCalled();
      expect(persistAccountCreation).not.toHaveBeenCalled();
    }
  );

  it.each(['url', 'chainId', 'family', 'slip44', 'duplicate'] as const)(
    'rechecks %s before publishing a queued EVM import',
    async (change) => {
      const state = evmState();
      jest
        .mocked(persistAccountCreation)
        .mockImplementationOnce(async (_account, _type, assertCurrent) => {
          assertCurrent();
          if (change === 'url') state.vault.activeNetwork.url += '/changed';
          else if (change === 'chainId') state.vault.activeNetwork.chainId++;
          else if (change === 'family') state.vault.isBitcoinBased = true;
          else if (change === 'slip44') state.vaultGlobal.activeSlip44 = 1;
          else
            state.vault.accounts.HDAccount[8] = {
              address: EVM_ADDRESS.toLowerCase(),
            };
          assertCurrent();
        });
      await expect(
        wallet.importWatchOnlyFromController(EVM_ADDRESS)
      ).rejects.toThrow(
        change === 'duplicate' ? 'Account already exists' : 'Network changed'
      );
      expect(importWatchOnly).not.toHaveBeenCalled();
      expect(wallet.getLatestUpdateForCurrentAccount).not.toHaveBeenCalled();
    }
  );

  it('propagates EVM persistence refusal without reporting an accepted import or refreshing', async () => {
    evmState();
    jest
      .mocked(persistAccountCreation)
      .mockRejectedValueOnce(new Error('Synthetic EVM persistence refusal'));
    await expect(
      wallet.importWatchOnlyFromController(EVM_ADDRESS)
    ).rejects.toThrow('Synthetic EVM persistence refusal');
    expect(importWatchOnly).not.toHaveBeenCalled();
    expect(wallet.getLatestUpdateForCurrentAccount).not.toHaveBeenCalled();
  });

  it('retains the wallet lifetime guard inside the EVM durable admission', async () => {
    evmState();
    const assertCurrent = jest.fn();
    wallet.accountMutationContext.mockReturnValue({
      keyring: { importWatchOnly },
      assertCurrent,
    });
    jest
      .mocked(persistAccountCreation)
      .mockImplementationOnce(async (_account, _type, assertAdmission) => {
        assertAdmission();
        assertCurrent.mockImplementation(() => {
          throw new Error('Synthetic wallet session changed');
        });
        assertAdmission();
      });
    await expect(
      wallet.importWatchOnlyFromController(EVM_ADDRESS)
    ).rejects.toThrow('Synthetic wallet session changed');
    expect(importWatchOnly).not.toHaveBeenCalled();
    expect(wallet.getLatestUpdateForCurrentAccount).not.toHaveBeenCalled();
  });
});
