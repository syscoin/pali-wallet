import React from 'react';
import { useUtils } from 'hooks/index';
import { PasswordForm } from 'components/index';
import { getController } from 'utils/browser';

const CreatePass = () => {
  const controller = getController();

  const { navigate } = useUtils();

  const next = () => navigate('/home');

  const onSubmit = (data: any) => {
    controller.wallet.setWalletPassword(data.password);
    controller.wallet.createWallet(true);

    next();
  };

  return <PasswordForm onSubmit={onSubmit} />;
};

export default CreatePass;
