import {
  assetIconIdentityKey,
  trustedAssetIconUri,
} from '../../shared/assetIconIdentity';
import type { RootState } from 'state/store';
import type { IEvmTransactionContext } from 'utils/evmTransactionContext';

import type { AssetTransferDisplay } from '../../shared/assetTransferDisplay';

/** Saved display data is selected by the reviewed owner and exact asset, never its symbol. */
export function selectAssetTransferIcon(
  state: Pick<RootState, 'vault' | 'vaultGlobal'>,
  context: IEvmTransactionContext | undefined,
  transfer: AssetTransferDisplay
): string | undefined {
  return selectReviewedAssetIcon(state, context, {
    contract: transfer.contract,
    decimals: transfer.decimals,
    tokenId:
      transfer.items.length === 1
        ? transfer.items[0].tokenId ?? undefined
        : undefined,
  });
}

export type ReviewedAssetIconIdentity = Readonly<{
  contract: string;
  decimals?: number;
  tokenId?: string;
}>;

export function selectReviewedAssetIcon(
  state: Pick<RootState, 'vault' | 'vaultGlobal'>,
  context: IEvmTransactionContext | undefined,
  reviewed: ReviewedAssetIconIdentity
): string | undefined {
  if (!context) return;
  const { vault, vaultGlobal } = state;
  const selected = vault.activeAccount;
  if (
    !selected ||
    vault.isBitcoinBased ||
    selected.type !== context.account.type ||
    selected.id !== context.account.id ||
    vault.activeNetwork?.chainId !== context.chainId ||
    vault.activeNetwork?.url !== context.rpcUrl ||
    vaultGlobal?.activeSlip44 !== context.slip44 ||
    vault.accounts[selected.type]?.[selected.id]?.address?.toLowerCase() !==
      context.account.address.toLowerCase()
  )
    return;
  const identity = assetIconIdentityKey({
    kind: 'evm',
    chainId: context.chainId,
    contractAddress: reviewed.contract,
    ...(reviewed.decimals === undefined ? {} : { decimals: reviewed.decimals }),
  });
  if (!identity) return;
  const assets =
    vault.accountAssets?.[context.account.type]?.[context.account.id]?.ethereum;
  if (!Array.isArray(assets)) return;
  const matches = assets.filter(
    (asset) =>
      assetIconIdentityKey({
        kind: 'evm',
        chainId: asset.chainId,
        contractAddress: asset.contractAddress,
        ...(asset.decimals === undefined
          ? {}
          : { decimals: Number(asset.decimals) }),
      }) === identity &&
      (asset.tokenId === undefined || reviewed.tokenId === asset.tokenId) &&
      trustedAssetIconUri(asset.logo) !== null
  );
  const logos = new Set(matches.map((asset) => asset.logo));
  return logos.size === 1 ? matches[0].logo : undefined;
}
