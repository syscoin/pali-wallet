import React from 'react';
import { useNavigate } from 'react-router-dom';

import { PasswordForm } from 'components/index';
import { logError } from 'utils/index';

export const CreatePass = () => {
  const navigate = useNavigate();

  const onSubmit = ({ password }: { password: string }) => {
    try {
      navigate('/phrase', { state: { password } });
    } catch (error) {
      logError('could not create password', 'UI', error);
    }
  };

  return <PasswordForm onSubmit={onSubmit} />;
};
