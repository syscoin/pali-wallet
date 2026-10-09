import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';

import { PasswordForm } from 'components/index';
import { AppLoadingSkeleton } from 'components/Loader/AppLoadingSkeleton';
import { refreshControllerStatus } from 'hooks/controllerStatus';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { useOnboardingSecrets } from 'hooks/useOnboardingSecrets';

export const CreatePasswordImport = () => {
  const { controllerEmitter } = useController();
  const { secrets, clear } = useOnboardingSecrets();
  const [created, setCreated] = useState(false);
  const creationRequested = useRef(false);
  const { t } = useTranslation();

  const { navigate, alert } = useUtils();
  const { phrase } = secrets;

  const onSubmit = async ({ password }: { password: string }) => {
    if (creationRequested.current) return;
    creationRequested.current = true;
    setCreated(true);
    clear();
    try {
      await controllerEmitter(
        ['wallet', 'createWallet'],
        [password, phrase],
        10000,
        false
      );
    } catch {
      // The worker may have finished despite a lost acknowledgement. Never
      // replay creation: recover through the authoritative wallet startup.
      alert.error(t('settings.walletSetupFailed'));
      await refreshControllerStatus();
      navigate('/', { replace: true });
      return;
    }
    // Creation changes authentication just like unlock. Discard any cached
    // locked reply before entering protected routes. If confirmation fails,
    // recover through the existing-wallet screen, without repeating creation.
    const confirmed = await refreshControllerStatus();
    navigate(confirmed ? '/home' : '/', {
      state: { isWalletImported: true },
    });
  };

  return created ? (
    <AppLoadingSkeleton />
  ) : secrets.kind === 'import' && phrase ? (
    <PasswordForm onSubmit={onSubmit} />
  ) : (
    <Navigate to="/import" replace />
  );
};
