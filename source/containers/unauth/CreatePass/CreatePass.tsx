import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useController } from 'hooks/index';
import { PasswordForm } from 'components/index';

export const CreatePass = () => {
  const navigate = useNavigate();
  const controller = useController();

  const onSubmit = (data: any) => {
    try {
      controller.wallet.setWalletPassword(data.password);

      navigate('/create/phrase/generated');
    } catch (error) {
      console.log('error', error);
    }
  };

  return <PasswordForm onSubmit={onSubmit} />;
};
