import { checkForUpdates } from './handlePaliUpdates';

const mockRefresh = jest.fn();
const mockSave = jest.fn();
const mockInvalid = jest.fn();
jest.mock('..', () => ({
  getController: () => ({
    wallet: { getLatestUpdateForCurrentAccount: mockRefresh },
  }),
}));
jest.mock('state/store', () => ({ saveMainState: () => mockSave() }));
jest.mock('scripts/Background/utils/isPollingRunNotValid', () => ({
  isPollingRunNotValid: () => mockInvalid(),
}));

const originalChrome = global.chrome;
let query: jest.Mock;
beforeEach(() => {
  query = jest.fn().mockResolvedValue([]);
  mockRefresh.mockReset().mockResolvedValue(undefined);
  mockSave.mockReset().mockResolvedValue(undefined);
  mockInvalid.mockReset().mockReturnValue(false);
  global.chrome = {
    runtime: { getURL: (path: string) => `chrome-extension://pali-id${path}` },
    tabs: { query },
  } as unknown as typeof chrome;
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  global.chrome = originalChrome;
  jest.restoreAllMocks();
});

it('refreshes and saves on every scheduled cycle despite an unrelated external-named HTTPS tab', async () => {
  query.mockResolvedValue([
    { url: 'chrome-extension://pali-id/app.html#/home' },
    { url: 'https://docs.example.test/external-api' },
  ]);
  for (let index = 0; index < 3; index++)
    await expect(checkForUpdates(true)).resolves.toBe(true);
  expect(query.mock.calls).toEqual([[{}], [{}], [{}]]);
  expect(mockRefresh.mock.calls).toEqual([
    [true, false, undefined],
    [true, false, undefined],
    [true, false, undefined],
  ]);
  expect(mockSave).toHaveBeenCalledTimes(3);
});

it('retains ordinary refresh flags and keeps refreshing after the unrelated tab closes', async () => {
  query.mockResolvedValueOnce([
    { url: 'https://docs.example.test/public-api' },
  ]);
  await expect(checkForUpdates(false, false)).resolves.toBe(true);
  query.mockResolvedValueOnce([
    { url: 'https://docs.example.test/external-api' },
  ]);
  await expect(checkForUpdates(true, true)).resolves.toBe(true);
  query.mockResolvedValueOnce([
    { url: 'chrome-extension://pali-id/app.html#/home' },
  ]);
  await expect(checkForUpdates(true, true)).resolves.toBe(true);
  expect(mockRefresh.mock.calls).toEqual([
    [false, false, false],
    [true, false, true],
    [true, false, true],
  ]);
  expect(mockSave).toHaveBeenCalledTimes(3);
});

it.each([
  'chrome-extension://pali-id/external.html',
  'chrome-extension://pali-id/external.html?mode=hardware#/connect',
  'chrome-extension://pali-id/external',
  'chrome-extension://pali-id/external/connect',
  'chrome-extension://pali-id/?externalRoute=connect',
])(
  'preserves intentional suppression for the owned external page %s',
  async (url) => {
    query.mockResolvedValue([{ url }]);
    await expect(checkForUpdates(true)).resolves.toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  }
);

it.each([
  'https://pali-id/external.html',
  'https://external.example.test/',
  'https://docs.example.test/?next=external.html',
  'chrome-extension://another-id/external.html',
  'chrome-extension://pali-id/app.html?externalRoute=connect',
  'chrome-extension://pali-id/external.html-other',
  'chrome-extension://pali-id/external-other/connect',
  'not-a-url-external',
  undefined,
])(
  'does not suppress for a foreign, lookalike or absent URL %s',
  async (url) => {
    query.mockResolvedValue([{ url }]);
    await expect(checkForUpdates(true)).resolves.toBe(true);
    expect(mockRefresh).toHaveBeenCalledWith(true, false, undefined);
    expect(mockSave).toHaveBeenCalledTimes(1);
  }
);

it('continues after a tab lookup error and stops an invalid polling run before lookup', async () => {
  query.mockRejectedValueOnce(Error('Synthetic tab query failure'));
  await expect(checkForUpdates(true)).resolves.toBe(true);
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  expect(mockSave).toHaveBeenCalledTimes(1);
  mockInvalid.mockReturnValueOnce(true);
  await expect(checkForUpdates(true)).resolves.toBe(true);
  expect(query).toHaveBeenCalledTimes(1);
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  expect(mockSave).toHaveBeenCalledTimes(1);
});

it('keeps the real mutex across refresh and save while preserving each queued call flags', async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  mockRefresh.mockImplementationOnce(() => pending);
  const first = checkForUpdates(true, false),
    second = checkForUpdates(false, true);
  await Promise.resolve();
  await Promise.resolve();
  expect(query).toHaveBeenCalledTimes(1);
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  expect(mockSave).not.toHaveBeenCalled();
  release();
  await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
  expect(mockRefresh.mock.calls).toEqual([
    [true, false, false],
    [false, false, true],
  ]);
  expect(mockSave).toHaveBeenCalledTimes(2);
});
