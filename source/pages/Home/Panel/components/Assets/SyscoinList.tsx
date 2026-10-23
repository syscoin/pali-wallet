import React, { useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useSearchParams, useLocation } from 'react-router-dom';

import { useHomeBrowsingState } from '../../../useHomeBrowsingState';
import {
  HiTrash as DeleteIcon,
  RiShareForward2Line as ShareIcon,
} from 'components/Icon/Icon';
import { IconButton } from 'components/index';
import { TokenIcon } from 'components/index';
import { ListLoadMore } from 'components/Loading/ListLoadMore';
import { ConfirmationModal } from 'components/Modal';
import { Tooltip } from 'components/Tooltip';
import { useUtils } from 'hooks/index';
import { useIncrementalList } from 'hooks/useIncrementalList';
import { RootState } from 'state/store';
import {
  selectActiveAccountAssets,
  selectActiveAccountTransactions,
} from 'state/vault/selectors';
import {
  formatFullPrecisionBalance,
  truncate,
  getTokenLogo,
} from 'utils/index';
import {
  createBrowsingNavigationContext,
  navigateWithContext,
} from 'utils/navigationState';
import { isSptBalanceAvailable } from 'utils/sptBalance';
import { hasNonZeroAssetDelta } from 'utils/syscoinAssetAmount';

import { AssetRemovalStart, useAssetRemoval } from './useAssetRemoval';

