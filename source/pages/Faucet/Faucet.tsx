import { INetworkType } from '@sidhujag/sysweb3-network';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { FaucetStatusResponse } from '../../types/faucet';
// Import faucet status icons - make sure these paths are correct
import errorIcon from 'assets/all_assets/faucet-error.svg';
import loadingIcon from 'assets/all_assets/faucet-loading.svg';
import successIcon from 'assets/all_assets/faucet-success.svg';
import { NeutralButton } from 'components/Button';
import { RootState } from 'state/store';
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
    faucetButtonLabel,
    isLoading,
    faucetRequestDetails,
    errorMessage,
    txHash,
  } = useFaucetComponentStates();

  const {
    activeNetwork: { chainId },
  } = useSelector((state: RootState) => state.vault);

  const renderFaucetContent = () => {
    switch (status) {
      case FaucetStatusResponse.REQUEST:
        return (
          !isLoading && (
            <>
              <FaucetFeedback
                chainId={chainId}
                networkKind={INetworkType.Ethereum}
                textFeedbackTitle={faucetRequestDetails.grabText}
                textFeedbackDesc={faucetRequestDetails.tokenQuantity}
              />
              <FaucetApiFeedback
                apiTitle={t('send.smartContract')}
                apiResponse={faucetRequestDetails.smartContract}
              />
              <FaucetCardAccount
                accountXpub={account.xpub}
                accountName={account.label}
                accountAddress={ellipsis(account.address, 8, 8)}
              />
            </>
          )
        );
      case FaucetStatusResponse.SUCCESS:
        return (
          !isLoading && (
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
          )
        );
      case FaucetStatusResponse.ERROR:
        return (
          !isLoading && (
            <>
              <FaucetFeedback
                icon={errorIcon}
                textFeedbackTitle={t('faucet.ERROR')}
                textFeedbackDesc={errorMessage}
              />
            </>
          )
        );
      default:
        return null;
    }
  };

  return (
    <>
      {isLoading && (
        <FaucetFeedback
          icon={loadingIcon}
          textFeedbackTitle={t('faucet.pleaseWait')}
          textFeedbackDesc={t('faucet.doNotClose')}
        />
      )}
      {renderFaucetContent()}
      {!isLoading && (
        <div className="w-full px-4 absolute bottom-12 md:static">
          <NeutralButton type="button" fullWidth onClick={handleFaucetButton}>
            {faucetButtonLabel}
          </NeutralButton>
        </div>
      )}
    </>
  );
};
