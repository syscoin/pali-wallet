import React from 'react';
import { useStore, useUtils } from 'hooks/index';
import { PasswordForm } from 'components/index';
import { getController } from 'utils/index';

const CreatePass = () => {
  const controller = getController();

  const { canConnect } = useStore();
  const { navigate } = useUtils();

  const next = () => {
    if (canConnect) {
      navigate('/connect-wallet');

      return;
    }

    navigate('/home');
  };

  const onSubmit = (data: any) => {
    controller.wallet.setWalletPassword(data.password);
    controller.wallet.createWallet(true);

    next();
  };

  return <PasswordForm onSubmit={onSubmit} />;
};

export default CreatePass;
