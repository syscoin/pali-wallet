import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { Layout, Button, Icon } from 'components/index';
import { RootState } from 'state/store';

import { AssetDetails } from './AssetDetails';
import { TransactionDetails } from './TransactionDetails';

export const DetailsView = () => {
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );
  const { t } = useTranslation();

  const {
    state: { id, hash },
  }: any = useLocation();

  const isAsset = id && !hash;

  const { explorer } = activeNetwork;

  const adjustedExplorer = useMemo(
    () => (explorer?.endsWith('/') ? explorer : `${explorer}/`),
    [explorer]
  );

  const openEthExplorer = () => {
    const url = `${adjustedExplorer}${isAsset ? 'address' : 'tx'}/${
      isAsset ? id : hash
    }`;
    window.open(url, '_blank');
  };

  const openSysExplorer = () => {
    window.open(
      `${activeNetwork.url}${isAsset ? 'asset' : 'tx'}/${isAsset ? id : hash}`,
      '_blank'
    );
  };

  const isLoading = (isAsset && !id) || (!isAsset && !hash);

  return (
    <Layout
      title={`${
        isAsset ? t('titles.assetDetails') : t('titles.transactionDetails')
      }`}
    >
      {isLoading ? (
        <Icon name="loading" className="absolute left-1/2 top-1/2 w-3" />
      ) : (
        <>
          <ul className="scrollbar-styled md:max-h-max w-full text-sm overflow-auto">
            {isAsset ? (
              <AssetDetails id={id} />
            ) : (
              <TransactionDetails hash={hash} />
            )}
          </ul>

          {!isAsset ? (
            <div className="fixed bottom-0 left-0 right-0 flex gap-x-6 items-center justify-between mx-auto p-4 w-full text-xs bg-bkg-4 md:bottom-8 md:max-w-2xl">
              <p className="font-normal" style={{ lineHeight: '18px' }}>
                {t('send.viewThis')}{' '}
                {isAsset ? t('send.asset') : t('send.transaction')}{' '}
                {t('send.on')} {isBitcoinBased ? 'Syscoin' : ''}{' '}
                {t('send.explorer')}
              </p>

              <Button
                type="button"
                onClick={isBitcoinBased ? openSysExplorer : openEthExplorer}
                className="inline-flex justify-center px-1.5 py-2 text-bkg-blue200 text-base font-semibold bg-bkg-white850 hover:bg-transparent border border-bkg-white850 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-royalblue focus-visible:ring-offset-2"
              >
                {t('buttons.ok')}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </Layout>
  );
};
