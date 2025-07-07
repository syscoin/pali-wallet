import { uniqueId } from 'lodash';
import React, {
  Fragment,
  useState,
  useDeferredValue,
  startTransition,
  useEffect,
} from 'react';
import { useTranslation } from 'react-i18next';
import { HiTrash as DeleteIcon } from 'react-icons/hi';
import { RiShareForward2Line as DetailsIcon } from 'react-icons/ri';
import { useSelector } from 'react-redux';
import { useSearchParams, useLocation } from 'react-router-dom';

import { EvmNftsList } from '../Nfts/EvmNftsList';
import { IconButton, TokenIcon } from 'components/index';
import { ConfirmationModal } from 'components/Modal';
import { Tooltip } from 'components/Tooltip';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { ITokenEthProps } from 'types/tokens';
import { truncate, navigateWithContext } from 'utils/index';

import { AssetsHeader } from './AssetsHeader';

interface IDefaultEvmAssets {
  searchValue: string;
  sortByValue: string;
  state: {
    isCoinSelected: boolean;
    searchValue: string;
    sortByValue: string;
  };
}

const DefaultEvmAssets = ({
  searchValue,
  sortByValue,
  state,
}: IDefaultEvmAssets) => {
  const { navigate } = useUtils();
  const { controllerEmitter } = useController();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();

  // Confirmation modal state
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [tokenToDelete, setTokenToDelete] = useState<ITokenEthProps | null>(
    null
  );

  const {
    accountAssets,
    activeAccount,
    activeNetwork: { chainId },
  } = useSelector((rootState: RootState) => rootState.vault);

  const assets = accountAssets[activeAccount.type]?.[activeAccount.id];

  // Separate regular tokens from NFTs as requested
  const allAssets =
    assets?.ethereum?.filter((token) => token.chainId === chainId) || [];
  const currentChainAssets = allAssets.filter((token) => !token.isNft);

  const assetsSorted = (tokens: ITokenEthProps[], sortBy: string) => {
    const sortedAssets = [...tokens]; // Create a copy to avoid mutating original array

    switch (sortBy) {
      case 'Name':
        return sortedAssets.sort(
          (a, b) =>
            a.name?.localeCompare(b.name) ||
            a.tokenSymbol.localeCompare(b.tokenSymbol)
        );
      case 'Balance':
        // Sort by balance in descending order (highest balance first)
        return sortedAssets.sort((a, b) => b.balance - a.balance);
      default:
        return sortedAssets;
    }
  };

  const assetsFilteredBySearch = currentChainAssets.filter((token) => {
    const is1155 = token?.tokenStandard === 'ERC-1155';
    const lowercaseSearchValue = searchValue?.toLowerCase();
    const isHexSearch = searchValue.startsWith('0x');

    if (is1155) {
      const lowercaseName = token.name?.toLowerCase() || '';
      const lowercaseContractAddress = token.contractAddress.toLowerCase();
      if (isHexSearch) {
        return lowercaseContractAddress.includes(lowercaseSearchValue);
      }
      return lowercaseName.includes(lowercaseSearchValue);
    }

    const lowercaseTokenName = token.name?.toLowerCase() || '';
    const lowercaseTokenSymbol = token.tokenSymbol.toLowerCase();
    const lowercaseContractAddress = token.contractAddress.toLowerCase();

    if (isHexSearch) {
      return lowercaseContractAddress.includes(lowercaseSearchValue);
    } else {
      return (
        lowercaseTokenName.includes(lowercaseSearchValue) ||
        lowercaseTokenSymbol.includes(lowercaseSearchValue)
      );
    }
  });

  // Apply filters and sorting in the correct order
  let filteredAssets = currentChainAssets;

  // First apply search filter if there's a search value
  if (searchValue?.length > 0) {
    filteredAssets = assetsFilteredBySearch;
  }

  // Then apply sorting to the filtered results
  if (sortByValue?.length > 0) {
    filteredAssets = assetsSorted(filteredAssets, sortByValue);
  }

  // Delete confirmation handlers
  const handleDeleteClick = (token: ITokenEthProps) => {
    setTokenToDelete(token);
    setShowDeleteConfirmation(true);
  };

  const handleConfirmDelete = () => {
    if (tokenToDelete) {
      controllerEmitter(
        ['wallet', 'deleteTokenInfo'],
        [tokenToDelete.contractAddress, chainId]
      );
    }
    setShowDeleteConfirmation(false);
    setTokenToDelete(null);
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirmation(false);
    setTokenToDelete(null);
  };

  const handleAssetClick = (token: ITokenEthProps) => {
    // Capture current scroll position
    const scrollPosition = window.scrollY || 0;

    const returnContext = {
      returnRoute: '/home',
      tab: searchParams.get('tab') || 'assets',
      scrollPosition,
      state,
    };

    navigateWithContext(
      navigate,
      '/home/details',
      { id: token.id, hash: null },
      returnContext
    );
  };

  return (
    <>
      {filteredAssets?.map((token: ITokenEthProps) => (
        <Fragment key={uniqueId(token.id)}>
          <li className="flex items-center justify-between py-2 text-xs border-b border-dashed border-bkg-white200">
            <div className="flex gap-3 items-center justify-start">
              {!token.isNft && (
                <TokenIcon
                  logo={token.logo}
                  contractAddress={token.contractAddress}
                  symbol={token.tokenSymbol}
                  size={24}
                  className="hover:shadow-md hover:scale-110 transition-all duration-200"
                />
              )}
              {token.isNft && (
                <div
                  className="w-6 h-6 rounded bg-gradient-to-br from-brand-royalblue to-brand-pink200 
                              flex items-center justify-center hover:shadow-md hover:scale-110 
                              transition-all duration-200"
                >
                  <span className="text-white text-xs font-bold">NFT</span>
                </div>
              )}

              {token?.tokenStandard !== 'ERC-1155' && (
                <p className="flex items-center gap-x-2">
                  <span className="text-brand-white">{token.balance}</span>

                  <span
                    className="text-brand-royalbluemedium hover:text-brand-deepPink100 cursor-pointer underline transition-colors duration-200"
                    onClick={() => handleAssetClick(token)}
                  >
                    {`  ${truncate(token.tokenSymbol, 10).toUpperCase()}`}
                  </span>
                </p>
              )}
            </div>

            <div className="flex items-center justify-between overflow-hidden overflow-ellipsis">
              <Tooltip content={t('tooltip.assetDetails')}>
                <IconButton
                  onClick={() => handleAssetClick(token)}
                  className="p-2 hover:bg-brand-royalbluemedium/20 rounded-full transition-colors duration-200"
                  aria-label={`View details for ${token.tokenSymbol} token`}
                >
                  <DetailsIcon
                    size={16}
                    className="text-brand-white hover:text-brand-royalbluemedium transition-colors"
                  />
                </IconButton>
              </Tooltip>

              <Tooltip content={t('tooltip.deleteAsset')}>
                <IconButton
                  onClick={() => handleDeleteClick(token)}
                  className="p-2 hover:bg-red-500/20 rounded-full transition-colors duration-200"
                  aria-label={`Delete ${token.tokenSymbol} token`}
                >
                  <DeleteIcon
                    size={16}
                    className="text-brand-white hover:text-red-500 transition-colors"
                  />
                </IconButton>
              </Tooltip>
            </div>
          </li>
        </Fragment>
      ))}

      <ConfirmationModal
        show={showDeleteConfirmation}
        onClick={handleConfirmDelete}
        onClose={handleCancelDelete}
        title={t('tokens.deleteToken', {
          symbol: tokenToDelete?.tokenSymbol || 'Token',
        })}
        description={t('tokens.confirmDeleteTokenEvm', {
          symbol: tokenToDelete?.tokenSymbol || 'this token',
        })}
        buttonText={t('buttons.delete')}
      />
    </>
  );
};

