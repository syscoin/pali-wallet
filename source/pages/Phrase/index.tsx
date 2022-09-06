import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';

import { useUtils } from 'hooks/useUtils';
import { getController } from 'utils/browser';

import { ConfirmPhrase } from './ConfirmPhrase';
import { CreatePhrase } from './CreatePhrase';

export const SeedConfirm = () => {
  const controller = getController();

  const { navigate } = useUtils();

  const [passed, setPassed] = useState<boolean>(false);

  const {
    state: { password, next, createdSeed },
  }: any = useLocation();

  const handleConfirm = async () => {
    await controller.wallet.createWallet(password);

    navigate('/home');

    setPassed(true);
  };

  return (
    <>
      {next && !passed ? (
        <ConfirmPhrase
          confirmPassed={handleConfirm}
          passed={passed}
          seed={createdSeed}
        />
      ) : (
        <CreatePhrase password={password} />
      )}
    </>
  );
};
