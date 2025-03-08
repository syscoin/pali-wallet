import * as React from 'react';
import { FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from 'components/index';

import { AssetsPanel, TransactionsPanel } from './Panel/index';

export const TxsPanel: FC = () => {
  const [isActivity, setActivity] = useState<boolean>(true);
  const { t } = useTranslation();

  return (
    <div className="h-max relative bottom-[19px]  flex flex-col items-center w-full">
      <div className="flex  items-center justify-center w-full text-brand-white text-base border-b border-bkg-1">
        <Button
          className={`flex-1 w-[12.5rem] absolute left-0 p-2 ${
            !isActivity ? 'bg-bkg-3 rounded-tr-[100px]' : 'bg-bkg-1 '
          }`}
          id="assets-btn"
          type="button"
          onClick={() => setActivity(false)}
          // create a disabled state
        >
          {t('buttons.assets')}
        </Button>

        <Button
          className={`flex-1 w-[12.5rem] absolute right-0 p-2 ${
            isActivity ? 'bg-bkg-3 rounded-tl-[100px]' : 'transparent'
          }`}
          id="activity-btn"
          type="button"
          onClick={() => setActivity(true)}
          // create a disabled state
        >
          {t('buttons.activity')}
        </Button>
      </div>

      {isActivity ? <TransactionsPanel /> : <AssetsPanel />}
    </div>
  );
};
