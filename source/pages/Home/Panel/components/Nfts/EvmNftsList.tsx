import React, { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { HiTrash as DeleteIcon } from 'react-icons/hi';
import { RiShareForward2Line as DetailsIcon } from 'react-icons/ri';
import { useSelector } from 'react-redux';
import { useSearchParams } from 'react-router-dom';

import { IconButton } from 'components/index';
import { ConfirmationModal } from 'components/Modal';
import { Tooltip } from 'components/Tooltip';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { selectActiveAccountWithAssets } from 'state/vault/selectors';
import { truncate, navigateWithContext } from 'utils/index';
import { getNftAssetsFromEthereum } from 'utils/nftToAsset';

interface IEvmNftsListProps {
  state: {
    isCoinSelected: boolean;
    searchValue: string;
    sortByValue: string;
  };
}

export const EvmNftsList = ({ state }: IEvmNftsListProps) => {
  const { controllerEmitter } = useController();
  const { navigate } = useUtils();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();

  const { assets: accountAssets } = useSelector(selectActiveAccountWithAssets);
  const {
    activeNetwork: { chainId },
  } = useSelector((rootState: RootState) => rootState.vault);

  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{
    contractAddress: string;
    name?: string;
    type: 'collection' | 'nft';
  } | null>(null);

  // NFTs now come through regular asset updates, no need for separate fetching

  // Handle delete clicks
  const handleDeleteCollection = useCallback(
    (contractAddress: string, symbol: string) => {
      setItemToDelete({
        type: 'collection',
        contractAddress,
        name: symbol, // Using symbol but keeping 'name' field for consistency with modal
      });
      setShowDeleteConfirmation(true);
    },
    []
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!itemToDelete) return;

    try {
      // Always delete the entire collection entry
      await controllerEmitter(
        ['wallet', 'deleteTokenInfo'],
        [itemToDelete.contractAddress, chainId]
      );
    } catch (error) {
      console.error('Error deleting NFT:', error);
    }

    setShowDeleteConfirmation(false);
    setItemToDelete(null);
  }, [itemToDelete]);

  const handleCancelDelete = useCallback(() => {
    setShowDeleteConfirmation(false);
    setItemToDelete(null);
  }, []);

  // Group NFTs by collection
  const nftAssets = useMemo(
    () => getNftAssetsFromEthereum(accountAssets.ethereum, chainId),
    [accountAssets.ethereum, chainId]
  );

  const collections = useMemo(
    () =>
      // NFTs are already stored as collections with total balance
      nftAssets.map((nft) => ({
        id: nft.id, // Include the original asset id for navigation
        contractAddress: nft.contractAddress,
        name: nft.name || 'Unknown Collection',
        symbol: nft.tokenSymbol || 'Unknown', // Use tokenSymbol for display
        tokenStandard: nft.tokenStandard || 'ERC-721',
        chainId: nft.chainId,
        totalBalance: nft.balance, // This is already the total count
      })),
    [nftAssets]
  );

  // NFTs are automatically updated through regular asset polling

  // ✅ MEMOIZED: Loading state - use assets loading state since NFTs come with assets
  const isLoadingAssets = useSelector(
    (rootState: RootState) =>
      rootState.vaultGlobal.loadingStates.isLoadingAssets
  );

  const handleNftClick = useCallback(
    (collection: any) => {
      // Capture current scroll position
      const scrollPosition = window.scrollY || 0;

      const returnContext = {
        returnRoute: '/home',
        tab: searchParams.get('tab') || 'assets',
        scrollPosition,
        state, // Use the complete state object passed as prop
      };

      navigateWithContext(
        navigate,
        '/home/details',
        { id: collection.id, hash: null },
        returnContext
      );
    },
    [navigate, searchParams, state]
  );

  if (isLoadingAssets) {
    return (
      <div className="w-full h-64 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-brand-white" />
      </div>
    );
  }

  if (collections.length === 0) {
    return null; // Let the parent AssetsPanel handle empty state with Import Token link
  }

  return (
    <>
      {collections.map((collection) => (
        <li
          key={collection.contractAddress}
          className="flex items-center justify-between py-2 text-xs border-b border-dashed border-bkg-white200"
        >
          <div className="flex gap-3 items-center justify-start flex-1">
            {/* Collection Info */}
            <div className="flex items-center gap-x-2">
              <span className="text-brand-white">
                {collection.totalBalance}{' '}
                {collection.totalBalance === 1
                  ? t('nftDetails.item')
                  : t('nftDetails.items')}
              </span>
              <span
                className="text-brand-royalbluemedium hover:text-brand-deepPink100 cursor-pointer underline transition-colors duration-200"
                onClick={() => handleNftClick(collection)}
              >
                {truncate(collection.symbol, 10).toUpperCase()}
              </span>
              <span className="text-brand-gray200 text-[10px]">
                {collection.tokenStandard}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between overflow-hidden overflow-ellipsis">
            <Tooltip content={t('send.nftDetails')}>
              <IconButton
                onClick={() => handleNftClick(collection)}
                className="p-2 hover:bg-brand-royalbluemedium/20 rounded-full transition-colors duration-200"
                aria-label={`View details for ${collection.symbol} collection`}
              >
                <DetailsIcon
                  size={16}
                  className="text-brand-white hover:text-brand-royalbluemedium transition-colors"
                />
              </IconButton>
            </Tooltip>

            <Tooltip content={t('send.deleteCollection')}>
              <IconButton
                onClick={() =>
                  handleDeleteCollection(
                    collection.contractAddress,
                    collection.symbol
                  )
                }
                className="p-2 hover:bg-red-500/20 rounded-full transition-colors duration-200"
                aria-label={`Delete ${collection.symbol} collection`}
              >
                <DeleteIcon
                  size={16}
                  className="text-brand-white hover:text-red-500 transition-colors"
                />
              </IconButton>
            </Tooltip>
          </div>
        </li>
      ))}

      <ConfirmationModal
        show={showDeleteConfirmation}
        onClick={handleConfirmDelete}
        onClose={handleCancelDelete}
        title={t('send.deleteCollection')}
        description={t('send.deleteCollectionConfirm', {
          name: itemToDelete?.name,
        })}
        buttonText="Delete"
      />
    </>
  );
};
