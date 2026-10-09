jest.mock('utils/storageAPI', () => ({
  chromeStorage: { getItems: jest.fn() },
}));

import { chromeStorage } from 'utils/storageAPI';

import { readWalletPresence } from './readWalletPresence';

describe('wallet presence detection', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    [null, null, false],
    [undefined, undefined, false],
    ['encrypted vault', { salt: 'salt' }, true],
    ['', false, true],
    [0, '', true],
  ])('recognizes empty and complete storage', async (vault, keys, expected) => {
    (chromeStorage.getItems as jest.Mock).mockResolvedValueOnce({
      'sysweb3-vault': vault,
      'sysweb3-vault-keys': keys,
    });
    await expect(readWalletPresence()).resolves.toBe(expected);
  });

  it.each([
    ['encrypted vault', null],
    [null, { salt: 'salt' }],
    ['', null],
    [null, false],
  ])(
    'refuses to classify partial storage as a new wallet',
    async (vault, keys) => {
      (chromeStorage.getItems as jest.Mock).mockResolvedValueOnce({
        'sysweb3-vault': vault,
        'sysweb3-vault-keys': keys,
      });
      await expect(readWalletPresence()).rejects.toThrow(
        'storage is incomplete'
      );
    }
  );

  it('propagates a storage read failure', async () => {
    (chromeStorage.getItems as jest.Mock).mockRejectedValueOnce(
      new Error('read failed')
    );
    await expect(readWalletPresence()).rejects.toThrow('read failed');
  });
});
