import {
  abortable,
  boundedResponseText,
  cancelResponseBody,
  utf8ByteLength,
} from './boundedHttp.ts';

export const WALLET_RELEASE_FEED_URL =
  'https://raw.githubusercontent.com/syscoin/pali-wallet/master/releases/wallet-updates.json';
export const MAX_WALLET_RELEASE_FEED_BYTES = 32 * 1024;
export const MAX_WALLET_RELEASES = 24;
export type WalletReleasePlatform = 'chrome' | 'android' | 'ios';
export type WalletReleaseSeverity = 'routine' | 'important' | 'critical';
export type WalletReleaseIdentity = Readonly<{
  build?: number;
  platform: WalletReleasePlatform;
  version: string;
}>;
export type WalletRelease = Readonly<
  WalletReleaseIdentity & {
    availability: Readonly<{ status: 'published' }>;
    publishedAt: string;
    releaseNotesUrl: string;
    severity: WalletReleaseSeverity;
    summary: string;
    title: string;
  }
>;
export type WalletReleaseFeed = Readonly<{
  releases: readonly WalletRelease[];
  version: 1;
}>;
export type WalletReleaseFetch = (
  url: string,
  init: RequestInit
) => Promise<Response>;

function record(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = []
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const own = Object.getOwnPropertyDescriptors(value),
    keys = Reflect.ownKeys(own);
  if (
    required.some((key) => !Object.hasOwn(own, key)) ||
    keys.some(
      (key) =>
        typeof key !== 'string' ||
        ![...required, ...optional].includes(key) ||
        !('value' in own[key]!)
    )
  )
    return null;
  return Object.fromEntries(
    keys.map((key) => [key, own[key as string]!.value])
  );
}

function numericVersion(platform: unknown, version: unknown): number[] | null {
  if (
    typeof platform !== 'string' ||
    !['chrome', 'android', 'ios'].includes(platform) ||
    typeof version !== 'string' ||
    version.length > 31 ||
    !/^(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*)){0,3}$/.test(version)
  )
    return null;
  const parts = version.split('.').map(Number);
  if (
    parts.some(
      (part) =>
        !Number.isSafeInteger(part) ||
        part > (platform === 'chrome' ? 65535 : 999999)
    ) ||
    (platform === 'chrome' && parts.every((part) => part === 0)) ||
    (platform === 'ios' && parts.length !== 3)
  )
    return null;
  return parts;
}

export function isWalletReleaseIdentity(
  value: unknown
): value is WalletReleaseIdentity {
  try {
    const item = record(value, ['platform', 'version'], ['build']);
    if (!item || !numericVersion(item.platform, item.version)) return false;
    const build = item.build;
    return item.platform === 'chrome'
      ? !Object.hasOwn(item, 'build')
      : item.platform === 'android' || Object.hasOwn(item, 'build')
      ? Number.isSafeInteger(build) &&
        (build as number) > 0 &&
        (build as number) <= 2147483647
      : true;
  } catch {
    return false;
  }
}

