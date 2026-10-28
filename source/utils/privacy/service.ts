import { chromeStorage } from 'utils/storageAPI';

export const DEFAULT_PRIVACY_SERVICE_ORIGIN = 'https://sysnode.info';
const STORAGE_KEY = 'privacy-service-origin-v1';
let revision = 0;
let changing = false;

/** An origin only: no credentials, paths, query strings or remote cleartext. */
export function normalizePrivacyServiceOrigin(value: string): string {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  )
    throw new Error('privacy_service_origin_invalid');
  return url.origin;
}

export const privacyServiceRevision = () => revision;
export function assertPrivacyServiceStable(expected: number): void {
  if (changing || revision !== expected)
    throw new Error('privacy_service_changed');
}

export async function getPrivacyServiceOrigin(): Promise<string> {
  const expected = revision;
  assertPrivacyServiceStable(expected);
  const values = await chromeStorage.getItems([STORAGE_KEY]);
  assertPrivacyServiceStable(expected);
  const saved = values[STORAGE_KEY];
  return saved === undefined
    ? DEFAULT_PRIVACY_SERVICE_ORIGIN
    : normalizePrivacyServiceOrigin(saved as string);
}

/** Invalidate old public data and approvals before publishing a new origin. */
export async function changePrivacyServiceOrigin(
  value: string,
  invalidate: () => Promise<void>,
  expectedOrigin?: string
): Promise<string> {
  const origin = normalizePrivacyServiceOrigin(value);
  const current = await getPrivacyServiceOrigin();
  if (expectedOrigin !== undefined && current !== expectedOrigin)
    throw new Error('privacy_service_changed');
  if (current === origin) return origin;
  if (changing) throw new Error('privacy_service_changed');
  changing = true;
  revision += 1;
  try {
    await invalidate();
    await chromeStorage.setItem(STORAGE_KEY, origin);
    return origin;
  } finally {
    changing = false;
  }
}
