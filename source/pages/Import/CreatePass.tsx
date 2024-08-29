import React from 'react';
import { useLocation } from 'react-router-dom';

import { PasswordForm } from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';

export const CreatePasswordImport = () => {
  const { controllerEmitter } = useController();
  const { state } = useLocation();

  const { navigate } = useUtils();
  const { phrase, isWalletImported } = state || {};

  const next = () =>
    navigate('/home', {
      state: { isWalletImported },
    });

  const onSubmit = async ({ password }: { password: string }) => {
    await controllerEmitter(['wallet', 'createWallet'], [password, phrase]);

    next();
  };

  return <PasswordForm onSubmit={onSubmit} />;
};
