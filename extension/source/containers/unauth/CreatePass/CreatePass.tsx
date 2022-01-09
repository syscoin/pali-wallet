import React from 'react';
import { useHistory } from 'react-router-dom';
import { useController } from 'hooks/index';
import { PasswordForm } from 'components/index';

export const CreatePass = () => {
  const history = useHistory();
  const controller = useController();

  const onSubmit = (data: any) => {
    try {
      controller.wallet.setWalletPassword(data.password);

      history.push('/create/phrase/generated');
    } catch (error) {
      console.log('error', error);
    }
  };

  return (
    <PasswordForm onSubmit={onSubmit} />
  );
};
