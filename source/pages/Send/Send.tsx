import * as React from 'react';
import { useSelector } from 'react-redux';

import { Layout } from 'components/index';
import { RootState } from 'state/store';

import { SendEth } from './SendEth';
import { SendSys } from './SendSys';

interface ISend {
  initAddress?: string;
}
export const Send: React.FC<ISend> = () => {
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const networks = useSelector((state: RootState) => state.vault.networks);

  const isSyscoinChain =
    networks.syscoin[activeNetwork.chainId] &&
    activeNetwork.url.includes('blockbook');

  return (
    <Layout
      title={`SEND ${activeNetwork.currency?.toUpperCase()}`}
      id="sendSYS-title"
      titleOnly={false}
    >
      {isSyscoinChain ? <SendSys /> : <SendEth />}
    </Layout>
  );
};
