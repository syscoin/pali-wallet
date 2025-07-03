import { uniqueId } from 'lodash';
import React, { Fragment, useMemo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HiTrash as DeleteIcon } from 'react-icons/hi';
import { RiShareForward2Line as ShareIcon } from 'react-icons/ri';
import { useSelector } from 'react-redux';

import { IconButton } from 'components/index';
import { ConfirmationModal } from 'components/Modal';
import { Tooltip } from 'components/Tooltip';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { formatCurrency, truncate, getTokenLogo } from 'utils/index';

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
  const assets = accountAssets[activeAccount.type]?.[activeAccount.id];
  const { navigate } = useUtils();
  const { controllerEmitter } = useController();
  const { t } = useTranslation();

  // Confirmation modal state
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [assetToDelete, setAssetToDelete] = useState<any>(null);

  const isNetworkChanging = networkStatus === 'switching';

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
      navigate('/home/details', {
        state: { id: asset.assetGuid, hash: null },
      });
    },
    [navigate]
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
        key={uniqueId(String(asset.assetGuid))}
        className="flex items-center py-3 text-xs border-b border-dashed border-bkg-white200 hover:bg-alpha-whiteAlpha50 transition-colors duration-200 rounded-lg"
      >
        <table className="table-auto w-full">
          <tbody>
            <tr className="flex items-center justify-between font-poppins font-normal">
              <td className="flex items-center gap-x-3">
                {/* Token Logo */}
                {asset.image || getTokenLogo(asset.symbol) ? (
                  <div
                    className="w-6 h-6 rounded-full overflow-hidden bg-bkg-2 border border-bkg-4 
                              hover:shadow-md hover:scale-110 transition-all duration-200"
                  >
                    <img
                      src={asset.image || getTokenLogo(asset.symbol)!}
                      alt={asset.symbol}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        e.currentTarget.nextElementSibling?.classList.remove(
                          'hidden'
                        );
                      }}
                    />
                    <div
                      className="hidden w-full h-full bg-gradient-to-br from-brand-royalblue to-brand-pink200 
                                flex items-center justify-center"
                    >
                      <span className="text-white text-xs font-bold">
                        {asset.symbol?.charAt(0).toUpperCase() || 'S'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div
                    className="w-6 h-6 rounded-full bg-gradient-to-br from-brand-royalblue to-brand-pink200 
                              flex items-center justify-center hover:shadow-md hover:scale-110 
                              transition-all duration-200"
                  >
                    <span className="text-white text-xs font-bold">
                      {asset.symbol?.charAt(0).toUpperCase() || 'S'}
                    </span>
                  </div>
                )}

                <div className="flex flex-col">
                  <div className="flex items-center gap-x-2">
                    <span className="text-brand-white font-semibold">
                      {truncate(
                        formatCurrency(
                          String(asset.balance / 10 ** asset.decimals),
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
                      {`${truncate(asset.symbol, 12).toUpperCase()}`}
                    </span>

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

              <td className="flex items-center max-w-max text-left whitespace-nowrap overflow-hidden overflow-ellipsis gap-x-2.5">
                <Tooltip content={t('tooltip.assetDetails')}>
                  <IconButton
                    onClick={() =>
                      navigate('/home/details', {
                        state: { id: asset.assetGuid, hash: null },
                      })
                    }
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
