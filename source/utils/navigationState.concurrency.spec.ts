import {
  clearNavigationState,
  loadNavigationState,
  saveNavigationState,
} from './navigationState';

const mockGet = jest.fn();
const mockSet = jest.fn();
const mockRemove = jest.fn();
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => ({
      vault: {},
      vaultGlobal: { advancedSettings: { autolock: 0 } },
    }),
  },
}));
jest.mock('./storageAPI', () => ({
  chromeStorage: {
    getItem: (...args: any[]) => mockGet(...args),
    setItem: (...args: any[]) => mockSet(...args),
    removeItem: (...args: any[]) => mockRemove(...args),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSet.mockResolvedValue(undefined);
  mockRemove.mockResolvedValue(undefined);
});

it('a delayed invalid read cannot delete a newer browsing snapshot', async () => {
  let resolve!: (value: any) => void;
  mockGet.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const oldRead = loadNavigationState();
  await saveNavigationState('/settings/about', 'support', { tab: 'support' });
  resolve({ version: 1, currentPath: '/settings/seed', timestamp: Date.now() });
  expect(await oldRead).toBeNull();
  expect(mockSet).toHaveBeenCalledTimes(1);
  expect(mockRemove).not.toHaveBeenCalled();
});

it('a delayed read cannot restore a record cleared after submission or lock', async () => {
  let resolve!: (value: any) => void;
  mockGet.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const oldRead = loadNavigationState();
  await clearNavigationState();
  resolve({ version: 2, currentPath: '/home', timestamp: Date.now() });
  expect(await oldRead).toBeNull();
  expect(mockRemove).toHaveBeenCalledTimes(1);
});
