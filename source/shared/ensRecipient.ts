import { getAddress } from 'ethers/address';

/** ENS remains an Ethereum-mainnet lookup even for transfers on other EVM chains. */
export const ENS_RESOLUTION_CHAIN_ID = 1;
export const ENS_RECIPIENT_TTL_MS = 5 * 60 * 1000;

export function isEnsRecipientName(input: unknown): input is string {
  return typeof input === 'string' && input.toLowerCase().endsWith('.eth');
}

export function selectEnsResolutionNetwork<T>(
  registrations: readonly T[],
  chainId: (registration: T) => string | number
): T | null {
  return (
    registrations.find(
      (item) => String(chainId(item)) === String(ENS_RESOLUTION_CHAIN_ID)
    ) ?? null
  );
}

/** The provider owns ENS normalization, registry, wildcard and CCIP-read validation. */
export async function resolveEnsRecipientName(
  name: string,
  resolveName: (value: string) => Promise<string | null>
): Promise<string | null> {
  if (!isEnsRecipientName(name)) return null;
  try {
    return normalizeEnsResolvedAddress(await resolveName(name));
  } catch {
    return null;
  }
}

export function normalizeEnsResolvedAddress(address: unknown): string | null {
  try {
    return typeof address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(address)
      ? getAddress(address)
      : null;
  } catch {
    return null;
  }
}
