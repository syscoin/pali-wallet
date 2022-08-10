import * as React from 'react';
import { useSelector } from 'react-redux';

import { Layout } from 'components/index';
import { RootState } from 'state/store';
import { IVaultState } from 'state/vault/types';

import { SendEth } from './SendEth';
import { SendSys } from './SendSys';

interface ISend {
  initAddress?: string;
}
export const Send: React.FC<ISend> = () => {
  const { activeNetwork, networks }: IVaultState = useSelector(
    (state: RootState) => state.vault
  );

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
