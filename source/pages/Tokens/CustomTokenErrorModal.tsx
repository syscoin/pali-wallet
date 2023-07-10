import React from 'react';
import { useSelector } from 'react-redux';

import { ErrorModal } from 'components/Modal';
import { RootState } from 'state/store';

export const CustomTokenErrorModal = ({
  errorType,
  message,
  resetErcErrorState,
}) => {
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  const returnCorrectModal = () => {
    switch (errorType) {
      case 'Undefined':
        return (
          <ErrorModal
            show={Boolean(errorType)}
            title="Verify the current network"
            description="This token probably is not available in the current network. Verify the token network and try again."
            log="Invalid contract address. Verify the current contract address."
            onClose={() => resetErcErrorState()}
          />
        );
      case 'ERC-1155':
        return (
          <ErrorModal
            show={Boolean(errorType)}
            title="No support for ERC-1155"
            description="At the moment we don't support this type of contracts, but we are working to support ERC-1155 as soon as possible."
            log={message}
            onClose={() => resetErcErrorState()}
          />
        );

      case 'Invalid':
        return (
          <ErrorModal
            show={Boolean(errorType)}
            title="Invalid Contract Address"
            description="This contract address is not a token contract."
            log={`This contract is not from a  valid token on ${activeNetwork.label} , verify it further and in case you sure is a token contact us through our support channels `}
            onClose={() => resetErcErrorState()}
          />
        );
      case 'TokenExists':
        return (
          <ErrorModal
            show={Boolean(errorType)}
            title="Token Already Exists"
            description="Verify the token contract address."
            log="This token contract is already added in your token list. Try again using another token address!"
            onClose={() => resetErcErrorState()}
          />
        );
    }
  };

  return returnCorrectModal();
};
