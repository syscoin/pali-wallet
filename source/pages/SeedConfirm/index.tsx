import React, { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { AppLoadingSkeleton } from 'components/Loader/AppLoadingSkeleton';
import { refreshControllerStatus } from 'hooks/controllerStatus';
import { useController } from 'hooks/useController';
import { useOnboardingSecrets } from 'hooks/useOnboardingSecrets';
import { useUtils } from 'hooks/useUtils';

import { ConfirmPhrase } from './ConfirmPhrase';
import { CreatePhrase } from './CreatePhrase';

export const SeedConfirm = () => {
  const { controllerEmitter } = useController();

  const { navigate } = useUtils();

  const [passed, setPassed] = useState<boolean>(false);
  const [created, setCreated] = useState(false);
  const { secrets, clear } = useOnboardingSecrets();
  const { password, phrase: createdSeed } = secrets;
  const { state } = useLocation();
  const next = state?.next === true;

  const handleConfirm = async () => {
    if (passed) {
      await controllerEmitter(
        ['wallet', 'createWallet'],
        [password, createdSeed]
      );
      setCreated(true);
      clear();

      const confirmed = await refreshControllerStatus();
      navigate(confirmed ? '/home' : '/');
    }
  };
  if (created) return <AppLoadingSkeleton />;
  if (secrets.kind !== 'create' || !password || (next && !createdSeed)) {
    return <Navigate to="/create-password" replace />;
  }

  return (
    <>
      {next ? (
        <ConfirmPhrase
          confirmPassed={handleConfirm}
          passed={passed}
          seed={createdSeed}
          setPassed={setPassed}
        />
      ) : (
        <CreatePhrase />
      )}
    </>
  );
};
