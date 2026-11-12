/** Public build and installation identities; release metadata cannot replace these. */
export const CANARY_BASE_VERSION = '5.0.0';
export const STABLE_EXTENSION_ID = 'mgffkfbidihjpoaomajlbgchddlicgpn';
// The local packaging key identifies Canary, but does not establish a store listing.
export const CANARY_EXTENSION_ID = 'eaapkkbcdfhchkhgkmgimhihepifmehi';
export const CANARY_STORE_EXTENSION_ID: string | null = null;
export const CHROME_STORE_UPDATE_URL =
  'https://clients2.google.com/service/update2/crx';
export const STABLE_EXTENSION_FEED_URL =
  'https://raw.githubusercontent.com/syscoin/pali-wallet/master/releases/wallet-updates.json';
export const CANARY_EXTENSION_FEED_URL =
  'https://raw.githubusercontent.com/syscoin/pali-wallet/master/releases/wallet-updates-canary.json';
export const STABLE_EXTENSION_STORE_URL = `https://chromewebstore.google.com/detail/pali-wallet/${STABLE_EXTENSION_ID}`;
export const CANARY_EXTENSION_STORE_URL: string | null =
  CANARY_STORE_EXTENSION_ID === null
    ? null
    : `https://chromewebstore.google.com/detail/pali-wallet-canary/${CANARY_STORE_EXTENSION_ID}`;

export type ExtensionReleaseChannel = 'stable' | 'canary';
export type ExtensionReleaseTarget = Readonly<{
  channel: ExtensionReleaseChannel;
  feedUrl: string;
  storeUrl: string | null;
}>;

const targets: Readonly<
  Record<ExtensionReleaseChannel, ExtensionReleaseTarget>
> = Object.freeze({
  stable: Object.freeze({
    channel: 'stable',
    feedUrl: STABLE_EXTENSION_FEED_URL,
    storeUrl: STABLE_EXTENSION_STORE_URL,
  }),
  canary: Object.freeze({
    channel: 'canary',
    feedUrl: CANARY_EXTENSION_FEED_URL,
    storeUrl: CANARY_EXTENSION_STORE_URL,
  }),
});

export function getExtensionReleaseTarget(
  id: unknown
): ExtensionReleaseTarget | null {
  return id === STABLE_EXTENSION_ID
    ? targets.stable
    : CANARY_STORE_EXTENSION_ID !== null && id === CANARY_STORE_EXTENSION_ID
    ? targets.canary
    : null;
}

/** getSelf distinguishes an actual installed package from an unpacked copy with the same key. */
export function admitExtensionReleaseTarget(
  runtimeId: unknown,
  manifest: Readonly<{ update_url?: unknown; version?: unknown }>,
  info: unknown
): ExtensionReleaseTarget | null {
  const target = getExtensionReleaseTarget(runtimeId);
  if (!target || !info || typeof info !== 'object') return null;
  const installed = info as Record<string, unknown>;
  return installed.id === runtimeId &&
    installed.type === 'extension' &&
    installed.enabled === true &&
    installed.installType === 'normal' &&
    installed.updateUrl === CHROME_STORE_UPDATE_URL &&
    typeof manifest.version === 'string' &&
    installed.version === manifest.version &&
    (manifest.update_url === undefined ||
      manifest.update_url === CHROME_STORE_UPDATE_URL)
    ? target
    : null;
}
