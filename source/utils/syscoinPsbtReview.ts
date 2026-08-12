import { formatSyscoinValue } from './formatSyscoinValue';
import { normalizeSyscoinTransactionType } from './syscoinTransactionUtils';

interface IAssetMetadata {
  assetGuid?: string;
  assetType?: 'SYSX' | 'ERC20' | 'ERC721' | 'ERC1155';
  contract?: string;
  decimals?: number;
  originDecimals?: number;
  symbol?: string;
  tokenId?: string;
}

interface IDecodedAssetValue {
  n: number;
  value: number | string;
}

interface IDecodedAsset {
  assetGuid: string;
  values?: IDecodedAssetValue[];
}

interface IDecodedReviewTransaction {
  error?: string;
  feeSatoshis?: string;
  syscoin?: {
    allocations?: { assets?: IDecodedAsset[] } | null;
    txtype?: string;
  };
  vout?: Array<{
    n: number;
    scriptPubKey?: { addresses?: string[]; hex?: string; type?: string };
  }>;
}

export interface IAssetReviewRow {
  amount: string;
  assetGuid: string;
  isBurn: boolean;
  outputIndex: number;
  rawAmount: string;
  recipient?: string;
  symbol: string;
}

const getCanonicalOutputRecipient = (
  output: NonNullable<IDecodedReviewTransaction['vout']>[number] | undefined
): string | undefined =>
  [
    'pubkeyhash',
    'scripthash',
    'witness_v0_keyhash',
    'witness_v0_scripthash',
    'witness_v1_taproot',
  ].includes(output?.scriptPubKey?.type || '')
    ? output?.scriptPubKey?.addresses?.[0]
    : undefined;

const getAssetMetadataError = (
  assetGuid: string,
  metadata: IAssetMetadata | undefined
): string | null => {
  if (!/^\d+$/.test(assetGuid)) {
    return `Unable to verify asset GUID ${assetGuid}`;
  }

  const decimals = metadata?.decimals;
  if (!Number.isInteger(decimals) || decimals! < 0 || decimals! > 8) {
    return `Unable to verify decimals for asset ${assetGuid}`;
  }

  const isNftGuid = BigInt(assetGuid) >> BigInt(32) > BigInt(0);
  const assetType = metadata?.assetType;
  if (!assetType) {
    return `Unable to verify the origin type for asset ${assetGuid}`;
  }
  if (assetGuid === '123456') {
    if (assetType !== 'SYSX' || decimals !== 8) {
      return 'SYSX metadata does not match its canonical identity';
    }
    return null;
  }

  if (assetType === 'ERC20') {
    if (isNftGuid || decimals !== 8) {
      return `ERC20 asset ${assetGuid} must use an eight-decimal UTXO representation`;
    }
    if (
      !Number.isInteger(metadata.originDecimals) ||
      metadata.originDecimals! < 0 ||
      metadata.originDecimals! > 255
    ) {
      return `Unable to verify origin decimals for asset ${assetGuid}`;
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(metadata.contract || '')) {
      return `Unable to verify origin contract for asset ${assetGuid}`;
    }
    return null;
  }

  if (
    (assetType !== 'ERC721' && assetType !== 'ERC1155') ||
    !isNftGuid ||
    decimals !== 0 ||
    metadata.originDecimals !== 0
  ) {
    return `NFT asset ${assetGuid} must use zero-decimal units`;
  }

  if (!/^0x[0-9a-fA-F]{40}$/.test(metadata.contract || '')) {
    return `Unable to verify origin contract for asset ${assetGuid}`;
  }
  if (
    !/^\d+$/.test(metadata.tokenId || '') ||
    BigInt(metadata.tokenId!) <= BigInt(0)
  ) {
    return `Unable to verify token ID for asset ${assetGuid}`;
  }

  return null;
};

