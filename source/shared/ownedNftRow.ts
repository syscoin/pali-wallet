import { isAddress } from 'ethers/address';

import { normalizeNftTokenId } from '../utils/nftTokenId.ts';

export type OwnedNftRow = {
  balance: number;
  contractAddress: string;
  decimals: 0;
  id: string;
  name: string;
  rawBalance?: string;
  symbol: string;
  tokenId?: string;
  tokenStandard: 'ERC-721' | 'ERC-1155';
};

export const hasInvisibleOwnedTokenName = (name: string) =>
  /[\u200B-\u200D\uFEFF\u00A0\u0000-\u001F\u007F-\u009F]/.test(name);

/** Project an explorer suggestion. Only rawBalance conveys exact item units. */
export function projectOwnedNftRow(
  row: Record<string, unknown>,
  chainId: number
): OwnedNftRow | null {
  try {
    const { contractAddress, type: tokenStandard } = row;
    if (
      (tokenStandard !== 'ERC-721' && tokenStandard !== 'ERC-1155') ||
      typeof contractAddress !== 'string' ||
      !isAddress(contractAddress)
    )
      return null;
    const name = String(row.name || 'NFT Collection');
    const balance = Number(row.balance || 0);
    const decimals = Number(row.decimals ?? 0);
    if (
      hasInvisibleOwnedTokenName(name) ||
      !Number.isFinite(balance) ||
      balance < 0 ||
      !Number.isInteger(decimals) ||
      decimals < 0 ||
      decimals > 80
    )
      return null;

    const result: OwnedNftRow = {
      balance,
      contractAddress,
      decimals: 0,
      id: `${contractAddress.toLowerCase()}-${chainId}`,
      name,
      symbol: String(row.symbol || 'NFT'),
      tokenStandard,
    };
    if (tokenStandard === 'ERC-1155') {
      const tokenId = normalizeNftTokenId(row.id);
      result.tokenId = tokenId;
      result.id += `-${tokenId}`;
      const quantity = row.balance;
      if (
        typeof quantity === 'number' ||
        (typeof quantity === 'string' && /^\d{1,256}$/.test(quantity))
      ) {
        try {
          result.rawBalance = normalizeNftTokenId(quantity);
        } catch {
          // A lossy explorer quantity still has an identity, but no exact units.
        }
      }
    }
    return result;
  } catch {
    return null;
  }
}
