import { fetchPrivacySnapshot } from 'utils/privacy/client';
import { chromeStorage } from 'utils/storageAPI';

import {
  createPrivacySettings,
  fetchConfiguredPrivacySnapshot,
} from './privacySettings';

jest.mock('utils/storageAPI', () => ({
  chromeStorage: { getItems: jest.fn(), setItem: jest.fn() },
}));
jest.mock('utils/privacy/client', () => ({ fetchPrivacySnapshot: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(chromeStorage.getItems).mockResolvedValue({});
  jest.mocked(chromeStorage.setItem).mockResolvedValue();
});

test('a configured service is used for pool reads without changing the Ethereum RPC', async () => {
  jest.mocked(chromeStorage.getItems).mockResolvedValue({
    'privacy-service-origin-v1': 'http://localhost:8800',
  });
  jest.mocked(fetchPrivacySnapshot).mockResolvedValue({
    phase: 'syncing',
    scannedBlock: 1,
    startBlock: 1,
    targetBlock: 1,
  });
  const signal = new AbortController().signal;
  await fetchConfiguredPrivacySnapshot('eth-1', signal);
  expect(fetchPrivacySnapshot).toHaveBeenCalledWith(
    'eth-1',
    signal,
    'http://localhost:8800'
  );
});

test('a pool response from an old service is refused after the service changes', async () => {
  let finish!: (value: any) => void;
  jest.mocked(fetchPrivacySnapshot).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const pending = fetchConfiguredPrivacySnapshot(
    'eth-1',
    new AbortController().signal
  );
  await Promise.resolve();
  await Promise.resolve();
  await createPrivacySettings(
    { clear: jest.fn(async () => ({} as any)) },
    async () => undefined
  ).setServiceOrigin('http://localhost:8800', 'https://sysnode.info');
  finish({ phase: 'syncing', scannedBlock: 1, startBlock: 1, targetBlock: 1 });
  await expect(pending).rejects.toThrow('privacy_service_changed');
});

test('switching services clears every public pool and cancels withdrawal reviews before saving', async () => {
  const events: string[] = [];
  const clear = jest.fn(async (pool: string) => {
    events.push(pool);
    return {} as any;
  });
  const invalidate = jest.fn(async () => {
    events.push('withdrawals');
  });
  jest.mocked(chromeStorage.setItem).mockImplementation(async () => {
    events.push('saved');
  });
  const settings = createPrivacySettings({ clear }, invalidate);
  await expect(
    settings.setServiceOrigin('http://localhost:8800', 'https://sysnode.info')
  ).resolves.toBe('http://localhost:8800');
  expect(clear.mock.calls.map(([pool]) => pool).sort()).toEqual([
    'eth-0.1',
    'eth-1',
    'eth-10',
    'eth-100',
  ]);
  expect(invalidate).toHaveBeenCalledTimes(1);
  expect(events[events.length - 1]).toBe('saved');
});

test('a failed pool invalidation prevents switching and waits for other invalidations', async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const clear = jest.fn(async (pool: string) => {
    if (pool === 'eth-1') throw new Error('storage');
    if (pool === 'eth-100') await held;
    return {} as any;
  });
  const settings = createPrivacySettings({ clear }, async () => undefined);
  const pending = settings.setServiceOrigin(
    'https://self-hosted.example',
    'https://sysnode.info'
  );
  await Promise.resolve();
  await Promise.resolve();
  expect(chromeStorage.setItem).not.toHaveBeenCalled();
  release();
  await expect(pending).rejects.toThrow('privacy_service_update_failed');
  expect(chromeStorage.setItem).not.toHaveBeenCalled();
});

test('a stale settings window cannot overwrite another window’s service choice', async () => {
  jest.mocked(chromeStorage.getItems).mockResolvedValue({
    'privacy-service-origin-v1': 'http://localhost:3477',
  });
  const clear = jest.fn(async () => ({} as any));
  const invalidate = jest.fn(async () => undefined);
  const settings = createPrivacySettings({ clear }, invalidate);
  await expect(
    settings.setServiceOrigin('https://other.example', 'https://sysnode.info')
  ).rejects.toThrow('privacy_service_changed');
  expect(clear).not.toHaveBeenCalled();
  expect(invalidate).not.toHaveBeenCalled();
  expect(chromeStorage.setItem).not.toHaveBeenCalled();
});
