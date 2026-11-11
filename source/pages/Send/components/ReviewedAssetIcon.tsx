import React from 'react';
import { useSelector } from 'react-redux';

import {
  selectReviewedAssetIcon,
  type ReviewedAssetIconIdentity,
} from '../assetTransferIcon';
import { TokenIcon } from 'components/TokenIcon';
import type { RootState } from 'state/store';
import type { IEvmTransactionContext } from 'utils/evmTransactionContext';

/** Decorative artwork from the captured review identity; never starts image reads. */
export function ReviewedAssetIcon({
  asset,
  context,
  isNft = false,
  size,
}: {
  asset: ReviewedAssetIconIdentity;
  context?: IEvmTransactionContext;
  isNft?: boolean;
  size: number;
}) {
  const logo = useSelector((state: RootState) =>
    selectReviewedAssetIcon(state, context, asset)
  );
  return (
    <span aria-hidden="true" className="inline-flex shrink-0">
      <TokenIcon
        cacheOnly
        identity={
          context
            ? {
                kind: 'evm',
                chainId: context.chainId,
                contractAddress: asset.contract,
                ...(asset.decimals === undefined
                  ? {}
                  : { decimals: asset.decimals }),
              }
            : undefined
        }
        logo={logo}
        isNft={isNft}
        size={size}
      />
    </span>
  );
}