// todo: create a loading state
export const EvmAssetsList = () => {
  const location = useLocation();

  // Restore state from navigation if available
  const initialIsCoinSelected = location.state?.isCoinSelected ?? true;
  const initialSearchValue = location.state?.searchValue || '';
  const initialSortByValue = location.state?.sortByValue || '';

  const [isCoinSelected, setIsCoinSelected] = useState<boolean>(
    initialIsCoinSelected
  );

  const [searchValue, setSearchValue] = useState<string>(initialSearchValue);
  const [sortByValue, setSortyByValue] = useState<string>(initialSortByValue);

  // Use deferred value for search to keep input responsive
  const deferredSearchValue = useDeferredValue(searchValue);
  const deferredSortByValue = useDeferredValue(sortByValue);

  // Show subtle loading state when deferred values are behind
  const isSearching = searchValue !== deferredSearchValue;
  const isSorting = sortByValue !== deferredSortByValue;

  const { isLoadingAssets } = useSelector(
    (rootState: RootState) => rootState.vaultGlobal.loadingStates
  );
  const { networkStatus } = useSelector(
    (rootState: RootState) => rootState.vaultGlobal
  );

  const isNetworkChanging = networkStatus === 'switching';

  const loadingValidation =
    (isCoinSelected && isLoadingAssets) || isNetworkChanging;

  // Handle navigation state restoration and cleanup
  useEffect(() => {
    if (location.state?.scrollPosition !== undefined) {
      // Restore scroll position
      window.scrollTo(0, location.state.scrollPosition);

      // Clear the navigation state to prevent re-applying on subsequent renders
      if (location.state) {
        window.history.replaceState({}, document.title);
      }
    }
  }, [location.state]);

  // Handle tab switch with transition
  const handleTabSwitch = (isCoin: boolean) => {
    startTransition(() => {
      setIsCoinSelected(isCoin);
    });
  };

  // Pass component state to child components
  const state = {
    isCoinSelected,
    searchValue,
    sortByValue,
  };

  return (
    <>
      {loadingValidation ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-brand-blue500"></div>
        </div>
      ) : (
        <>
          <AssetsHeader
            isCoinSelected={isCoinSelected}
            setIsCoinSelected={handleTabSwitch}
            setSearchValue={setSearchValue}
            setSortyByValue={setSortyByValue}
          />

          <div
            className={`${
              isSearching || isSorting ? 'opacity-75' : ''
            } transition-opacity duration-150`}
          >
            {isCoinSelected ? (
              <DefaultEvmAssets
                searchValue={deferredSearchValue}
                sortByValue={deferredSortByValue}
                state={state}
              />
            ) : (
              <EvmNftsList state={state} />
            )}
          </div>
        </>
      )}
    </>
  );
};
