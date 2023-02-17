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
    if (passed) {
      await controller.wallet.createWallet(password);

      navigate('/home');
    }
  };

  return (
    <>
      {next ? (
        <ConfirmPhrase
          confirmPassed={handleConfirm}
          passed={passed}
          seed={createdSeed}
          setPassed={setPassed}
        />
      ) : (
        <CreatePhrase password={password} />
      )}
    </>
  );
};
