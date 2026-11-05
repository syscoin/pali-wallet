/** Site permissions are keyed by the complete origin, never a bare hostname. */
export const getDappOrigin = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
};

export const MAX_DAPP_SITE_LOOKUP_LENGTH = 200;

/** Mark an overlong paste after reading it, without keeping its entire text. */
export const boundDappSiteLookupText = (value: string): string =>
  value.length > MAX_DAPP_SITE_LOOKUP_LENGTH
    ? `${value
        .slice(0, MAX_DAPP_SITE_LOOKUP_LENGTH)
        .replace(/[\ud800-\udbff]$/, '\ufffd')}…`
    : value;

/** Refuse overlong input before parsing; truncation could change its origin. */
export const getDappSiteLookupUrl = (input: string): string | null => {
  if (input.length > MAX_DAPP_SITE_LOOKUP_LENGTH) return null;
  const value = input.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  if (!value || /^[^/?#]*@/.test(value)) return null;
  return `https://${value}`;
};

/** Trust-list entries name exact HTTPS hosts, not substrings or subdomains. */
export const isTrustedDappOrigin = (
  url: string,
  hosts: readonly string[]
): boolean => {
  const origin = getDappOrigin(url);
  if (!origin) return false;
  const parsed = new URL(origin);
  return (
    parsed.protocol === 'https:' &&
    parsed.port === '' &&
    hosts.some((host) => parsed.hostname === host.toLowerCase())
  );
};
