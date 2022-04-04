import { Layout } from 'components/Layout';
// import { useStore } from 'hooks/useStore';
import * as React from 'react';
// import { SendEth } from './SendEth';
import { SendSys } from './SendSys';

export const Send: React.FC = () => {
  // const { activeNetwork } = useStore();

  return (
    <Layout title="SEND SYS" id="sendSYS-title">
      <div className="mt-4">
        <SendSys />
        {/* <SendEth /> */}
      </div>
    </Layout>
  );
};
