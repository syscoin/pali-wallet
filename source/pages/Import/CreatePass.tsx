import React from 'react';

import { PasswordForm } from 'components/index';
import { useUtils } from 'hooks/index';
import { getController } from 'utils/browser';

const CreatePass = () => {
  const controller = getController();

  const { navigate } = useUtils();

  const next = () => navigate('/home');

  const onSubmit = async ({ password }: { password: string }) => {
    await controller.wallet.createWallet(password);

    next();
  };

  return <PasswordForm onSubmit={onSubmit} />;
};

export default CreatePass;