export const getSyscoinPsbtReviewError = (
  decodedTx: IDecodedReviewTransaction | null,
  assetInfoMap: Record<string, IAssetMetadata>
): string | null => {
  if (!decodedTx) return 'Transaction details are not available';
  if (decodedTx.error) return decodedTx.error;

  const txType = decodedTx.syscoin?.txtype;
  if (
    txType &&
    txType.toLowerCase() !== 'bitcoin' &&
    !normalizeSyscoinTransactionType(txType)
  ) {
    return `Unsupported Syscoin transaction type: ${txType}`;
  }

  if (!/^\d+$/.test(decodedTx.feeSatoshis || '')) {
    return 'Unable to verify the transaction fee';
  }

  const assets = decodedTx.syscoin?.allocations?.assets || [];
  const normalizedType = normalizeSyscoinTransactionType(txType);
  if (normalizedType && normalizedType !== 'nevmdata' && assets.length === 0) {
    return 'Unable to verify Syscoin asset allocations';
  }

  for (const output of decodedTx.vout || []) {
    const hasCanonicalAddress = Boolean(getCanonicalOutputRecipient(output));
    const scriptHex = output.scriptPubKey?.hex || '';
    if (!hasCanonicalAddress && !/^(?:[0-9a-fA-F]{2})+$/.test(scriptHex)) {
      return `Unable to verify output ${output.n} script`;
    }
  }

  for (const asset of assets) {
    const metadataError = getAssetMetadataError(
      asset.assetGuid,
      assetInfoMap[asset.assetGuid]
    );
    if (metadataError) return metadataError;

    if (!asset.values?.length) {
      return `Asset ${asset.assetGuid} has no decoded outputs`;
    }

    for (const value of asset.values) {
      const rawAmount = String(value.value);
      if (!/^\d+$/.test(rawAmount) || BigInt(rawAmount) <= BigInt(0)) {
        return `Asset ${asset.assetGuid} has an invalid output amount`;
      }

      const output = decodedTx.vout?.find(
        (candidate) => candidate.n === value.n
      );
      if (!output) {
        return `Asset ${asset.assetGuid} references a missing output`;
      }

      if (
        normalizedType === 'assetallocationburntoethereum' &&
        output.scriptPubKey?.type === 'nulldata' &&
        assetInfoMap[asset.assetGuid]?.assetType === 'ERC20'
      ) {
        const originDecimals = assetInfoMap[asset.assetGuid].originDecimals!;
        if (originDecimals < 8) {
          const factor = BigInt(`1${'0'.repeat(8 - originDecimals)}`);
          if (BigInt(rawAmount) % factor !== BigInt(0)) {
            return `Burn amount for asset ${asset.assetGuid} is not representable with ${originDecimals} origin decimals`;
          }
        }
      }
    }

    if (
      normalizedType === 'assetallocationburntoethereum' &&
      !asset.values.some((value) =>
        decodedTx.vout?.some(
          (output) =>
            output.n === value.n && output.scriptPubKey?.type === 'nulldata'
        )
      )
    ) {
      return `Burn amount for asset ${asset.assetGuid} is not bound to the burn output`;
    }
  }

  return null;
};

export const getAssetReviewRows = (
  decodedTx: IDecodedReviewTransaction,
  assetInfoMap: Record<string, IAssetMetadata>
): IAssetReviewRow[] =>
  (decodedTx.syscoin?.allocations?.assets || []).flatMap((asset) => {
    const metadata = assetInfoMap[asset.assetGuid];
    const decimals = metadata?.decimals;

    return (asset.values || []).map((value) => {
      const rawAmount = String(value.value);
      const output = decodedTx.vout?.find(
        (candidate) => candidate.n === value.n
      );

      return {
        amount: Number.isInteger(decimals)
          ? formatSyscoinValue(rawAmount, decimals)
          : `${rawAmount} base units`,
        assetGuid: asset.assetGuid,
        outputIndex: value.n,
        rawAmount,
        recipient: getCanonicalOutputRecipient(output),
        isBurn: output?.scriptPubKey?.type === 'nulldata',
        symbol:
          metadata?.symbol ||
          (asset.assetGuid === '123456' ? 'SYSX' : 'Unknown'),
      };
    });
  });
