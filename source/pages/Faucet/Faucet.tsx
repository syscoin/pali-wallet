import React, { useState } from 'react';

import errorIcon from 'assets/images/faucet-error.svg';
import loadingIcon from 'assets/images/faucet-loading.svg';
import successIcon from 'assets/images/faucet-success.svg';
import { Layout } from 'components/Layout';

import {
  FaucetApiFeedback,
  FaucetCardAccount,
  FaucetFeedback,
} from './Components';
import { FaucetComponentStates } from './Utils';

export const Faucet = () => {
  const [state, setState] = useState(`loading`);
  const { account } = FaucetComponentStates();

  return (
    <Layout title="ROLLUX FAUCET" canGoBack>
      {state === `request` && (
        <>
          <FaucetFeedback
            icon=""
            textFeedbackTitle="Grab $SYS with our faucet to begin experiencing the Rollux network!"
            textFeedbackDesc="You can get 0.001 $SYS per wallet address every 24h."
          />
          <FaucetApiFeedback
            apiTitle="Smart Contract"
            apiResponse="0x35EE5876Db071b527dC62FD3EE3c32e4304d8C23"
          />
          <FaucetCardAccount
            accountImg={account.img}
            accountName={account.label}
            accountAddress={account.address}
          />
        </>
      )}
      {state === `loading` && (
        <>
          <FaucetFeedback
            icon={loadingIcon}
            textFeedbackTitle="Please wait while we work our magic..."
            textFeedbackDesc="Do not close the wallet."
          />
        </>
      )}
      {state === `error` && (
        <>
          <FaucetFeedback
            icon={errorIcon}
            textFeedbackTitle="ERROR!"
            textFeedbackDesc="Please wait 24 hours to request again."
          />
        </>
      )}
      {state === `success` && (
        <>
          <FaucetFeedback
            icon={successIcon}
            textFeedbackTitle="CONGRATULATIONS!"
            textFeedbackDesc="Some TSYS has just been sent to your Rollux wallet."
          />
          <FaucetApiFeedback
            apiTitle="Transaction hash"
            apiResponse="0x89e37b5c5f59aaaba2be8077fe3802b4ccefb84755058d88f7db5df6393ae23a"
          />
        </>
      )}
    </Layout>
  );
};