function plainText(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= max &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069<>`]/.test(
      value
    ) &&
    !/(?:https?:\/\/|www\.|\[[^\]]*\]\s*\()/i.test(value) &&
    [...value].every((character) => {
      const code = character.codePointAt(0)!;
      return code < 0xd800 || code > 0xdfff;
    })
  );
}

function officialNotes(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length > 240 ||
    !/^https:\/\/github\.com\/syscoin\/pali-wallet\/releases\/tag\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(
      value
    )
  )
    return false;
  const url = new URL(value);
  return (
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.href === value
  );
}

function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number),
    right = b.split('.').map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

/** Admit only a bounded, data-only description of already-published store releases. */
export function parseWalletReleaseFeed(
  value: unknown
): WalletReleaseFeed | null {
  try {
    const feed = record(value, ['version', 'releases']);
    if (
      !feed ||
      feed.version !== 1 ||
      !Array.isArray(feed.releases) ||
      feed.releases.length > MAX_WALLET_RELEASES
    )
      return null;
    const entries = Object.getOwnPropertyDescriptors(feed.releases);
    if (Reflect.ownKeys(entries).length !== feed.releases.length + 1)
      return null;
    const releases: WalletRelease[] = [],
      seen = new Set<string>();
    for (let index = 0; index < feed.releases.length; index++) {
      const descriptor = entries[String(index)];
      if (!descriptor || !('value' in descriptor)) return null;
      const item = record(
        descriptor.value,
        [
          'platform',
          'version',
          'severity',
          'title',
          'summary',
          'publishedAt',
          'releaseNotesUrl',
          'availability',
        ],
        ['build']
      );
      if (!item) return null;
      const identity = {
        platform: item.platform,
        version: item.version,
        ...(Object.hasOwn(item, 'build') ? { build: item.build } : {}),
      };
      const availability = record(item.availability, ['status']);
      if (
        !isWalletReleaseIdentity(identity) ||
        typeof item.severity !== 'string' ||
        !['routine', 'important', 'critical'].includes(item.severity) ||
        !plainText(item.title, 80) ||
        !plainText(item.summary, 600) ||
        !officialNotes(item.releaseNotesUrl) ||
        typeof item.publishedAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(item.publishedAt) ||
        new Date(item.publishedAt).toISOString() !==
          item.publishedAt.replace('Z', '.000Z') ||
        availability?.status !== 'published'
      )
        return null;
      const normalized = numericVersion(item.platform, item.version)!;
      while (normalized.length > 1 && normalized.at(-1) === 0) normalized.pop();
      const key = `${item.platform}:${normalized.join('.')}:${
        item.build ?? ''
      }`;
      if (seen.has(key)) return null;
      seen.add(key);
      releases.push(
        Object.freeze({
          ...identity,
          severity: item.severity as WalletReleaseSeverity,
          title: item.title,
          summary: item.summary,
          publishedAt: item.publishedAt,
          releaseNotesUrl: item.releaseNotesUrl,
          availability: Object.freeze({ status: 'published' as const }),
        } as WalletRelease)
      );
    }
    return Object.freeze({ version: 1, releases: Object.freeze(releases) });
  } catch {
    return null;
  }
}

export function parseWalletReleaseFeedText(
  value: string
): WalletReleaseFeed | null {
  if (
    typeof value !== 'string' ||
    value.length > MAX_WALLET_RELEASE_FEED_BYTES ||
    utf8ByteLength(value) > MAX_WALLET_RELEASE_FEED_BYTES
  )
    return null;
  try {
    return parseWalletReleaseFeed(JSON.parse(value));
  } catch {
    return null;
  }
}

/** Read metadata only. Hosts choose when to check and supply their own cancellation/timeout. */
export async function readWalletReleaseFeed(
  fetcher: WalletReleaseFetch,
  signal: AbortSignal
): Promise<WalletReleaseFeed | null> {
  try {
    if (signal.aborted) return null;
    const pending = Promise.resolve(
      fetcher(WALLET_RELEASE_FEED_URL, {
        method: 'GET',
        signal,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })
    );
    // Some native hosts ignore fetch cancellation. End this check immediately
    // and release any response body that arrives after its owner has aborted.
    void pending.then(
      (response) => {
        if (signal.aborted) cancelResponseBody(response);
      },
      () => undefined
    );
    const response = await abortable(pending, signal);
    if (
      signal.aborted ||
      !response.ok ||
      response.redirected ||
      (response.url && response.url !== WALLET_RELEASE_FEED_URL)
    ) {
      cancelResponseBody(response);
      return null;
    }
    const text = await boundedResponseText(
      response,
      signal,
      MAX_WALLET_RELEASE_FEED_BYTES
    );
    return signal.aborted ? null : parseWalletReleaseFeedText(text);
  } catch {
    return null;
  }
}

/** Keep the newest target and the highest urgency of fixes this installation lacks. */
export function selectWalletRelease(
  feed: WalletReleaseFeed,
  current: WalletReleaseIdentity,
  now = Date.now()
): WalletRelease | null {
  const admitted = parseWalletReleaseFeed(feed);
  if (
    !admitted ||
    !isWalletReleaseIdentity(current) ||
    !Number.isFinite(now) ||
    now < 0
  )
    return null;
  let selected: WalletRelease | null = null;
  let severity: WalletReleaseSeverity = 'routine';
  for (const release of admitted.releases) {
    if (
      release.platform !== current.platform ||
      Date.parse(release.publishedAt) > now
    )
      continue;
    const version = compareVersions(release.version, current.version);
    if (
      version < 0 ||
      (release.platform === 'android'
        ? release.build! <= current.build!
        : version === 0 &&
          !(
            release.build !== undefined &&
            current.build !== undefined &&
            release.build > current.build
          ))
    )
      continue;
    if (
      release.severity === 'critical' ||
      (release.severity === 'important' && severity === 'routine')
    )
      severity = release.severity;
    if (
      !selected ||
      (release.platform === 'android'
        ? release.build! - selected.build!
        : compareVersions(release.version, selected.version) ||
          (release.build ?? 0) - (selected.build ?? 0)) > 0
    )
      selected = release;
  }
  // Later routine releases include earlier fixes. Do not lose their urgency,
  // or keep warning once the installed version/build already contains them.
  return selected && selected.severity !== severity
    ? Object.freeze({ ...selected, severity })
    : selected;
}
