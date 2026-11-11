import { getAddress } from 'ethers/address';

import type { ApprovalContractMetadata } from './approval.ts';
import {
  decodeAssetTransfer,
  type AssetTransferCall,
} from './assetTransfer.ts';
import { createErc20Policy, formatTokenUnits } from './erc20.ts';

const tokenPolicy = createErc20Policy(getAddress);

/** Public display data only. Neither decoded calldata nor token metadata proves execution. */
export type AssetTransferDisplay = Readonly<{
  contract: string;
  from: string | null;
  heading: 'token-transfer' | 'nft-transfer' | 'transfer-call';
  items: readonly Readonly<{
    symbol: string | null;
    tokenId: string | null;
    units: string;
    value: string;
  }>[];
  recipient: string;
  standard: AssetTransferCall['standard'];
  standardVerified: boolean;
  tokenName: string | null;
}>;

export function createAssetTransferDisplay(
  transfer: AssetTransferCall
): AssetTransferDisplay {
  let token = null;
  if (transfer.token) {
    try {
      const parsed = tokenPolicy.parseMetadata(transfer.token);
      if (parsed.contractAddress === transfer.contract) token = parsed;
    } catch {
      /* Invalid optional metadata leaves the exact raw amount visible. */
    }
  }
  const standardVerified =
    transfer.standardVerified && (!transfer.token || token !== null);
  return Object.freeze({
    heading:
      standardVerified && token
        ? 'token-transfer'
        : standardVerified && transfer.standard !== 'Unknown'
        ? 'nft-transfer'
        : 'transfer-call',
    contract: transfer.contract,
    recipient: transfer.recipient,
    from: transfer.from,
    standard: token || !transfer.token ? transfer.standard : 'Unknown',
    standardVerified,
    tokenName: token?.name ?? null,
    items: Object.freeze(
      transfer.items.map((item) =>
        Object.freeze({
          value: token
            ? formatTokenUnits(item.units, token.decimals)
            : item.tokenId !== null
            ? `#${item.tokenId}`
            : item.units,
          symbol: token?.symbol ?? null,
          tokenId: item.tokenId,
          units: item.units,
        })
      )
    ),
  });
}

/** Retire optional enrichment whenever the exact reviewed call changes. */
export function resolveAssetTransferDisplay(
  input: Readonly<{
    contract: unknown;
    data: unknown;
    transfer?: AssetTransferCall | null;
  }>
): AssetTransferDisplay | null {
  const decoded = decodeAssetTransfer(input.data, input.contract);
  if (!decoded) return null;
  const supplied = input.transfer;
  let metadata: ApprovalContractMetadata | undefined;
  if (
    supplied?.contract === decoded.contract &&
    JSON.stringify(supplied.decoded) === JSON.stringify(decoded.decoded) &&
    supplied.standardVerified
  ) {
    if (supplied.standard === 'ERC-20' && supplied.token) {
      try {
        metadata = {
          standard: 'ERC-20',
          token: tokenPolicy.parseMetadata(supplied.token),
        };
      } catch {
        /* Retain canonical calldata without malformed enrichment. */
      }
    } else if (
      supplied.standard === 'ERC-721' ||
      supplied.standard === 'ERC-1155'
    ) {
      metadata = { standard: supplied.standard };
    }
  }
  return createAssetTransferDisplay(
    decodeAssetTransfer(input.data, input.contract, metadata) ?? decoded
  );
}
