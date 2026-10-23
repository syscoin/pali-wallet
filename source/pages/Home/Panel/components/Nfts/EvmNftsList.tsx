import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useSearchParams, useLocation } from 'react-router-dom';

import { AssetSearchEmptyState } from '../Assets/AssetSearchEmptyState';
import { AssetRemovalStart, useAssetRemoval } from '../Assets/useAssetRemoval';
import {
  HiTrash as DeleteIcon,
  RiShareForward2Line as DetailsIcon,
} from 'components/Icon/Icon';
import { IconButton, TokenIcon } from 'components/index';
import { ListLoadMore } from 'components/Loading/ListLoadMore';
import { ConfirmationModal } from 'components/Modal';
import { Tooltip } from 'components/Tooltip';
import { useUtils } from 'hooks/index';
import { useIncrementalList } from 'hooks/useIncrementalList';
import { RootState } from 'state/store';
import { selectActiveAccountAssets } from 'state/vault/selectors';
import {
  truncate,
  createBrowsingNavigationContext,
  navigateWithContext,
  ellipsis,
} from 'utils/index';
import { getNftQuantity } from 'utils/nftQuantity';
import { getNftAssetsFromEthereum } from 'utils/nftToAsset';
import { getTokenTypeBadgeColor } from 'utils/tokens';

interface IEvmNftsListProps {
  onClearSearch?: () => void;
  onDeleteStart?: AssetRemovalStart;
  onVisibleCountChange?: (count: number) => void;
  scope: string;
  state: {
    isCoinSelected: boolean;
    nftsVisibleCount?: number;
    searchValue: string;
    sortByValue: string;
  };
}

