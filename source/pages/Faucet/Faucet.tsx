import React from 'react';
import { useTranslation } from 'react-i18next';

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
import { FaucetStatusResponse } from './Types';
import { FaucetComponentStates } from './Utils/FaucetComponentStates';
import { useHandleNetworkTokenNames } from './Utils/NetworksInfos';

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
  const { t } = useTranslation();
  const { networkName } = useHandleNetworkTokenNames();

  return (
    <Layout title={networkName} canGoBack>
      {status === FaucetStatusResponse.REQUEST && !isLoading && (
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
            accountAddress={ellipsis(account.address, 8, 8)}
          />
        </>
      )}
      {isLoading && (
        <>
          <FaucetFeedback
            icon={loadingIcon}
            textFeedbackTitle={t('faucet.pleaseWait')}
            textFeedbackDesc={t('faucet.doNotClose')}
          />
        </>
      )}
      {status === FaucetStatusResponse.ERROR && !isLoading && (
        <>
          <FaucetFeedback
            icon={errorIcon}
            textFeedbackTitle={t('faucet.ERROR')}
            textFeedbackDesc={errorMessage}
          />
        </>
      )}
      {status === FaucetStatusResponse.SUCCESS && !isLoading && (
        <>
          <FaucetFeedback
            icon={successIcon}
            textFeedbackTitle={t('faucet.CONGRATULATIONS')}
            textFeedbackDesc={t('faucet.someHasJust', {
              tokenSymbol: faucetRequestDetails.tokenSymbol,
              networkName: faucetRequestDetails.networkName,
            })}
          />
          <FaucetApiFeedback
            apiTitle={t('faucet.transactionHash')}
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
