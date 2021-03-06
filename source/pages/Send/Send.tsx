import * as React from 'react';

import { Layout } from 'components/index';
import { useStore } from 'hooks/index';

import { SendEth } from './SendEth';
import { SendSys } from './SendSys';

interface ISend {
  initAddress?: string;
}
export const Send: React.FC<ISend> = () => {
  const { networks, activeNetwork } = useStore();

  const isSyscoinChain =
    networks.syscoin[activeNetwork.chainId] &&
    activeNetwork.url.includes('blockbook');

  return (
    <Layout
      title={`SEND ${activeNetwork.currency?.toUpperCase()}`}
      id="sendSYS-title"
    >
      {isSyscoinChain ? <SendSys /> : <SendEth />}
    </Layout>
  );
};
