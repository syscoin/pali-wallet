import { assetIconIdentityKey, trustedAssetIconUri, type AssetIconIdentity } from '../../../../source/shared/assetIconIdentity.ts';

const entries = new Map<string, { uri: string; failedUntil: number }>();
const listeners = new Map<string, Set<() => void>>();
const capacity = 64;
const failureCooldown = 300_000;

/** Token images belong to the same public registration as the observed market identity. */
export function nativeAssetIconKey(identity: AssetIconIdentity, registrationHash?: string): string | null {
  const key = assetIconIdentityKey(identity);
  return key && identity.kind === 'evm' && typeof registrationHash === 'string' && /^0x[0-9a-f]{64}$/i.test(registrationHash)
    ? `${key}:${registrationHash.toLowerCase()}` : null;
}
export function readNativeAssetIcon(key: string | null): string | null {
  const entry = key ? entries.get(key) : undefined;
  return entry && entry.failedUntil === 0 ? entry.uri : null;
}
export function subscribeNativeAssetIcon(key: string | null, listener: () => void): () => void {
  if (!key) return () => undefined;
  const group = listeners.get(key) ?? new Set<() => void>();
  group.add(listener); listeners.set(key, group);
  return () => { group.delete(listener); if (!group.size) listeners.delete(key); };
}

/** Called only after the existing market reader verifies platform and contract. No I/O. */
export function rememberNativeAssetIcon(identity: AssetIconIdentity, registrationHash: string, value: unknown, now = Date.now()): void {
  const key = nativeAssetIconKey(identity, registrationHash), uri = trustedAssetIconUri(value);
  if (!key || !uri) return;
  const previous = entries.get(key);
  if (previous?.uri === uri && (!previous.failedUntil || previous.failedUntil > now)) return;
  entries.delete(key); entries.set(key, { uri, failedUntil: 0 });
  const changed = [key];
  if (entries.size > capacity) {
    const oldest = entries.keys().next().value!;
    entries.delete(oldest); changed.push(oldest);
  }
  for (const item of changed) for (const listener of [...listeners.get(item) ?? []]) listener();
}

/** A failed URL stays quiet across remounts; a later metadata refresh may retry it. */
export function markNativeAssetIconFailed(key: string | null, uri: string, now = Date.now()): void {
  const entry = key ? entries.get(key) : undefined;
  if (!key || !entry || entry.uri !== uri || entry.failedUntil) return;
  entries.set(key, { uri, failedUntil: now + failureCooldown });
  for (const listener of [...listeners.get(key) ?? []]) listener();
}
