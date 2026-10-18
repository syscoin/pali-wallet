import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useSearchParams, useLocation } from 'react-router-dom';

import { getHomeBrowsingScope } from '../useHomeBrowsingState';
import { CgImport as ImportIcon } from 'components/Icon/Icon';
import { useRequestScope } from 'hooks/useRequestScope';
import { useUtils } from 'hooks/useUtils';
import {
  selectActiveAccountAndVaultData,
  selectActiveAccountRef,
} from 'state/vault/selectors';
import {
  createBrowsingNavigationContext,
  navigateWithContext,
} from 'utils/index';

import { EvmAssetsList, SyscoinAssetsList } from './components/Assets';

export const AssetsPanel = () => {
  const { t } = useTranslation();
  const { account, assets, activeNetwork, isBitcoinBased } = useSelector(
    selectActiveAccountAndVaultData
  );
  const accountRef = useSelector(selectActiveAccountRef);
  const { chainId } = activeNetwork;
  const [searchParams] = useSearchParams();
  const location = useLocation();

  // Ensure assets exists before filtering
  const ethereumAssets = assets?.ethereum || [];
  const syscoinAssets = assets?.syscoin || [];

  const ethTokensValidation =
    ethereumAssets.filter((token: any) => token?.chainId === chainId)
      ?.length === 0;

  const sysAssetsValidation =
    syscoinAssets.filter((asset) => asset.chainId === chainId)?.length === 0;

  const filterValidation = isBitcoinBased
    ? syscoinAssets.length === 0 || sysAssetsValidation
    : ethereumAssets.length === 0 || ethTokensValidation;

  const { navigate, alert } = useUtils();
  const scope = getHomeBrowsingScope(
    { ...account, ...accountRef },
    activeNetwork,
    isBitcoinBased
  );
  const beginRemoval = useRequestScope(
    JSON.stringify([scope, location.pathname, location.search, location.hash])
  );
  const beginNftDelete = () => {
    const isCurrent = beginRemoval();
    return (error: any) => {
      if (isCurrent())
        alert.error(
          typeof error?.message === 'string'
            ? error.message
            : t('buttons.error')
        );
    };
  };

  const handleImportTokenClick = () => {
    // Create navigation context to preserve home page state
    const returnContext = createBrowsingNavigationContext(location, {
      tab: searchParams.get('tab') || 'assets',
    });

    navigateWithContext(navigate, '/tokens/add', {}, returnContext);
  };

  const NoAssetsComponent = () => (
    <div className="flex mt-8 items-center justify-center p-3 text-brand-white text-sm">
      <p>{t('home.youHaveNoTokens')}</p>
    </div>
  );

  return (
    <div className="pb-8 w-full">
      {filterValidation ? (
        <NoAssetsComponent />
      ) : (
        <ul className="pt-4 mt-6 px-4 w-full text-center text-white text-base bg-bkg-3">
          {isBitcoinBased ? (
            <SyscoinAssetsList />
          ) : (
            <EvmAssetsList scope={scope} onNftDeleteStart={beginNftDelete} />
          )}
        </ul>
      )}
      <button
        type="button"
        onClick={handleImportTokenClick}
        className="flex items-center justify-center mb-9 mt-6 w-full hover:text-brand-deepPink100 text-brand-white font-normal cursor-pointer transition-all duration-300 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-royalblue"
      >
        <ImportIcon
          size={12}
          color="text-brand-white"
          style={{ marginRight: '6px' }}
        />
        <span className="underline text-sm">{t('home.importToken')}</span>
      </button>
    </div>
  );
};
