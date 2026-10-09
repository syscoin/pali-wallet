import { chromeStorage } from 'utils/storageAPI';

import {
  loadPasskeyCredentialProfileState,
  loadSlip44State,
} from './paliStorage';

jest.mock('utils/storageAPI', () => ({
  chromeStorage: { getItem: jest.fn() },
}));

describe('persistent vault reads', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['vault', loadSlip44State, 'state-vault-60'],
    [
      'passkey profile',
      loadPasskeyCredentialProfileState,
      'state-vault-60-passkey-profile',
    ],
  ])(
    'distinguishes an absent %s from an unreadable one',
    async (_, load, key) => {
      jest.mocked(chromeStorage.getItem).mockResolvedValueOnce(null);
      await expect(load(60)).resolves.toBeNull();
      expect(chromeStorage.getItem).toHaveBeenLastCalledWith(key);

      const failure = new Error('Storage is unavailable');
      jest.mocked(chromeStorage.getItem).mockRejectedValueOnce(failure);
      await expect(load(60)).rejects.toBe(failure);
    }
  );

  it('returns the complete saved vault without replacing account data', async () => {
    const saved = {
      accounts: { HDAccount: { 4: { label: 'Saved account' } } },
    };
    jest.mocked(chromeStorage.getItem).mockResolvedValueOnce(saved);
    await expect(loadSlip44State(60)).resolves.toBe(saved);
  });
});
