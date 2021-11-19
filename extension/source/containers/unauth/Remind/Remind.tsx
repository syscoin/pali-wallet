import React from 'react';
import { Button, Link } from 'components/index';

import { Layout } from '../../common/Layout';

export const WelcomeWallet = () => {
  return (
    <Layout title={`Let's create a new \n Wallet`}>
      <span>
        {`To create a wallet, you will generate a unique identifier and choose a password. They will allow you to interact with the SYS blockchain.\n
        Note that this software only temporarily stores your wallet information, and only if you choose to. Please make sure to safely back up the wallet information.`}
      </span>
      <Button type="button">
        I'm ready
      </Button>
      <Link to="#">Already have a wallet? Click here</Link>
    </Layout>
  );
};
