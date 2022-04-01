import React, { useEffect } from 'react';
import { Header, Icon, Button } from 'components/index';
import { useStore, usePrice, useUtils } from 'hooks/index';
import { formatNumber } from 'utils/index';

import { TxsPanel } from './TxsPanel';

export const Home = () => {
  const { getFiatAmount } = usePrice();

  const { navigate, handleRefresh } = useUtils();

  const { accounts, activeNetwork, fiat, activeAccount, lastLogin } =
    useStore();

  useEffect(() => {
    if (accounts && activeAccount) handleRefresh();
  }, [accounts, activeAccount]);

  return (
    <div className="scrollbar-styled h-full bg-bkg-3 overflow-auto">
      <div className="fixed z-20 flex items-center justify-center w-full min-w-popup h-full min-h-popup bg-bkg-2">
        <Icon name="loading" className="ml-2 w-4 text-brand-white" />
      </div>
    </div>
  );
};
