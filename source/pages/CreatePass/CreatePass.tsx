import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useController } from 'hooks/index';
import { PasswordForm } from 'components/index';
import { logError } from 'source/utils';

export const CreatePass = () => {
  const navigate = useNavigate();
  const controller = useController();

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
