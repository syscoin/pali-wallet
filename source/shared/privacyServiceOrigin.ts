export const DEFAULT_PRIVACY_SERVICE_ORIGIN = 'https://sysnode.info';
export const PRIVACY_SERVICE_ORIGIN_STORAGE_KEY = 'privacy-service-origin-v1';

/** An origin only, with remote TLS and explicit local-development loopback. */
export function normalizePrivacyServiceOrigin(value: string): string {
  if (typeof value !== 'string')
    throw new Error('privacy_service_origin_invalid');
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

export type PrivacyServiceSettingsStorage = Readonly<{
  read(key: string): Promise<unknown>;
  write(key: string, origin: string): Promise<void>;
}>;

export type PrivacyServiceCapture = Readonly<{
  assertCurrent(): void;
  origin: string;
}>;

/** Settings ownership is local to the host that owns these storage ports. */
export function createPrivacyServiceSettings(
  storage: PrivacyServiceSettingsStorage
) {
  if (
    typeof storage?.read !== 'function' ||
    typeof storage?.write !== 'function'
  )
    throw new Error('privacy_service_storage_unavailable');
  let revision = 0;
  let changing = false;

  const getRevision = () => revision;
  const assertStable = (expected: number): void => {
    if (changing || revision !== expected)
      throw new Error('privacy_service_changed');
  };

  const getOrigin = async (): Promise<string> => {
    const expected = revision;
    assertStable(expected);
    const saved = await storage.read(PRIVACY_SERVICE_ORIGIN_STORAGE_KEY);
    assertStable(expected);
    return saved === undefined
      ? DEFAULT_PRIVACY_SERVICE_ORIGIN
      : normalizePrivacyServiceOrigin(saved as string);
  };

  const capture = async (): Promise<PrivacyServiceCapture> => {
    const expected = revision;
    assertStable(expected);
    const origin = await getOrigin();
    const assertCurrent = () => assertStable(expected);
    assertCurrent();
    return Object.freeze({ origin, assertCurrent });
  };

  /** Invalidate old public data and approvals before publishing a new origin. */
  const changeOrigin = async (
    value: string,
    invalidate: () => Promise<void>,
    expectedOrigin?: string
  ): Promise<string> => {
    const origin = normalizePrivacyServiceOrigin(value);
    const expected = revision;
    const current = await getOrigin();
    assertStable(expected);
    if (expectedOrigin !== undefined && current !== expectedOrigin)
      throw new Error('privacy_service_changed');
    if (current === origin) return origin;
    if (changing) throw new Error('privacy_service_changed');
    changing = true;
    revision += 1;
    try {
      await invalidate();
      await storage.write(PRIVACY_SERVICE_ORIGIN_STORAGE_KEY, origin);
      return origin;
    } finally {
      changing = false;
    }
  };

  return Object.freeze({
    getRevision,
    assertStable,
    getOrigin,
    changeOrigin,
    capture,
  });
}
