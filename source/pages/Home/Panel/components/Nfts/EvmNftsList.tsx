import React, { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { HiTrash as DeleteIcon } from 'react-icons/hi';
import { RiShareForward2Line as DetailsIcon } from 'react-icons/ri';
import { useSelector } from 'react-redux';

import { ConfirmationModal } from 'components/Modal';
import { Tooltip } from 'components/Tooltip';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { selectActiveAccountWithAssets } from 'state/vault/selectors';
import { truncate } from 'utils/index';
import { getNftAssetsFromEthereum } from 'utils/nftToAsset';

export const EvmNftsList = () => {
  const { controllerEmitter } = useController();
  const { navigate } = useUtils();
  const { t } = useTranslation();

  const { assets: accountAssets } = useSelector(selectActiveAccountWithAssets);
  const {
    activeNetwork: { chainId },
  } = useSelector((state: RootState) => state.vault);

  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{
    contractAddress: string;
    name?: string;
    type: 'collection' | 'nft';
  } | null>(null);

  // NFTs now come through regular asset updates, no need for separate fetching

  // Handle delete clicks
  const handleDeleteCollection = useCallback(
    (contractAddress: string, name: string) => {
      setItemToDelete({
        type: 'collection',
        contractAddress,
        name: name,
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
  }, [itemToDelete, controllerEmitter]);

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
        tokenStandard: nft.tokenStandard || 'ERC-721',
        chainId: nft.chainId,
        totalBalance: nft.balance, // This is already the total count
      })),
    [nftAssets]
  );

  // NFTs are automatically updated through regular asset polling

  // ✅ MEMOIZED: Loading state - use assets loading state since NFTs come with assets
  const isLoadingAssets = useSelector(
    (state: RootState) => state.vaultGlobal.loadingStates.isLoadingAssets
  );

  const handleNftClick = useCallback(
    (collection: any) => {
      navigate('/home/details', {
        state: {
          id: collection.id,
          hash: null,
        },
      });
    },
    [navigate]
  );

  if (isLoadingAssets) {
    return (
      <div className="w-full h-64 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-brand-white" />
      </div>
    );
  }

  if (collections.length === 0) {
    return (
      <div className="w-full text-center py-8">
        <p className="text-brand-gray200 text-sm">No NFTs found</p>
        <p className="text-brand-gray200 text-xs text-center mt-8 mb-6">
          {t('send.nftsYouOwnWillAppearHere')}
        </p>
      </div>
    );
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
                {collection.name || truncate(collection.contractAddress, 16)}
              </span>
              <span className="text-brand-gray200 text-[10px]">
                {collection.tokenStandard}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between w-12">
            <Tooltip content={t('send.nftDetails')}>
              <DetailsIcon
                className="cursor-pointer hover:text-fields-input-borderfocus text-brand-white"
                size={16}
                onClick={() =>
                  navigate('/home/details', {
                    state: {
                      id: collection.id,
                      hash: null,
                    },
                  })
                }
              />
            </Tooltip>

            <Tooltip content={t('send.deleteCollection')}>
              <DeleteIcon
                className="cursor-pointer hover:text-fields-input-borderfocus"
                color="text-brand-white"
                size={16}
                onClick={() =>
                  handleDeleteCollection(
                    collection.contractAddress,
                    collection.name
                  )
                }
              />
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