export const EvmNftsList = ({
  state,
  onClearSearch,
  onDeleteStart,
  onVisibleCountChange,
  scope,
}: IEvmNftsListProps) => {
  const { navigate } = useUtils();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const location = useLocation();

  const accountAssets = useSelector(selectActiveAccountAssets);
  const chainId = useSelector(
    (rootState: RootState) => rootState.vault.activeNetwork.chainId
  );

  const removal = useAssetRemoval<{
    contractAddress: string;
    name?: string;
    tokenId?: string;
  }>(scope, onDeleteStart);
  const itemToDelete = removal.item;
  const getRemovalLabel = (symbol?: string, tokenId?: string) =>
    tokenId
      ? t('nftDetails.removeNamedTokenId', { symbol, tokenId })
      : t('nftDetails.deleteNamedCollection', { symbol });

  // NFTs now come through regular asset updates, no need for separate fetching

  // Handle delete clicks
  const handleDeleteCollection = (
    contractAddress: string,
    symbol: string,
    tokenId?: string
  ) => {
    removal.open({
      contractAddress,
      name: symbol, // Using symbol but keeping 'name' field for consistency with modal
      tokenId,
    });
  };

  const handleConfirmDelete = () => {
    if (itemToDelete)
      return removal.remove([
        itemToDelete.contractAddress,
        chainId,
        itemToDelete.tokenId,
      ]);
  };

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
        name: nft.name || t('send.nftCollection'),
        symbol: nft.tokenSymbol || 'NFT', // Use tokenSymbol for display
        tokenStandard: nft.tokenStandard || 'ERC-721',
        chainId: nft.chainId,
        totalBalance: nft.balance, // This is already the total count
        tokenId: nft.tokenId,
        logo: nft.logo, // Include logo if available
        ...getNftQuantity(nft),
      })),
    [nftAssets, t]
  );

  const filteredCollections = useMemo(() => {
    const search = state.searchValue.trim().toLowerCase();
    const filtered = search
      ? collections.filter((collection) =>
          [
            collection.name,
            collection.symbol,
            collection.contractAddress,
            collection.tokenId,
          ].some((value) =>
            String(value ?? '')
              .toLowerCase()
              .includes(search)
          )
        )
      : collections;
    if (state.sortByValue === 'Name') {
      return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
    }
    if (state.sortByValue === 'Balance') {
      return [...filtered].sort((a, b) =>
        a.exactQuantity !== undefined && b.exactQuantity !== undefined
          ? b.exactQuantity.length - a.exactQuantity.length ||
            (b.exactQuantity > a.exactQuantity
              ? 1
              : b.exactQuantity < a.exactQuantity
              ? -1
              : 0)
          : Number(b.totalBalance) - Number(a.totalBalance)
      );
    }
    return filtered;
  }, [collections, state.searchValue, state.sortByValue]);
  const { visibleItems, visibleCount, hasMore, showMore } = useIncrementalList(
    filteredCollections,
    JSON.stringify([scope, state.searchValue, state.sortByValue]),
    state.nftsVisibleCount
  );

  // NFTs are automatically updated through regular asset polling

  const handleNftClick = (collection: any) => {
    const returnContext = createBrowsingNavigationContext(location, {
      tab: searchParams.get('tab') || 'assets',
      homeAssets: { ...location.state?.homeAssets, value: state },
    });

    navigateWithContext(
      navigate,
      '/home/details',
      { id: collection.id, hash: null },
      returnContext
    );
  };

  if (filteredCollections.length === 0) {
    if (collections.length > 0 && state.searchValue.trim())
      return <AssetSearchEmptyState onClearSearch={onClearSearch} />;
    // Parent AssetsPanel renders the Import Token link below this list
    return (
      <div className="flex mt-4 items-center justify-center p-3 text-brand-white text-sm">
        <p>{t('home.youHaveNoNfts')}</p>
      </div>
    );
  }

  return (
    <>
      {visibleItems.map((collection) => (
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
                <span
                  className="text-brand-white"
                  title={collection.exactQuantity}
                >
                  {collection.quantity === undefined ? (
                    t('settings.unavailable')
                  ) : (
                    <>
                      {collection.quantity}{' '}
                      {collection.isSingle
                        ? t('nftDetails.item')
                        : t('nftDetails.items')}
                    </>
                  )}
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
                aria-label={t('nftDetails.viewNamedCollection', {
                  symbol: collection.symbol,
                })}
              >
                <DetailsIcon
                  size={16}
                  className="text-brand-white hover:text-brand-royalbluemedium transition-colors"
                />
              </IconButton>
            </Tooltip>

            <Tooltip
              content={
                collection.tokenId
                  ? getRemovalLabel(collection.symbol, collection.tokenId)
                  : t('send.deleteCollection')
              }
            >
              <IconButton
                onClick={() =>
                  handleDeleteCollection(
                    collection.contractAddress,
                    collection.symbol,
                    collection.tokenId
                  )
                }
                className="p-2 hover:bg-red-500/20 rounded-full transition-colors duration-200"
                aria-label={getRemovalLabel(
                  collection.symbol,
                  collection.tokenId
                )}
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

      {hasMore && (
        <ListLoadMore
          onClick={() => {
            showMore();
            onVisibleCountChange?.(visibleCount + 50);
          }}
          shown={visibleItems.length}
          total={filteredCollections.length}
        />
      )}
      <ConfirmationModal
        show={Boolean(itemToDelete)}
        onClick={handleConfirmDelete}
        onClose={removal.close}
        title={
          itemToDelete?.tokenId
            ? getRemovalLabel(itemToDelete.name, itemToDelete.tokenId)
            : t('send.deleteCollection')
        }
        description={`${
          itemToDelete?.tokenId
            ? t('nftDetails.removeTokenIdConfirm', {
                name: itemToDelete.name,
                tokenId: itemToDelete.tokenId,
              })
            : t('send.deleteCollectionConfirm', {
                name: itemToDelete?.name,
              })
        } ${t('settings.contractAddress')}: ${
          itemToDelete?.contractAddress || ''
        }`}
        buttonText={t('buttons.delete')}
        isButtonLoading={removal.pending}
      />
    </>
  );
};
