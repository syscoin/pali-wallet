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
  source: Readonly<{
    /** A fresh RPC read from the same configured source, never getNetwork(). */
    readChainId(): Promise<unknown>;
    resolveName(value: string): Promise<string | null>;
  }>
): Promise<string | null> {
  if (!isEnsRecipientName(name)) return null;
  try {
    const address = normalizeEnsResolvedAddress(await source.resolveName(name));
    if (!address) return null;
    // A static/cached provider network does not detect an endpoint changing
    // chains during the ENS lookup. Recheck before publishing its result.
    const chainId = await source.readChainId();
    return typeof chainId === 'string' &&
      chainId.length <= 66 &&
      /^0x[0-9a-f]+$/i.test(chainId) &&
      BigInt(chainId) === BigInt(ENS_RESOLUTION_CHAIN_ID)
      ? address
      : null;
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
