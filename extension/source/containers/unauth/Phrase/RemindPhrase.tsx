import React from 'react';
import Button from 'components/Button';

import Layout from '../../common/Layout';

import styles from './index.scss';

const RemindPhrase = () => {
  return (
    <Layout title={`Let's create your\nrecovery phrase`} linkTo="/create/pass">
      <span className="body-description">
        A recovery phrase is a series of 12 words in a specific order. This word
        combination is unique to your wallet. Make sure to have pen and paper
        ready so you can write it down.
      </span>

      <Button
        type="button"
        variant={styles.start}
        linkTo="/create/phrase/generated"
      >
        Start
      </Button>
    </Layout>
  );
};

export default RemindPhrase;
