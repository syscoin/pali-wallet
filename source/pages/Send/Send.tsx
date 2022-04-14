import { Layout } from 'components/Layout';
import { useStore } from 'hooks/useStore';
import * as React from 'react';

import { SendSys } from './SendSys';
import { SendEth } from './SendEth';

interface ISend {
  initAddress?: string;
}
export const Send: React.FC<ISend> = () => {
  const { networks, activeNetwork } = useStore();

  const isSyscoinChain = Boolean(networks.syscoin[activeNetwork.chainId]);

  return (
    <Layout
      title={`SEND ${activeNetwork.currency?.toUpperCase()}`}
      id="sendSYS-title"
    >
      {isSyscoinChain ? <SendSys /> : <SendEth />}
    </Layout>
  );
};
