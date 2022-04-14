import * as React from 'react';
import { Layout } from 'components/index';

// import { SendSys } from './SendSys';
import { SendEth } from './SendEth';

interface ISend {
  initAddress?: string;
}
export const Send: React.FC<ISend> = () => (
  <Layout title="SEND SYS" id="sendSYS-title">
    {/* only the style in this branch, the implementation is being finished on fix/send-tx */}

    {/* {isSyscoinChain ? <SendSys /> : <SendEth />} */}

    <SendEth />
  </Layout>
);
