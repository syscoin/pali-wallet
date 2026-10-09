import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router-dom';

import { AppLoadingSkeleton } from 'components/Loader/AppLoadingSkeleton';
import { refreshControllerStatus } from 'hooks/controllerStatus';
import { useController } from 'hooks/useController';
import { useOnboardingSecrets } from 'hooks/useOnboardingSecrets';
import { useUtils } from 'hooks/useUtils';
import { reloadWalletForRecovery } from 'utils/reloadWalletForRecovery';

import { ConfirmPhrase } from './ConfirmPhrase';
import { CreatePhrase } from './CreatePhrase';

export const SeedConfirm = () => {
  const { controllerEmitter } = useController();

  const { navigate, alert } = useUtils();
  const { t } = useTranslation();

  const [passed, setPassed] = useState<boolean>(false);
  const [created, setCreated] = useState(false);
  const creationRequested = useRef(false);
  const { secrets, clear } = useOnboardingSecrets();
  const { password, phrase: createdSeed } = secrets;
  const { state } = useLocation();
  const next = state?.next === true;

  const handleConfirm = async () => {
    if (passed && !creationRequested.current) {
      creationRequested.current = true;
      setCreated(true);
      clear();
      try {
        await controllerEmitter(
          ['wallet', 'createWallet'],
          [password, createdSeed],
          10000,
          false
        );
      } catch {
        alert.error(t('settings.walletSetupFailed'));
        reloadWalletForRecovery();
        return;
      }

      const confirmed = await refreshControllerStatus();
      if (confirmed) navigate('/home');
      else reloadWalletForRecovery();
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
