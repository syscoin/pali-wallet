import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { FaucetStatusResponse } from '../../types/faucet';
import errorIcon from 'assets/all_assets/faucet-error.svg';
import loadingIcon from 'assets/all_assets/faucet-loading.svg';
import successIcon from 'assets/all_assets/faucet-success.svg';
import { Button } from 'components/Button';
import { PageActionFooter } from 'components/PageActionFooter';
import { RootState } from 'state/store';
import { INetworkType } from 'types/network';
import { ellipsis } from 'utils/format';

import {
  FaucetApiFeedback,
  FaucetCardAccount,
  FaucetFeedback,
} from './components';
import { useFaucetComponentStates } from './hooks';

export const Faucet: React.FC = () => {
  const { t } = useTranslation();
  const {
    account,
    status,
    handleFaucetButton,
    isLoading,
    faucetRequestDetails,
    errorMessage,
    txHash,
    eligible,
    ready,
  } = useFaucetComponentStates();
  const {
    activeNetwork: { chainId },
  } = useSelector((state: RootState) => state.vault);
  const request = status === FaucetStatusResponse.REQUEST;
  const success = status === FaucetStatusResponse.SUCCESS;
  const error = status === FaucetStatusResponse.ERROR;
  const buttonLabel = request
    ? t('faucet.requestNow')
    : success
    ? t('faucet.Close')
    : error
    ? t('faucet.grabTokens')
    : '';
  if (!eligible) return null;
  const feedback = isLoading
    ? {
        icon: loadingIcon,
        textFeedbackTitle: t('faucet.pleaseWait'),
        textFeedbackDesc: t('faucet.doNotClose'),
      }
    : request
    ? {
        chainId,
        networkKind: INetworkType.Ethereum,
        textFeedbackTitle: faucetRequestDetails.grabText,
        textFeedbackDesc: faucetRequestDetails.tokenQuantity,
      }
    : success
    ? {
        icon: successIcon,
        textFeedbackTitle: t('faucet.CONGRATULATIONS'),
        textFeedbackDesc: t('faucet.someHasJust', {
          tokenSymbol: faucetRequestDetails.tokenSymbol,
          networkName: faucetRequestDetails.networkName,
        }),
      }
    : error
    ? {
        icon: errorIcon,
        textFeedbackTitle: t('faucet.ERROR'),
        textFeedbackDesc: errorMessage,
      }
    : null;
  const feedbackElement = feedback && <FaucetFeedback {...feedback} />;
  return (
    <>
      {isLoading && feedbackElement}
      {!isLoading && (request || success || error) && (
        <>
          {feedbackElement}
          {(request || success) && (
            <FaucetApiFeedback
              {...(request
                ? {
                    apiTitle: t('send.smartContract'),
                    apiResponse: faucetRequestDetails.smartContract,
                  }
                : {
                    apiTitle: t('faucet.transactionHash'),
                    status,
                    apiResponse: txHash,
                  })}
            />
          )}
          {request && (
            <FaucetCardAccount
              accountXpub={account.xpub}
              accountName={account.label}
              accountAddress={ellipsis(account.address, 8, 8)}
            />
          )}
        </>
      )}
      {!isLoading && (
        <PageActionFooter>
          <Button
            variant="neutral"
            className="text-sm text-brand-royalblue"
            type="button"
            fullWidth
            onClick={handleFaucetButton}
            disabled={!ready}
          >
            {buttonLabel}
          </Button>
        </PageActionFooter>
      )}
    </>
  );
};
