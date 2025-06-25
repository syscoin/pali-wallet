import * as React from 'react';
import { FC, useState, useEffect, startTransition } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useSearchParams } from 'react-router-dom';

import { Button } from 'components/index';

import { AssetsPanel, TransactionsPanel } from './Panel/index';

export const TxsPanel: FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  // Check for initial tab from URL params or location state
  const getInitialTab = () => {
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
      if (tabParam === 'assets') {
        setActivity(false);
      } else if (tabParam === 'activity') {
        setActivity(true);
      }
    });
  }, [searchParams]);

  // Handlers for tab switching with transitions
  const handleShowAssets = () => {
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
      <div className="flex  items-center justify-center w-full text-brand-white text-base border-b border-bkg-1">
        <Button
          className={`flex-1 w-[12.5rem] absolute left-0 p-2 ${
            !isActivity ? 'bg-bkg-3 rounded-tr-[100px]' : 'bg-bkg-1 '
          }`}
          id="assets-btn"
          type="button"
          onClick={handleShowAssets}
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

      {isActivity ? <TransactionsPanel /> : <AssetsPanel />}
    </div>
  );
};
