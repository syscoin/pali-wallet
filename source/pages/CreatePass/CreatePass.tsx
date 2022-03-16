import React from 'react';
import { useNavigate } from 'react-router-dom';
import { PasswordForm } from 'components/index';
import { logError, getController } from 'utils/index';

export const CreatePass = () => {
  const navigate = useNavigate();
  const controller = getController();

  const onSubmit = (data: any) => {
    try {
      controller.wallet.setWalletPassword(data.password);

      navigate('/phrase/create');
    } catch (error) {
      logError('could not create password');
    }
  };

  return <PasswordForm onSubmit={onSubmit} />;
};
