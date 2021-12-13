import { useAccount } from 'hooks/useAccount';
import React, { FC } from 'react';
import { PanelList } from './components/PanelList';

interface IActivityPanel {
  show: boolean;
  className: any;
}

export const ActivityPanel: FC<IActivityPanel> = ({
  show,
  className
}) => {
  const { activeAccount } = useAccount();

  return (
    <div className={className}>
      {show ? (
        <PanelList
          data={activeAccount!.transactions}
          activity={true}
          assets={false}
        />
      ) : (
        <>
          <p className="justify-center items-center text-sm text-brand-gray">
            You have no transaction history.
          </p>

          {/* {!changingNetwork && (
            <img src={`/${SyscoinIcon}`} className="w-40 max-w-40 mx-auto mt-8" alt="Syscoin" />
          )} */}
        </>
      )}
    </div>
  );
};
