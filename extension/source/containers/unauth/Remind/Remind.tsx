import React from 'react';
import clsx from 'clsx';
import Button from 'components/Button';
import Link from 'components/Link';

import Layout from '../../common/Layout';

import styles from './Remind.scss';

const WelcomeWallet = () => {
  return (
    <Layout title={`Let's create a new \n Wallet`} linkTo="/app.html" showLogo>
      <span className={clsx('body-caption', styles.description)}>
        {`To create a wallet, you will generate a unique identifier and choose a password. They will allow you to interact with the SYS blockchain.\n
        Note that this software only temporarily stores your wallet information, and only if you choose to. Please make sure to safely back up the wallet information.`}
      </span>
      <Button type="button" variant={styles.ready} linkTo="/create/pass">
        I'm ready
      </Button>
      <Link to="#">Already have a wallet? Click here</Link>
    </Layout>
  );
};

export default WelcomeWallet;
