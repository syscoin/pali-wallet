const isCanary = process.env.PALI_EXTENSION_CHANNEL === 'canary';
const prefix = isCanary ? 'pali-canary:' : '';

/** Keep the released stable page protocol unchanged; Canary uses its own channel. */
export const providerEventName = (name: string): string => `${prefix}${name}`;
export const providerResponseEvent = (id: string): string =>
  isCanary ? `${prefix}response:${id}` : id;
export const PROVIDER_WALLET_ID = providerEventName('pali-v2');
export const SYS_PROVIDER_KEY = isCanary ? 'paliCanary' : 'pali';

export function readProviderWireType(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (!isCanary) return value;
  return value.startsWith(prefix) ? value.slice(prefix.length) : undefined;
}
