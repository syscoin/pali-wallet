import React, {
  useMemo,
  useCallback,
  useState,
  useEffect,
  useRef,
} from 'react';
import { useTranslation } from 'react-i18next';
import { HiTrash as DeleteIcon } from 'react-icons/hi';
import { RiShareForward2Line as ShareIcon } from 'react-icons/ri';
import { useSelector } from 'react-redux';
import { useSearchParams, useLocation } from 'react-router-dom';

import { IconButton } from 'components/index';
import { TokenIcon } from 'components/index';
import { ConfirmationModal } from 'components/Modal';
import { Tooltip } from 'components/Tooltip';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { formatCurrency, truncate, getTokenLogo } from 'utils/index';
import { navigateWithContext } from 'utils/navigationState';

//todo: create a loading state
export const SyscoinAssetsList = () => {
  const {
    accountAssets,
    activeAccount,
    activeNetwork: { chainId },
  } = useSelector((state: RootState) => state.vault);
  const {
    networkStatus,
    loadingStates: { isLoadingAssets },
  } = useSelector((state: RootState) => state.vaultGlobal);
  const assets = accountAssets?.[activeAccount.type]?.[activeAccount.id];
  const { navigate } = useUtils();
  const { controllerEmitter } = useController();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const location = useLocation();

  // Confirmation modal state
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [assetToDelete, setAssetToDelete] = useState<any>(null);

  const isNetworkChanging = networkStatus === 'switching';

  // Track if we've already restored scroll position to prevent duplicate restoration
  const hasRestoredScrollRef = useRef(false);

  // Handle navigation state restoration
  useEffect(() => {
    if (
      location.state?.scrollPosition !== undefined &&
      !hasRestoredScrollRef.current
    ) {
      hasRestoredScrollRef.current = true;
      window.scrollTo(0, location.state.scrollPosition);
    }
  }, [location.state]);

  // Memoize filtered assets for performance
  const filteredAssets = useMemo(
    () => assets?.syscoin?.filter((asset) => asset.chainId === chainId) || [],
    [assets?.syscoin, chainId]
  );

  // Memoize delete handlers
  const handleDeleteClickMemo = useCallback((asset: any) => {
    setAssetToDelete(asset);
    setShowDeleteConfirmation(true);
  }, []);

  // Handle asset click
  const handleAssetClick = useCallback(
    (asset: any) => {
      // Capture current scroll position
      const scrollPosition = window.scrollY || 0;

      const returnContext = {
        returnRoute: '/home',
        tab: searchParams.get('tab') || 'assets',
        scrollPosition,
      };

      navigateWithContext(
        navigate,
        '/home/details',
        { id: asset.assetGuid, hash: null },
        returnContext
      );
    },
    [navigate, searchParams]
  );

  // Delete confirmation handlers
  const handleConfirmDelete = () => {
    if (assetToDelete) {
      controllerEmitter(
        ['wallet', 'deleteTokenInfo'],
        [assetToDelete.assetGuid, chainId]
      );
    }
    setShowDeleteConfirmation(false);
    setAssetToDelete(null);
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirmation(false);
    setAssetToDelete(null);
  };

  // Memoize asset rendering for better performance
  const renderAsset = useMemo(() => {
    const AssetRenderer = (asset: any) => (
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
                      logo={asset.image || getTokenLogo(asset.symbol)}
                      assetGuid={String(asset.assetGuid)}
                      symbol={asset.symbol}
                      size={24}
                      className="hover:shadow-md hover:scale-110 transition-all duration-200"
                    />
                  </span>
                </Tooltip>

                <div className="flex flex-col">
                  <div className="flex items-center gap-x-2">
                    <span className="text-brand-white font-semibold">
                      {truncate(
                        formatCurrency(
                          String(asset.balance),
                          Math.min(asset.decimals, 4) // Limit displayed decimals for UI
                        ),
                        8,
                        false
                      )}
                    </span>

                    <span
                      className="text-brand-royalbluemedium font-medium hover:text-brand-deepPink100 cursor-pointer underline transition-colors duration-200"
                      onClick={() => handleAssetClick(asset)}
                    >
                      {truncate(asset.symbol, 12).toUpperCase()}
                    </span>

                    {/* Show pending indicator if there are unconfirmed transfers */}
                    {/* unconfirmedBalance is -1 when there are pending transactions */}
                    {asset.unconfirmedBalance === -1 && (
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
                    aria-label={`View details for ${asset.symbol} token`}
                  >
                    <ShareIcon
                      size={16}
                      className="text-brand-white hover:text-brand-royalbluemedium transition-colors"
                    />
                  </IconButton>
                </Tooltip>

                <Tooltip content={t('tooltip.deleteAsset')}>
                  <IconButton
                    onClick={() => handleDeleteClickMemo(asset)}
                    className="p-2 hover:bg-red-500/20 rounded-full transition-colors duration-200"
                    aria-label={`Delete ${asset.symbol} token`}
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

    AssetRenderer.displayName = 'AssetRenderer';
    return AssetRenderer;
  }, [navigate, t, handleDeleteClickMemo, handleAssetClick]);

  return (
    <>
      {isLoadingAssets || isNetworkChanging ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-brand-blue500"></div>
        </div>
      ) : (
        <ul className="space-y-0">
          {filteredAssets?.length > 0 ? (
            filteredAssets.map(renderAsset)
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
        </ul>
      )}

      <ConfirmationModal
        show={showDeleteConfirmation}
        onClick={handleConfirmDelete}
        onClose={handleCancelDelete}
        title={t('tokens.deleteToken', {
          symbol: assetToDelete?.symbol || 'SPT Asset',
        })}
        description={t('tokens.confirmDeleteTokenSpt', {
          symbol: assetToDelete?.symbol || 'this SPT asset',
        })}
        buttonText={t('buttons.delete')}
      />
    </>
  );
};
