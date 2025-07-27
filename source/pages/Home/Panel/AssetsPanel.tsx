import React from 'react';
import { useTranslation } from 'react-i18next';
import { CgImport as ImportIcon } from 'react-icons/cg';
import { useSelector } from 'react-redux';
import { useSearchParams } from 'react-router-dom';

import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';
import { createNavigationContext, navigateWithContext } from 'utils/index';

import { EvmAssetsList, SyscoinAssetsList } from './components/Assets';

export const AssetsPanel = () => {
  const { t } = useTranslation();
  const { accountAssets, activeAccount, isBitcoinBased, activeNetwork } =
    useSelector((state: RootState) => state.vault);
  const assets = accountAssets?.[activeAccount.type]?.[activeAccount.id];
  const { chainId } = activeNetwork;
  const [searchParams] = useSearchParams();

  const ethTokensValidation =
    assets?.ethereum?.filter((token: any) => token?.chainId === chainId)
      ?.length === 0;

  const sysAssetsValidation =
    assets?.syscoin?.filter((asset) => asset.chainId === chainId)?.length === 0;

  const filterValidation = isBitcoinBased
    ? assets?.syscoin?.length === 0 || sysAssetsValidation
    : assets?.ethereum?.length === 0 || ethTokensValidation;

  const { navigate } = useUtils();

  const handleImportTokenClick = () => {
    // Create navigation context to preserve home page state
    const returnContext = createNavigationContext(
      '/home',
      searchParams.get('tab') || 'assets', // Preserve the active tab
      {} // No additional state needed for home page
    );

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
          {isBitcoinBased ? <SyscoinAssetsList /> : <EvmAssetsList />}
        </ul>
      )}
      <div className="flex items-center justify-center mb-9 mt-6 w-full hover:text-brand-deepPink100 text-brand-white font-normal cursor-pointer transition-all duration-300">
        <ImportIcon
          size={12}
          color="text-brand-white"
          style={{ marginRight: '6px' }}
        />
        <p className="underline text-sm" onClick={handleImportTokenClick}>
          {t('home.importToken')}
        </p>
      </div>
    </div>
  );
};