//todo: create a loading state
export const SyscoinAssetsList = ({
  scope,
  onDeleteStart,
}: {
  onDeleteStart?: AssetRemovalStart;
  scope: string;
}) => {
  const assets = useSelector(selectActiveAccountAssets);
  const chainId = useSelector(
    (state: RootState) => state.vault.activeNetwork.chainId
  );
  const networkStatus = useSelector(
    (state: RootState) => state.vaultGlobal.networkStatus
  );
  const accountTransactions = useSelector(selectActiveAccountTransactions);
  const { navigate } = useUtils();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const location = useLocation();

  const removal = useAssetRemoval<any>(scope, onDeleteStart);
  const assetToDelete = removal.item;

  const isNetworkChanging = networkStatus === 'switching';

  const [view, setView] = useHomeBrowsingState('homeAssets', scope, {
    sptVisibleCount: 50,
  });

  // Memoize filtered assets for performance
  const filteredAssets = useMemo(
    () => assets?.syscoin?.filter((asset) => asset.chainId === chainId) || [],
    [assets?.syscoin, chainId]
  );

  const { visibleItems, visibleCount, hasMore, showMore } = useIncrementalList(
    filteredAssets,
    scope,
    view.sptVisibleCount
  );

  // Build a set of assetGuids that have at least one unconfirmed SPT transfer in tx list
  const pendingAssetGuids = useMemo(() => {
    const txs = accountTransactions?.syscoin?.[chainId] || [];
    const set = new Set<string>();
    for (const tx of txs) {
      if (!tx || (tx.confirmations || 0) > 0) continue;
      const transfers = Array.isArray((tx as any).tokenTransfers)
        ? (tx as any).tokenTransfers
        : [];
      for (const tr of transfers) {
        if (tr && tr.token !== undefined && tr.token !== null) {
          set.add(String(tr.token));
        }
      }
    }
    return set;
  }, [accountTransactions, chainId]);

  // Handle asset click
  const handleAssetClick = useCallback(
    (asset: any) => {
      const returnContext = createBrowsingNavigationContext(location, {
        tab: searchParams.get('tab') || 'assets',
        homeAssets: { scope, value: view },
      });

      navigateWithContext(
        navigate,
        '/home/details',
        { id: asset.assetGuid, hash: null },
        returnContext
      );
    },
    [navigate, searchParams, location.state, scope, view]
  );

  // Delete confirmation handlers
  const handleConfirmDelete = () => {
    if (assetToDelete)
      return removal.remove([assetToDelete.assetGuid, chainId]);
  };

  const renderAsset = (asset: any) => (
    <li
      key={String(asset.assetGuid)}
      className="flex items-center py-2 text-xs border-b border-dashed border-bkg-white200 hover:bg-alpha-whiteAlpha50 transition-colors duration-200 rounded-lg"
    >
      <table className="table-auto w-full">
        <tbody>
          <tr className="flex items-center justify-between font-poppins font-normal">
            <td className="flex items-center gap-3">
              {/* Token Logo */}
              <Tooltip content={asset.name || asset.symbol}>
                <span className="inline-flex items-center justify-center">
                  <TokenIcon
                    logo={
                      asset.image ||
                      getTokenLogo(asset.symbol, true, asset.assetGuid)
                    }
                    assetGuid={String(asset.assetGuid)}
                    symbol={asset.symbol}
                    size={24}
                    className="hover:shadow-md hover:scale-110 transition-all duration-200"
                  />
                </span>
              </Tooltip>

              <div className="flex flex-col">
                <div className="flex items-center gap-x-2">
                  <span
                    className="text-brand-white font-semibold"
                    title={
                      isSptBalanceAvailable(asset.balance)
                        ? String(asset.balance)
                        : t('settings.unavailable')
                    }
                  >
                    {isSptBalanceAvailable(asset.balance)
                      ? formatFullPrecisionBalance(
                          asset.balance,
                          Math.min(asset.decimals ?? 8, 4)
                        )
                      : t('settings.unavailable')}
                  </span>

                  <span
                    className="text-brand-royalbluemedium font-medium hover:text-brand-deepPink100 cursor-pointer underline transition-colors duration-200"
                    onClick={() => handleAssetClick(asset)}
                  >
                    {truncate(asset.symbol, 12).toUpperCase()}
                  </span>

                  {/* Pending if token has non-zero unconfirmed delta or an unconfirmed transfer exists */}
                  {(hasNonZeroAssetDelta(asset.unconfirmedBalance) ||
                    pendingAssetGuids.has(String(asset.assetGuid))) && (
                    <span
                      className="px-2 py-0.5 text-[9px] bg-yellow-500/20 text-yellow-500 rounded-full border border-yellow-500/20 font-medium animate-pulse"
                      title={t('send.pending')}
                    >
                      {t('send.pending')}
                    </span>
                  )}

                  {asset.contract &&
                    asset.contract !==
                      '0x0000000000000000000000000000000000000000' && (
                      <span
                        className="px-2 py-1 text-[10px] bg-gradient-to-r from-brand-royalbluemedium/20 to-brand-royalbluemedium/30 text-brand-royalbluemedium rounded-full border border-brand-royalbluemedium/20 font-medium"
                        title={t('send.crossChainSptWithNevm')}
                      >
                        NEVM
                      </span>
                    )}
                </div>

                <div className="flex items-center gap-x-1 mt-1">
                  <span className="text-brand-gray300 font-poppins text-[10px] font-normal">
                    {t('send.assetGuid')}
                  </span>
                  <span className="text-brand-gray400 font-mono text-[10px] break-all">
                    {asset.assetGuid}
                  </span>
                </div>
              </div>
            </td>

            <td className="flex items-center justify-between overflow-hidden overflow-ellipsis">
              <Tooltip content={t('tooltip.assetDetails')}>
                <IconButton
                  onClick={() => handleAssetClick(asset)}
                  className="p-2 hover:bg-brand-royalbluemedium/20 rounded-full transition-colors duration-200"
                  aria-label={t('tokens.viewTokenDetails', {
                    symbol: asset.symbol,
                  })}
                >
                  <ShareIcon
                    size={16}
                    className="text-brand-white hover:text-brand-royalbluemedium transition-colors"
                  />
                </IconButton>
              </Tooltip>

              <Tooltip content={t('tooltip.deleteAsset')}>
                <IconButton
                  onClick={() => removal.open(asset)}
                  className="p-2 hover:bg-red-500/20 rounded-full transition-colors duration-200"
                  aria-label={t('tokens.deleteToken', { symbol: asset.symbol })}
                >
                  <DeleteIcon
                    size={16}
                    className="text-brand-white hover:text-red-500 transition-colors"
                  />
                </IconButton>
              </Tooltip>
            </td>
          </tr>
        </tbody>
      </table>
    </li>
  );

  return (
    <>
      {isNetworkChanging ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-brand-blue500"></div>
        </div>
      ) : (
        <ul className="space-y-0">
          {filteredAssets?.length > 0 ? (
            visibleItems.map(renderAsset)
          ) : (
            <li>
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="w-16 h-16 bg-brand-royalbluemedium/10 rounded-full flex items-center justify-center mb-4">
                  <span className="text-brand-royalbluemedium text-2xl">₿</span>
                </div>
                <p className="text-brand-gray300 text-sm">
                  {t('tokens.noSptAssetsFound')}
                </p>
                <p className="text-brand-gray400 text-xs mt-1">
                  {t('tokens.importTokensToGetStarted')}
                </p>
              </div>
            </li>
          )}
          {hasMore && (
            <li>
              <ListLoadMore
                onClick={() => {
                  showMore();
                  setView({ sptVisibleCount: visibleCount + 50 });
                }}
                shown={visibleItems.length}
                total={filteredAssets.length}
              />
            </li>
          )}
        </ul>
      )}

      <ConfirmationModal
        show={Boolean(assetToDelete)}
        onClick={handleConfirmDelete}
        onClose={removal.close}
        title={t('tokens.deleteToken', {
          symbol: assetToDelete?.symbol || t('tokens.sptAsset'),
        })}
        description={t('tokens.confirmDeleteTokenSpt', {
          symbol: assetToDelete?.symbol || t('tokens.thisSptAsset'),
        })}
        buttonText={t('buttons.delete')}
        isButtonLoading={removal.pending}
      />
    </>
  );
};
