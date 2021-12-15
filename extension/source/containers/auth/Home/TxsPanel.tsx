import * as React from 'react';
import {
  FC,
  useState
} from 'react';
import { Button } from 'components/index';
import { ActivityPanel, AssetsPanel } from "./Panel/index";

export const TxsPanel: FC = () => {
  const [isActivity, setActivity] = useState<boolean>(true);

  return (
    <div className="h-60 w-full flex items-center flex-col">
      <div className="w-full text-base text-brand-white flex justify-center items-center">
        <Button
          className={`flex-1 p-2 ${!isActivity ? 'bg-brand-navyborder' : 'bg-brand-navydarker'}`}
          type="button"
          noStandard
          onClick={() => setActivity(false)}
        >
          Assets
        </Button>

        <Button
          className={`flex-1 p-2 ${isActivity ? 'bg-brand-navyborder' : 'bg-brand-navydarker'}`}
          type="button"
          noStandard
          onClick={() => setActivity(true)}
        >
          Activity
        </Button>
      </div>

      {isActivity ? (
        <ActivityPanel />
      ) : (
        <AssetsPanel />
      )}

    </div>
  );
};
