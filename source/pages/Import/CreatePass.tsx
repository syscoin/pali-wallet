import React from 'react';
import { useLocation } from 'react-router-dom';

import { PasswordForm } from 'components/index';
import { refreshControllerStatus } from 'hooks/controllerStatus';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';

export const CreatePasswordImport = () => {
  const { controllerEmitter } = useController();
  const { state } = useLocation();

  const { navigate } = useUtils();
  const { phrase, isWalletImported } = state || {};

  const onSubmit = async ({ password }: { password: string }) => {
    await controllerEmitter(['wallet', 'createWallet'], [password, phrase]);
    // Creation changes authentication just like unlock. Discard any cached
    // locked reply before entering protected routes. If confirmation fails,
    // recover through the existing-wallet screen, without repeating creation.
    const confirmed = await refreshControllerStatus();
    navigate(confirmed ? '/home' : '/', {
      state: { isWalletImported },
    });
  };

  return <PasswordForm onSubmit={onSubmit} />;
};
