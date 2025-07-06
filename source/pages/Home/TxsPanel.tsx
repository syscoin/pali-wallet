import * as React from 'react';
import { FC, useState, useEffect, startTransition } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation, useSearchParams } from 'react-router-dom';

import { Button } from 'components/index';
import { RootState } from 'state/store';

import { AssetsPanel, TransactionsPanel } from './Panel/index';

export const TxsPanel: FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  // Access network information to determine if Assets tab should be enabled
  const {
    activeNetwork: { chainId },
    isBitcoinBased,
  } = useSelector((state: RootState) => state.vault);

  // Assets tab should only be enabled for Syscoin networks (mainnet: 57, testnet: 5700)
  // Other UTXO networks (Bitcoin, Litecoin, etc.) don't support SPT assets
  const isAssetsTabEnabled =
    !isBitcoinBased || chainId === 57 || chainId === 5700;

  // Check for initial tab from URL params or location state
  const getInitialTab = () => {
    // Force Activity tab if Assets is disabled for this network
    if (!isAssetsTabEnabled) return true; // true = activity tab

    // First check URL search params (?tab=assets)
    const tabParam = searchParams.get('tab');
    if (tabParam === 'assets') return false; // false = assets tab
    if (tabParam === 'activity') return true; // true = activity tab

    // Then check location state (from navigate with state)
    if (location.state?.showAssetsTab) return false;

    // Default to activity tab
    return true;
  };

  const [isActivity, setActivity] = useState<boolean>(getInitialTab);

  // Update tab when URL parameters change
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    startTransition(() => {
      if (tabParam === 'assets' && isAssetsTabEnabled) {
        setActivity(false);
      } else if (tabParam === 'activity' || !isAssetsTabEnabled) {
        setActivity(true);
      }
    });
  }, [searchParams, isAssetsTabEnabled]);

  // Handlers for tab switching with transitions
  const handleShowAssets = () => {
    // Don't allow switching to Assets if it's disabled for this network
    if (!isAssetsTabEnabled) return;

    startTransition(() => {
      setActivity(false);
    });
  };

  const handleShowActivity = () => {
    startTransition(() => {
      setActivity(true);
    });
  };

  return (
    <div className="h-max relative bottom-[19px]  flex flex-col items-center w-full">
      <div className="flex items-center justify-center w-full text-brand-white text-base border-b border-bkg-1">
        <Button
          className={`flex-1 w-[12.5rem] absolute left-0 p-2 ${
            !isAssetsTabEnabled
              ? 'bg-bkg-1 opacity-50 cursor-not-allowed'
              : !isActivity
              ? 'bg-bkg-3 rounded-tr-[100px]'
              : 'bg-bkg-1'
          }`}
          id="assets-btn"
          type="button"
          onClick={handleShowAssets}
          disabled={!isAssetsTabEnabled}
        >
          {t('buttons.assets')}
        </Button>

        <Button
          className={`flex-1 w-[12.5rem] absolute right-0 p-2 ${
            isActivity ? 'bg-bkg-3 rounded-tl-[100px]' : 'transparent'
          }`}
          id="activity-btn"
          type="button"
          onClick={handleShowActivity}
        >
          {t('buttons.activity')}
        </Button>
      </div>

      {isActivity || !isAssetsTabEnabled ? (
        <TransactionsPanel />
      ) : (
        <AssetsPanel />
      )}
    </div>
  );
};
