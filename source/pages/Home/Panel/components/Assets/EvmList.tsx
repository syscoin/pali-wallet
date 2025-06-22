import { uniqueId } from 'lodash';
import React, { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HiTrash as DeleteIcon } from 'react-icons/hi';
import {
  RiEditLine as EditIcon,
  RiShareForward2Line as DetailsIcon,
} from 'react-icons/ri';
import { useSelector } from 'react-redux';

import { EvmNftsList } from '../Nfts/EvmNftsList';
import { ConfirmationModal } from 'components/Modal';
import { Tooltip } from 'components/Tooltip';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { ITokenEthProps } from 'types/tokens';
import { truncate } from 'utils/index';

import { AssetsHeader } from './AssetsHeader';

interface IDefaultEvmAssets {
  searchValue: string;
  sortByValue: string;
}

const DefaultEvmAssets = ({ searchValue, sortByValue }: IDefaultEvmAssets) => {
  const { navigate } = useUtils();
  const { controllerEmitter } = useController();
  const { t } = useTranslation();

  // Confirmation modal state
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [tokenToDelete, setTokenToDelete] = useState<ITokenEthProps | null>(
    null
  );

  const {
    accountAssets,
    activeAccount,
    activeNetwork: { chainId },
  } = useSelector((state: RootState) => state.vault);

  const assets = accountAssets[activeAccount.type]?.[activeAccount.id];

  const currentChainAssets =
    assets?.ethereum?.filter((token) => token.chainId === chainId) || [];

  const assetsSorted = (sortBy: string) => {
    switch (sortBy) {
      case 'Name':
        return currentChainAssets.sort(
          (a, b) =>
            a.name.localeCompare(b.name) ||
            a.tokenSymbol.localeCompare(b.tokenSymbol)
        );
      case 'Balance':
        return currentChainAssets.sort((a, b) => a.balance - b.balance);
      default:
        return currentChainAssets;
    }
  };

  const assetsFilteredBySearch = currentChainAssets.filter((token) => {
    const is1155 = token?.is1155;
    const lowercaseSearchValue = searchValue?.toLowerCase();
    const isHexSearch = searchValue.startsWith('0x');

    if (is1155) {
      const lowercaseCollectionName = token.collectionName.toLowerCase();
      const lowercaseContractAddress = token.contractAddress.toLowerCase();
      if (isHexSearch) {
        return lowercaseContractAddress.includes(lowercaseSearchValue);
      }
      return lowercaseCollectionName.includes(lowercaseSearchValue);
    }

    const lowercaseTokenName = token.name.toLowerCase();
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

  const assetsSortedBy = assetsSorted(sortByValue);

  let filteredAssets = currentChainAssets;

  if (searchValue?.length > 0) {
    filteredAssets = assetsFilteredBySearch;
  } else if (sortByValue?.length > 0) {
    filteredAssets = assetsSortedBy;
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
        [tokenToDelete.contractAddress]
      );
    }
    setShowDeleteConfirmation(false);
    setTokenToDelete(null);
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirmation(false);
    setTokenToDelete(null);
  };

  return (
    <>
      {filteredAssets?.map((token: ITokenEthProps) => {
        const btnContainerWidth = token?.is1155 === undefined ? 'w-16' : 'w-10';
        return (
          <Fragment key={uniqueId(token.id)}>
            <li className="flex items-center justify-between py-2 text-xs border-b border-dashed border-bkg-white200">
              <div className="flex gap-3 items-center justify-start">
                {!token.isNft && token.logo && (
                  <div style={{ maxWidth: '25px', maxHeight: '25px' }}>
                    <img src={`${token.logo}`} alt={`${token.name} Logo`} />
                  </div>
                )}
                {token.isNft && token?.is1155 && (
                  <p className="font-rubik">
                    <span className="text-button-primary font-poppins">
                      {`- ${token.collectionName}`}
                    </span>
                  </p>
                )}

                {token?.is1155 === undefined && (
                  <p className="flex items-center gap-x-2">
                    <span className="text-brand-white">{token.balance}</span>

                    <span className="text-brand-royalbluemedium">
                      {`  ${truncate(token.tokenSymbol, 10).toUpperCase()}`}
                    </span>
                  </p>
                )}
              </div>

              <div
                className={`flex items-center justify-between ${btnContainerWidth}`}
              >
                <Tooltip content={t('tooltip.assetDetails')}>
                  <DetailsIcon
                    className="cursor-pointer hover:text-fields-input-borderfocus"
                    color="text-brand-white"
                    size={16}
                    onClick={() =>
                      navigate('/home/details', {
                        state: { id: token.id, hash: null },
                      })
                    }
                  />
                </Tooltip>

                {token?.is1155 === undefined && (
                  <Tooltip content={t('tooltip.editAsset')}>
                    <EditIcon
                      className="cursor-pointer hover:text-fields-input-borderfocus"
                      color="text-brand-white"
                      size={16}
                      onClick={() =>
                        navigate('/tokens/add', {
                          state: token,
                        })
                      }
                    />
                  </Tooltip>
                )}

                <Tooltip content={t('tooltip.deleteAsset')}>
                  <DeleteIcon
                    className="cursor-pointer hover:text-fields-input-borderfocus"
                    color="text-brand-white"
                    size={16}
                    onClick={() => handleDeleteClick(token)}
                  />
                </Tooltip>
              </div>
            </li>
          </Fragment>
        );
      })}

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
  const [isCoinSelected, setIsCoinSelected] = useState<boolean>(true);

  const [searchValue, setSearchValue] = useState<string>('');
  const [sortByValue, setSortyByValue] = useState<string>('');

  const { isLoadingAssets } = useSelector((state: RootState) => state.vault);
  const { networkStatus } = useSelector(
    (state: RootState) => state.vaultGlobal
  );

  const isNetworkChanging = networkStatus === 'switching';

  const loadingValidation =
    (isCoinSelected && isLoadingAssets) || isNetworkChanging;

  return (
    <>
      {loadingValidation ? (
        <div className="flex flex-col items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-brand-blue500"></div>
          <p className="text-brand-gray300 text-sm mt-2">
            {isNetworkChanging ? 'Switching network...' : 'Loading assets...'}
          </p>
        </div>
      ) : (
        <>
          <AssetsHeader
            isCoinSelected={isCoinSelected}
            setIsCoinSelected={setIsCoinSelected}
            setSearchValue={setSearchValue}
            setSortyByValue={setSortyByValue}
          />

          {isCoinSelected ? (
            <DefaultEvmAssets
              searchValue={searchValue}
              sortByValue={sortByValue}
            />
          ) : (
            <EvmNftsList />
          )}
        </>
      )}
    </>
  );
};
