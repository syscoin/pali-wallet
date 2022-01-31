import * as React from 'react';
import { FC, useState } from 'react';
import { Button } from 'components/index';

import { ActivityPanel, AssetsPanel } from './Panel/index';

export const TxsPanel: FC = () => {
  const [isActivity, setActivity] = useState<boolean>(true);

  return (
    <div className="h-60 sm:h-72 w-full flex items-center flex-col">
      <div className="w-full text-base text-brand-white border-b border-bkg-1 flex justify-center items-center">
        <Button
          className={`flex-1 p-2 ${!isActivity ? 'bg-bkg-3' : 'bg-bkg-1'}`}
          id="assets-btn"
          type="button"
          onClick={() => setActivity(false)}
        >
          Assets
        </Button>

        <Button
          className={`flex-1 p-2 ${isActivity ? 'bg-bkg-3' : 'bg-bkg-1'}`}
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
