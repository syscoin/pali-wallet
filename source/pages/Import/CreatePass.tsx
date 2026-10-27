import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';

import { Button, PasswordForm } from 'components/index';
import { OnboardingLayout } from 'components/Layout/OnboardingLayout';
import { AppLoadingSkeleton } from 'components/Loader/AppLoadingSkeleton';
import { refreshControllerStatus } from 'hooks/controllerStatus';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { useOnboardingSecrets } from 'hooks/useOnboardingSecrets';
import { reloadWalletForRecovery } from 'utils/reloadWalletForRecovery';

export const CreatePasswordImport = () => {
  const { controllerEmitter } = useController();
  const { secrets, clear, consumeContinuation } = useOnboardingSecrets();
  const [created, setCreated] = useState(false);
  const [recoveryFailed, setRecoveryFailed] = useState(false);
  const creationRequested = useRef(false);
  const mounted = useRef(true);
  const { t } = useTranslation();

  const { navigate, alert } = useUtils();
  const { phrase, recoveryTicket } = secrets;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const onSubmit = async ({ password }: { password: string }) => {
    if (creationRequested.current) return;
    creationRequested.current = true;
    setCreated(true);
    clear();
    try {
      await controllerEmitter(
        ['wallet', recoveryTicket ? 'recoverWalletFromSeed' : 'createWallet'],
        recoveryTicket
          ? [password, phrase, recoveryTicket]
          : [password, phrase],
        10000,
        false
      );
    } catch {
      if (!mounted.current) return;
      // The worker may have finished despite a lost acknowledgement. Never
      // replay creation: recover through the authoritative wallet startup.
      if (recoveryTicket) {
        setRecoveryFailed(true);
        return;
      }
      alert.error(t('settings.walletSetupFailed'));
      reloadWalletForRecovery();
      return;
    }
    if (!mounted.current) return;
    // Creation changes authentication just like unlock. Discard any cached
    // locked reply before entering protected routes. If confirmation fails,
    // recover through the existing-wallet screen, without repeating creation.
    const confirmed = await refreshControllerStatus();
    if (!mounted.current) return;
    if (confirmed) {
      const destination = consumeContinuation();
      if (destination) navigate(destination, { replace: true });
      else navigate('/home', { state: { isWalletImported: true } });
    } else {
      reloadWalletForRecovery();
    }
  };

  return recoveryFailed ? (
    <OnboardingLayout title={t('settings.recoveryTitle')}>
      <p role="alert" className="mb-6 text-brand-gray200 text-center text-sm">
        {t('settings.walletRecoveryUnconfirmed')}
      </p>
      <Button
        id="recovery-check-wallet"
        variant="primary"
        type="button"
        onClick={reloadWalletForRecovery}
      >
        {t('buttons.checkWallet')}
      </Button>
    </OnboardingLayout>
  ) : created ? (
    <AppLoadingSkeleton />
  ) : secrets.kind === 'import' && phrase ? (
    <PasswordForm onSubmit={onSubmit} />
  ) : (
    <Navigate to="/import" replace />
  );
};
