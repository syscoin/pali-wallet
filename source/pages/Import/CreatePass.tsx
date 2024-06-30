import React from 'react';
import { useLocation } from 'react-router-dom';

import { PasswordForm } from 'components/index';
import { useUtils } from 'hooks/index';
import { getController } from 'scripts/Background';
// import { getController } from 'utils/browser';

export const CreatePasswordImport = () => {
  const controller = getController();
  const { state } = useLocation();

  const { navigate } = useUtils();
  const { phrase, isWalletImported } = state || {};

  const next = () =>
    navigate('/home', {
      state: { isWalletImported },
    });

  const onSubmit = async ({ password }: { password: string }) => {
    await controller.wallet.createWallet(password, phrase);

    next();
  };

  return <PasswordForm onSubmit={onSubmit} />;
};
