import * as React from 'react';
import { FC, useState } from 'react';
import { Button } from 'components/index';

import { ActivityPanel, AssetsPanel } from './Panel/index';

export const TxsPanel: FC = () => {
  const [isActivity, setActivity] = useState<boolean>(true);

  return (
    <div className="flex flex-col items-center w-full h-60 sm:h-72">
      <div className="flex items-center justify-center w-full text-brand-white text-base border-b border-bkg-1">
        <Button
          className={`flex-1 p-2 ${!isActivity ? 'bg-bkg-2' : 'bg-bkg-1'}`}
          id="assets-btn"
          type="button"
          onClick={() => setActivity(false)}
        >
          Assets
        </Button>

        <Button
          className={`flex-1 p-2 ${isActivity ? 'bg-bkg-2' : 'bg-bkg-1'}`}
          id="activity-btn"
          type="button"
          onClick={() => setActivity(true)}
        >
          Activity
        </Button>
      </div>

      {isActivity ? <ActivityPanel /> : <AssetsPanel />}
    </div>
  );
};
