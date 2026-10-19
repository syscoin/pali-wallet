import { chromeStorage } from './storageAPI';

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

it.each([
  ['legacy-key', ['legacy-key']],
  [
    ['vault', 'profile'],
    ['vault', 'profile'],
  ],
])(
  'normalizes removal of %j to one native key batch',
  async (input, expected) => {
    const remove = jest
      .spyOn(chrome.storage.local, 'remove')
      .mockImplementation(((_keys: string[], callback: () => void) => {
        callback();
      }) as any);
    await chromeStorage.removeItem(input);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(expected, expect.any(Function));
  }
);
