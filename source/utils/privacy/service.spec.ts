import { chromeStorage } from 'utils/storageAPI';

import {
  assertPrivacyServiceStable,
  changePrivacyServiceOrigin,
  DEFAULT_PRIVACY_SERVICE_ORIGIN,
  getPrivacyServiceOrigin,
  normalizePrivacyServiceOrigin,
  privacyServiceRevision,
} from './service';

jest.mock('utils/storageAPI', () => ({
  chromeStorage: { getItems: jest.fn(), setItem: jest.fn() },
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(chromeStorage.getItems).mockResolvedValue({});
  jest.mocked(chromeStorage.setItem).mockResolvedValue();
});

it.each([
  'https://example.org',
  'https://example.org:8443/',
  'http://localhost:8800',
  'http://127.0.0.1:8800',
])('accepts a safe origin %s', (value) => {
  expect(normalizePrivacyServiceOrigin(value)).toBe(new URL(value).origin);
});

it.each([
  'http://example.org',
  'http://192.168.1.2:8800',
  'http://[::1]:8800',
  'https://a:b@example.org',
  'https://example.org/path',
  'https://example.org/?key=x',
  'https://example.org/#x',
  'javascript:alert(1)',
])('rejects an unsafe origin %s', (value) => {
  expect(() => normalizePrivacyServiceOrigin(value)).toThrow();
});

test('defaults to Sysnode and does not invalidate an unchanged origin', async () => {
  expect(await getPrivacyServiceOrigin()).toBe(DEFAULT_PRIVACY_SERVICE_ORIGIN);
  const invalidate = jest.fn();
  await expect(
    changePrivacyServiceOrigin('https://sysnode.info/', invalidate)
  ).resolves.toBe(DEFAULT_PRIVACY_SERVICE_ORIGIN);
  expect(invalidate).not.toHaveBeenCalled();
  expect(chromeStorage.setItem).not.toHaveBeenCalled();
});

test('revokes old service work before clearing and saving the new origin', async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const before = privacyServiceRevision();
  const operation = changePrivacyServiceOrigin(
    'http://127.0.0.1:8800',
    () => held
  );
  await Promise.resolve();
  await Promise.resolve();
  expect(() => assertPrivacyServiceStable(before)).toThrow(
    'privacy_service_changed'
  );
  await expect(getPrivacyServiceOrigin()).rejects.toThrow(
    'privacy_service_changed'
  );
  expect(chromeStorage.setItem).not.toHaveBeenCalled();
  release();
  await expect(operation).resolves.toBe('http://127.0.0.1:8800');
  expect(chromeStorage.setItem).toHaveBeenCalledWith(
    'privacy-service-origin-v1',
    'http://127.0.0.1:8800'
  );
  expect(() =>
    assertPrivacyServiceStable(privacyServiceRevision())
  ).not.toThrow();
});

test('failed invalidation does not publish a new service', async () => {
  await expect(
    changePrivacyServiceOrigin('https://new.example', async () => {
      throw new Error('storage');
    })
  ).rejects.toThrow('storage');
  expect(chromeStorage.setItem).not.toHaveBeenCalled();
  await expect(getPrivacyServiceOrigin()).resolves.toBe(
    DEFAULT_PRIVACY_SERVICE_ORIGIN
  );
});

test('corrupt persisted settings fail closed', async () => {
  jest.mocked(chromeStorage.getItems).mockResolvedValue({
    'privacy-service-origin-v1': 'http://untrusted.example',
  });
  await expect(getPrivacyServiceOrigin()).rejects.toThrow();
});
