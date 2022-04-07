import { Layout } from 'components/Layout';
import { useStore } from 'hooks/useStore';
import * as React from 'react';

import { SendEth } from './SendEth';
import { SendSys } from './SendSys';

export const Send: React.FC = () => {
  const { activeNetwork, networks } = useStore();
  const isSyscoinChain = networks.syscoin[activeNetwork.chainId];

  return (
    <Layout title="SEND SYS" id="sendSYS-title">
      <div className="mt-4">{isSyscoinChain ? <SendSys /> : <SendEth />}</div>
    </Layout>
  );
};
