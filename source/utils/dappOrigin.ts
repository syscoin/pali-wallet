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

/** Trust-list entries name exact HTTPS hosts, not substrings or subdomains. */
export const isTrustedDappOrigin = (url: string, hosts: string[]): boolean => {
  const origin = getDappOrigin(url);
  if (!origin) return false;
  const parsed = new URL(origin);
  return (
    parsed.protocol === 'https:' &&
    parsed.port === '' &&
    hosts.some((host) => parsed.hostname === host.toLowerCase())
  );
};
