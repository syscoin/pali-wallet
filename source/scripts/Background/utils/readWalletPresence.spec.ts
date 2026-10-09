jest.mock('utils/storageAPI', () => ({
  chromeStorage: { getItem: jest.fn() },
}));

import { chromeStorage } from 'utils/storageAPI';

import { readWalletPresence } from './readWalletPresence';

describe('wallet presence detection', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    [null, null, false],
    ['encrypted vault', { salt: 'salt' }, true],
  ])('recognizes empty and complete storage', async (vault, keys, expected) => {
    (chromeStorage.getItem as jest.Mock)
      .mockResolvedValueOnce(vault)
      .mockResolvedValueOnce(keys);
    await expect(readWalletPresence()).resolves.toBe(expected);
  });

  it.each([
    ['encrypted vault', null],
    [null, { salt: 'salt' }],
  ])(
    'refuses to classify partial storage as a new wallet',
    async (vault, keys) => {
      (chromeStorage.getItem as jest.Mock)
        .mockResolvedValueOnce(vault)
        .mockResolvedValueOnce(keys);
      await expect(readWalletPresence()).rejects.toThrow(
        'storage is incomplete'
      );
    }
  );

  it('propagates a storage read failure', async () => {
    (chromeStorage.getItem as jest.Mock).mockRejectedValueOnce(
      new Error('read failed')
    );
    await expect(readWalletPresence()).rejects.toThrow('read failed');
  });
});
