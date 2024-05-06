import React from 'react';

import errorIcon from 'assets/images/faucet-error.svg';
import loadingIcon from 'assets/images/faucet-loading.svg';
import successIcon from 'assets/images/faucet-success.svg';
import { NeutralButton } from 'components/Button';
import { Layout } from 'components/Layout';
import { ellipsis } from 'utils/format';

import {
  FaucetApiFeedback,
  FaucetCardAccount,
  FaucetFeedback,
} from './Components';
import { FaucetComponentStates } from './Utils/FaucetComponentStates';

export const Faucet = () => {
  const {
    account,
    status,
    handleFaucetButton,
    faucetButtonLabel,
    isLoading,
    faucetRequestDetails,
    errorMessage,
    txHash,
  } = FaucetComponentStates();

  return (
    <Layout title="ROLLUX FAUCET" canGoBack>
      {status === `request` && !isLoading && (
        <>
          <FaucetFeedback
            icon={faucetRequestDetails.icon}
            textFeedbackTitle={faucetRequestDetails.grabText}
            textFeedbackDesc={faucetRequestDetails.tokenQuantity}
          />
          <FaucetApiFeedback
            apiTitle="Smart Contract"
            apiResponse={faucetRequestDetails.smartContract}
          />
          <FaucetCardAccount
            accountImg={account.img}
            accountName={account.label}
            accountAddress={ellipsis(account.address, 4, 4)}
          />
        </>
      )}
      {isLoading && (
        <>
          <FaucetFeedback
            icon={loadingIcon}
            textFeedbackTitle="Please wait while we work our magic..."
            textFeedbackDesc="Do not close the wallet."
          />
        </>
      )}
      {status === `error` && !isLoading && (
        <>
          <FaucetFeedback
            icon={errorIcon}
            textFeedbackTitle="ERROR!"
            textFeedbackDesc={errorMessage}
          />
        </>
      )}
      {status === `success` && !isLoading && (
        <>
          <FaucetFeedback
            icon={successIcon}
            textFeedbackTitle="CONGRATULATIONS!"
            textFeedbackDesc={`Some ${faucetRequestDetails.tokenSymbol} has just been sent to your ${faucetRequestDetails.networkName} wallet.`}
          />
          <FaucetApiFeedback
            apiTitle="Transaction hash"
            status={status}
            apiResponse={txHash}
          />
        </>
      )}
      {!isLoading && (
        <div className="w-full px-4 absolute bottom-12 md:static">
          <NeutralButton type="button" fullWidth onClick={handleFaucetButton}>
            {faucetButtonLabel}
          </NeutralButton>
        </div>
      )}
    </Layout>
  );
};
