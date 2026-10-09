import React from 'react';
import { useNavigate } from 'react-router-dom';

import { PasswordForm } from 'components/index';
import { useOnboardingSecrets } from 'hooks/useOnboardingSecrets';
import { logError } from 'utils/index';

export const CreatePass = () => {
  const navigate = useNavigate();
  const { beginCreate, clear } = useOnboardingSecrets();

  const onSubmit = ({ password }: { password: string }) => {
    try {
      beginCreate(password);
      navigate('/phrase');
    } catch (error) {
      clear();
      logError('could not create password', 'UI', error);
      throw error;
    }
  };

  return <PasswordForm onSubmit={onSubmit} />;
};
