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
  chromeStorage: { getItems: jest.fn() },
}));

import { AsyncMutex } from 'utils/asyncMutex';
import { chromeStorage } from 'utils/storageAPI';

import MainController from './MainController';

describe('durable new-wallet admission', () => {
  let wallet: any;
  let records: Record<string, unknown>;
  beforeEach(() => {
    records = {};
    jest
      .mocked(chromeStorage.getItems)
      .mockReset()
      .mockImplementation(async (keys) =>
        Object.fromEntries(keys.map((key) => [key, records[key]]))
      );
    wallet = Object.create(MainController.prototype);
    wallet.walletStateGeneration = 0;
    wallet.authenticationMutex = new AsyncMutex();
    wallet.createWalletExclusive = jest.fn(async () => {
      records['sysweb3-vault'] = 'new-ciphertext';
      records['sysweb3-vault-keys'] = { salt: 'new-salt' };
    });
  });

  it('refuses a stale onboarding document after another creation completed', async () => {
    await wallet.createWallet('first password', 'first seed');
    const committed = JSON.stringify(records);
    await expect(
      wallet.createWallet('stale password', 'stale seed')
    ).rejects.toThrow('A wallet already exists');
    expect(wallet.createWalletExclusive).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(records)).toBe(committed);
    expect(wallet.isCreatingWallet).toBe(false);
  });

  it.each([
    {
      'sysweb3-vault': 'established ciphertext',
      'sysweb3-vault-keys': { salt: 'established salt' },
    },
    { 'sysweb3-vault': 'established ciphertext' },
    { 'sysweb3-vault-keys': { salt: 'established salt' } },
    { 'sysweb3-vault': '', 'sysweb3-vault-keys': false },
    { 'sysweb3-vault': 0 },
  ])('preserves existing or incomplete durable storage %p', async (stored) => {
    records = stored;
    const original = JSON.stringify(records);
    await expect(wallet.createWallet('password', 'seed')).rejects.toThrow(
      /already exists|storage is incomplete/
    );
    expect(wallet.createWalletExclusive).not.toHaveBeenCalled();
    expect(JSON.stringify(records)).toBe(original);
    expect(wallet.isCreatingWallet).toBe(false);
  });

  it('does not reset storage when checking its existence fails', async () => {
    jest
      .mocked(chromeStorage.getItems)
      .mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(wallet.createWallet('password', 'seed')).rejects.toThrow(
      'storage unavailable'
    );
    expect(wallet.createWalletExclusive).not.toHaveBeenCalled();
    expect(records).toEqual({});
    expect(wallet.isCreatingWallet).toBe(false);
  });

  it('reads durable state after waiting for earlier authentication', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const authentication = wallet.authenticationMutex.runExclusive(
      () => pending
    );
    const creation = wallet.createWallet('password', 'seed');
    const rejection = expect(creation).rejects.toThrow(
      'A wallet already exists'
    );
    records = {
      'sysweb3-vault': 'existing',
      'sysweb3-vault-keys': { salt: 'salt' },
    };
    release();
    await authentication;
    await rejection;
    expect(wallet.createWalletExclusive).not.toHaveBeenCalled();
  });

  it('permits intentional new setup after the existing wallet was explicitly removed', async () => {
    await wallet.createWallet('first password', 'first seed');
    records = {};
    await wallet.createWallet('new password', 'new seed');
    expect(wallet.createWalletExclusive).toHaveBeenCalledTimes(2);
  });
});
