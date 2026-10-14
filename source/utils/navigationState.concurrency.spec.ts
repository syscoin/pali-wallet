import {
  clearNavigationState,
  loadNavigationState,
  saveNavigationState,
} from './navigationState';

const mockGet = jest.fn();
const mockSet = jest.fn();
const mockRemove = jest.fn();
const originalLocks =
  typeof navigator === 'undefined'
    ? undefined
    : Object.getOwnPropertyDescriptor(navigator, 'locks');

beforeAll(() => {
  // These cases exercise the local generation guard on older runtimes.
  // Node 26 supplies real Web Locks; shared-lock behavior is covered separately
  // in navigationState.spec.ts and would serialize these delayed-read fixtures.
  if (typeof navigator !== 'undefined')
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: undefined,
    });
});

afterAll(() => {
  if (typeof navigator === 'undefined') return;
  if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks);
  else Reflect.deleteProperty(navigator, 'locks');
});

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
