import React, { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { HiTrash as DeleteIcon } from 'react-icons/hi';
import { RiShareForward2Line as DetailsIcon } from 'react-icons/ri';
import { useSelector } from 'react-redux';
import { useSearchParams } from 'react-router-dom';

import { IconButton, TokenIcon } from 'components/index';
import { ConfirmationModal } from 'components/Modal';
import { Tooltip } from 'components/Tooltip';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { selectActiveAccountWithAssets } from 'state/vault/selectors';
import { truncate, navigateWithContext, ellipsis } from 'utils/index';
import { getNftAssetsFromEthereum } from 'utils/nftToAsset';
import { getTokenTypeBadgeColor } from 'utils/tokens';

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
    tokenId?: string;
    type: 'collection' | 'nft';
  } | null>(null);

  // NFTs now come through regular asset updates, no need for separate fetching

  // Handle delete clicks
  const handleDeleteCollection = useCallback(
    (contractAddress: string, symbol: string, tokenId?: string) => {
      setItemToDelete({
        type: 'collection',
        contractAddress,
        name: symbol, // Using symbol but keeping 'name' field for consistency with modal
        tokenId,
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
        [itemToDelete.contractAddress, chainId, itemToDelete.tokenId]
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
        name: nft.name || 'NFT Collection',
        symbol: nft.tokenSymbol || 'NFT', // Use tokenSymbol for display
        tokenStandard: nft.tokenStandard || 'ERC-721',
        chainId: nft.chainId,
        totalBalance: nft.balance, // This is already the total count
        tokenId: nft.tokenId,
        logo: nft.logo, // Include logo if available
      })),
    [nftAssets]
  );

  // NFTs are automatically updated through regular asset polling

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

  if (collections.length === 0) {
    return null; // Let the parent AssetsPanel handle empty state with Import Token link
  }

  return (
    <>
      {collections.map((collection) => (
        <li
          key={collection.id}
          className="flex items-center justify-between py-2 text-xs border-b border-dashed border-bkg-white200"
        >
          <div className="flex gap-3 items-center justify-start flex-1">
            {/* NFT Icon */}
            {collection.logo ? (
              <Tooltip content={collection.name || collection.symbol}>
                <span className="inline-flex items-center justify-center">
                  <TokenIcon
                    logo={collection.logo}
                    contractAddress={collection.contractAddress}
                    symbol={collection.symbol}
                    size={24}
                    className="hover:shadow-md hover:scale-110 transition-all duration-200"
                  />
                </span>
              </Tooltip>
            ) : (
              <div
                className="w-6 h-6 rounded bg-gradient-to-br from-brand-royalblue to-brand-pink200 
                            flex items-center justify-center hover:shadow-md hover:scale-110 
                            transition-all duration-200 flex-shrink-0"
              >
                <span className="text-white text-[10px] font-bold">NFT</span>
              </div>
            )}

            {/* Collection Info */}
            <div className="flex flex-col gap-y-1 flex-1 text-left">
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
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${getTokenTypeBadgeColor(
                    collection.tokenStandard
                  )}`}
                >
                  {collection.tokenStandard}
                </span>
              </div>
              {(collection.tokenStandard === 'ERC-721' ||
                (collection.tokenStandard === 'ERC-1155' &&
                  collection.tokenId)) && (
                <span className="text-brand-gray200 text-xs font-mono">
                  {ellipsis(collection.contractAddress, 4, 4)}
                  {collection.tokenStandard === 'ERC-1155' &&
                    collection.tokenId && (
                      <>
                        {' '}
                        • #
                        {collection.tokenId.length > 16
                          ? ellipsis(collection.tokenId, 8, 6)
                          : collection.tokenId}
                      </>
                    )}
                </span>
              )}
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
                    collection.symbol,
                    collection.tokenId
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
