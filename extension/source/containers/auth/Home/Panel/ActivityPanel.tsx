import { useAccount } from 'hooks/useAccount';
import React, { FC, useEffect } from 'react';
import { PanelList } from './components/PanelList';

interface IActivityPanel {
  show: boolean;
  className: any;
}
const dataFAke = [
  {
    account: '0x3126...7d3864c983',
    status: 'Pending',
    hour: '2:55AM',
    stp: 'SPT Update',
  },
  {
    account: '0x3126...7d3864c983',
    status: 'Pending',
    hour: '5:23PM',
    stp: 'SPT Update',
  },
  {
    account: '0x3126...7d3864c983',
    status: 'Completed',
    hour: '7:12PM',
    stp: 'SPT Update',
  },
];

export const ActivityPanel: FC<IActivityPanel> = ({
  show,
  className
}) => {
  const { activeAccount } = useAccount();

  useEffect(() => {
    console.log(activeAccount?.transactions, activeAccount)
  }, [])
  
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
