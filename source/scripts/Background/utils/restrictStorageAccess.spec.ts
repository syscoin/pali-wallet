import { restrictStorageAccess } from './restrictStorageAccess';

describe('wallet storage access', () => {
  const original = chrome.storage.local.setAccessLevel;

  afterEach(() => {
    chrome.storage.local.setAccessLevel = original;
  });

  it('restricts local storage to trusted extension contexts', async () => {
    const setAccessLevel = jest.fn().mockResolvedValue(undefined);
    chrome.storage.local.setAccessLevel = setAccessLevel;
    await restrictStorageAccess();
    expect(setAccessLevel).toHaveBeenCalledWith({
      accessLevel: 'TRUSTED_CONTEXTS',
    });
  });

  it('propagates failure so startup does not proceed with unprotected storage', async () => {
    chrome.storage.local.setAccessLevel = jest
      .fn()
      .mockRejectedValue(new Error('denied'));
    await expect(restrictStorageAccess()).rejects.toThrow('denied');
  });

  it('supports alternate browser builds without setAccessLevel', async () => {
    chrome.storage.local.setAccessLevel = undefined;
    await expect(restrictStorageAccess()).resolves.toBeUndefined();
  });
});
