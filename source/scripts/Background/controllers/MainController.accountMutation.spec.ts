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
let mockState: any;
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    dispatch: jest.fn((action) => {
      if (action.type === 'vault/createAccount') {
        const { account, accountType } = action.payload;
        mockState.vault.accounts[accountType][account.id] = account;
      }
    }),
    getState: () => mockState,
  },
  persistAccountCreation: jest.fn(async (account, type, assertCurrent) => {
    assertCurrent();
    mockState.vault.accounts[type][account.id] = account;
  }),
}));

import store, { persistAccountCreation } from 'state/store';
import { KeyringAccountType } from 'types/network';

import MainController from './MainController';

const flows: [string, any[], string, KeyringAccountType][] = [
  ['createAccount', ['account'], 'addNewAccount', KeyringAccountType.HDAccount],
  [
    'createAccount',
    ['smart', KeyringAccountType.SmartAccount],
    'createSmartAccount',
    KeyringAccountType.SmartAccount,
  ],
  [
    'createSmartAccount',
    [{ address: '0x-public-smart-address', metadata: {} }],
    'createSmartAccount',
    KeyringAccountType.SmartAccount,
  ],
  [
    'createSmartAccountRecord',
    [{ label: 'smart' }],
    'createSmartAccount',
    KeyringAccountType.SmartAccount,
  ],
  [
    'importAccountFromPrivateKey',
    ['synthetic-test-key'],
    'importAccount',
    KeyringAccountType.Imported,
  ],
  [
    'importWatchOnlyFromController',
    ['1BoatSLRHtKNngkdXEeobR76b53LETtpyT'],
    'importWatchOnly',
    KeyringAccountType.Imported,
  ],
  [
    'importTrezorAccountFromController',
    ['Trezor'],
    'importTrezorAccount',
    KeyringAccountType.Trezor,
  ],
  [
    'importLedgerAccountFromController',
    ['Ledger'],
    'importLedgerAccount',
    KeyringAccountType.Ledger,
  ],
];

describe('account mutation wallet setup reservation', () => {
  let wallet: any;
  let keyring: any;
  const account = { id: 1, address: 'public-address', xpub: 'public-xpub' };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockState = {
      vault: {
        accounts: {
          HDAccount: {},
          Imported: {},
          SmartAccount: {},
          Trezor: {},
          Ledger: {},
        },
      },
    };
    keyring = {
      addNewAccount: jest.fn(async () => account),
      createSmartAccount: jest.fn(async () => account),
      importAccount: jest.fn(async () => account),
      importWatchOnly: jest.fn(async () => account),
      importTrezorAccount: jest.fn(async () => account),
      importLedgerAccount: jest.fn(async () => account),
    };
    wallet = Object.create(MainController.prototype);
    wallet.walletSessionGeneration = 0;
    wallet.isCreatingWallet = false;
    wallet.isResettingWallet = false;
    wallet.recoveryJournalPending = false;
    wallet.getActiveKeyring = jest.fn(() => keyring);
    wallet.saveWalletState = jest.fn(async () => undefined);
    wallet.getLatestUpdateForCurrentAccount = jest.fn(async () => undefined);
    wallet.smartAccount = { deriveSmartAccountRecord: jest.fn() };
  });

  afterEach(() => jest.useRealTimers());

  it.each(flows)(
    'blocks %s during setup and permits normal mutation afterward',
    async (method, args, sdkMethod, accountType) => {
      wallet.isCreatingWallet = true;
      await expect(wallet[method](...args)).rejects.toThrow(
        'Wallet setup is in progress'
      );
      expect(wallet.getActiveKeyring).not.toHaveBeenCalled();
      expect(keyring[sdkMethod]).not.toHaveBeenCalled();
      expect(store.dispatch).not.toHaveBeenCalled();
      expect(persistAccountCreation).not.toHaveBeenCalled();
      wallet.isCreatingWallet = false;
      await expect(wallet[method](...args)).resolves.toEqual(account);
      expect(keyring[sdkMethod]).toHaveBeenCalledTimes(1);
      expect(persistAccountCreation).toHaveBeenCalledTimes(1);
      expect(persistAccountCreation).toHaveBeenCalledWith(
        account,
        accountType,
        expect.any(Function),
        expect.any(Function)
      );
      expect(wallet.saveWalletState).not.toHaveBeenCalled();
    }
  );

  it.each(flows)(
    'does not commit a late %s result into a new wallet session',
    async (method, args, sdkMethod) => {
      let resolve!: (value: typeof account) => void;
      keyring[sdkMethod].mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done;
          })
      );
      const pending = wallet[method](...args);
      const rejection = expect(pending).rejects.toThrow(
        'Wallet session changed'
      );
      wallet.walletSessionGeneration += 1;
      resolve(account);
      await rejection;
      expect(store.dispatch).not.toHaveBeenCalled();
      expect(persistAccountCreation).not.toHaveBeenCalled();
      expect(wallet.saveWalletState).not.toHaveBeenCalled();
    }
  );

  it('does not commit an old keyring result or a result that arrives during recovery reservation', async () => {
    for (const change of [
      () => {
        keyring = {};
      },
      () => {
        wallet.isCreatingWallet = true;
      },
    ]) {
      wallet.isCreatingWallet = false;
      const original = wallet.getActiveKeyring();
      original.importAccount = jest.fn();
      let resolve!: (value: typeof account) => void;
      original.importAccount.mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done;
          })
      );
      const pending = wallet.importAccountFromPrivateKey('synthetic-test-key');
      const rejection = expect(pending).rejects.toThrow();
      change();
      resolve(account);
      await rejection;
      expect(store.dispatch).not.toHaveBeenCalled();
      expect(persistAccountCreation).not.toHaveBeenCalled();
      expect(wallet.saveWalletState).not.toHaveBeenCalled();
    }
  });
});
