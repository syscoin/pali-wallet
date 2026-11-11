import { parseSyscoinAssetGuid, SYSX_ASSET_GUID } from './syscoinAssetIds.ts';

export type AssetIconIdentity = Readonly<
  | {
      chainId: number | string;
      contractAddress: string;
      decimals?: number;
      kind: 'evm';
    }
  | {
      assetGuid: number | string;
      chainId: number | string;
      decimals?: number;
      kind: 'spt';
    }
>;

/** Symbols and issuer metadata are never a source of branded artwork. */
export function assetIconIdentityKey(
  identity: AssetIconIdentity
): string | null {
  if (!identity || !['evm', 'spt'].includes(identity.kind)) return null;
  const chain =
    typeof identity.chainId === 'number' &&
    Number.isSafeInteger(identity.chainId)
      ? String(identity.chainId)
      : identity.chainId;
  if (
    typeof chain !== 'string' ||
    !/^(?:0|[1-9][0-9]{0,15})$/.test(chain) ||
    BigInt(chain) > BigInt(Number.MAX_SAFE_INTEGER)
  )
    return null;
  if (identity.kind === 'spt') {
    const guid = parseSyscoinAssetGuid(identity.assetGuid);
    return guid
      ? checkedPrecision(`spt:${chain}:${guid}`, identity.decimals)
      : null;
  }
  return typeof identity.contractAddress === 'string' &&
    /^0x[0-9a-f]{40}$/i.test(identity.contractAddress)
    ? checkedPrecision(
        `evm:${chain}:${identity.contractAddress.toLowerCase()}`,
        identity.decimals
      )
    : null;
}

type Artwork = 'syscoin' | 'zksys' | 'usdc';
const knownArtwork: Readonly<
  Record<string, Readonly<{ artwork: Artwork; decimals: number }>>
> = Object.freeze({
  [`spt:57:${SYSX_ASSET_GUID}`]: { artwork: 'syscoin', decimals: 8 },
  [`spt:5700:${SYSX_ASSET_GUID}`]: { artwork: 'syscoin', decimals: 8 },
  // Existing Pali ZKSYS_TANENBAUM_TESTNET_NETWORK_57057 fee token, also pinned by
  // zksync-os-server a5fc01758b06a0239fcb355895be51ff7b1055e7's token-metadata.zksys.json.
  'evm:57057:0x6ebb170f69d886916d9ee9e585ce39e626cbc35d': {
    artwork: 'zksys',
    decimals: 18,
  },
  // Reviewed zksync-os-server 5797cec9 token-metadata.zksys.json identity.
  'evm:57057:0xd501e86b1fc5823403b2ba995e2b8b78179236a6': {
    artwork: 'usdc',
    decimals: 6,
  },
  // The reviewed L2 token's l1Address() identifies its Syscoin Tanenbaum source.
  'evm:5700:0xb26b0ec48ed88347ed89874411cae4a1ecdf97fd': {
    artwork: 'usdc',
    decimals: 6,
  },
  // Tracked zksys-bridge tanenbaum-testnet deployment.yaml Sepolia source token.
  'evm:11155111:0x1c7d4b196cb0c7b01d743fbc6116a902379c7238': {
    artwork: 'usdc',
    decimals: 6,
  },
});

function checkedPrecision(
  key: string,
  decimals: number | undefined
): string | null {
  if (
    decimals !== undefined &&
    (!Number.isInteger(decimals) ||
      decimals < 0 ||
      decimals > 255 ||
      (knownArtwork[key] && knownArtwork[key].decimals !== decimals))
  )
    return null;
  return key;
}

/** Only identities already established by the wallet's existing configuration. */
export function knownAssetIcon(identity: AssetIconIdentity): Artwork | null {
  const key = assetIconIdentityKey(identity);
  return key ? knownArtwork[key]?.artwork ?? null : null;
}

/** CoinGecko image metadata is optional and restricted to its raster CDN paths. */
export function trustedAssetIconUri(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      ['coin-images.coingecko.com', 'assets.coingecko.com'].includes(
        url.hostname
      ) &&
      /^\/coins\/images\/[0-9]+\/(?:thumb|small|large|standard)\/[^/]+\.(?:png|jpe?g|webp)$/i.test(
        url.pathname
      ) &&
      (!url.search || /^\?[0-9]+$/.test(url.search))
      ? url.href
      : null;
  } catch {
    return null;
  }
}
