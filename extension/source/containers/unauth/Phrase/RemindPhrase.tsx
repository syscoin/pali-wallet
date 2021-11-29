import React from 'react';
import { Button } from 'components/index';;

import { Layout } from 'containers/common/Layout';

export const RemindPhrase = () => {
  return (
    <Layout title={`Let's create your\nrecovery phrase`}>
      <span className="body-description">
        A recovery phrase is a series of 12 words in a specific order. This word
        combination is unique to your wallet. Make sure to have pen and paper
        ready so you can write it down.
      </span>

      <Button
        type="button"
      >
        Start
      </Button>
    </Layout>
  );
};
