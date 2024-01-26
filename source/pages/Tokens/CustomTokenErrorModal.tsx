import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { ErrorModal } from 'components/Modal';
import { RootState } from 'state/store';

export const CustomTokenErrorModal = ({ errorType, resetErcErrorState }) => {
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const { t } = useTranslation();

  const returnCorrectModal = () => {
    switch (errorType) {
      case 'Undefined':
        return (
          <ErrorModal
            show={Boolean(errorType)}
            title={t('tokens.verifyTheCurrentNetwork')}
            description={t('tokens.verifyTheCurrentNetworkMessage')}
            log={t('tokens.verifyTheCurrentNetworkLog')}
            onClose={() => resetErcErrorState()}
          />
        );
      case 'ERC-1155':
        return (
          <ErrorModal
            show={Boolean(errorType)}
            title="No support for ERC-1155"
            description="Try again using another Token Contract Type."
            log="At the moment we don't support this type of contracts, but we are working to support ERC-1155 as soon as possible."
            onClose={() => resetErcErrorState()}
          />
        );

      case 'Invalid':
        return (
          <ErrorModal
            show={Boolean(errorType)}
            title={t('tokens.invalidContractAddressTitle')}
            description={t('tokens.invalidContractAddressMessage')}
            log={`${t('tokens.invalidContractAddressLog1')} ${
              activeNetwork.label
            }, ${t('tokens.invalidContractAddressLog2')}}`}
            onClose={() => resetErcErrorState()}
          />
        );
      case 'TokenExists':
        return (
          <ErrorModal
            show={Boolean(errorType)}
            title={t('tokens.tokenAlreadyExist')}
            description={t('tokens.verifyTheTokenContract')}
            log={t('tokens.thisTokenContract')}
            onClose={() => resetErcErrorState()}
          />
        );
    }
  };

  return returnCorrectModal();
};
