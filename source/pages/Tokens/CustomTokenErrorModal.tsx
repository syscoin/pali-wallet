import React from 'react';

import { ErrorModal } from 'components/Modal';

export const CustomTokenErrorModal = ({
  errorType,
  message,
  resetErcErrorState,
}) => {
  const returnCorrectModal = () => {
    switch (errorType) {
      case 'Undefined':
        return (
          <ErrorModal
            show={Boolean(errorType)}
            title="Verify the current network"
            description="This token probably is not available in the current network. Verify the token network and try again."
            log="Token network probably is different from current network."
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
            description="This contract address is not a token contract or is not in the correct network."
            log={message}
            onClose={() => resetErcErrorState()}
          />
        );
    }
  };

  return returnCorrectModal();
};
