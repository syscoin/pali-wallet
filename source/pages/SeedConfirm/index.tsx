import React, { useEffect, useRef, useState } from 'react';
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

  const [passedGeneration, setPassedGeneration] = useState<number>();
  const [created, setCreated] = useState(false);
  const creationRequested = useRef(false);
  const { secrets, clear, consumeContinuation } = useOnboardingSecrets();
  const { password, phrase: createdSeed } = secrets;
  const { state } = useLocation();
  const next = state?.next === true;
  // A -> B -> A is a new confirmation, even when the phrase text returns.
  const liveConfirmation = useRef({
    seed: createdSeed,
    password,
    kind: secrets.kind,
    next,
    generation: 0,
    confirmed: false,
  });
  if (
    liveConfirmation.current.seed !== createdSeed ||
    liveConfirmation.current.password !== password ||
    liveConfirmation.current.kind !== secrets.kind
  ) {
    liveConfirmation.current = {
      seed: createdSeed,
      password,
      kind: secrets.kind,
      next,
      generation: liveConfirmation.current.generation + 1,
      confirmed: false,
    };
  } else liveConfirmation.current.next = next;
  const generation = liveConfirmation.current.generation;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const isCurrentConfirmation = () =>
    mounted.current &&
    liveConfirmation.current.generation === generation &&
    liveConfirmation.current.next &&
    liveConfirmation.current.kind === 'create' &&
    Boolean(liveConfirmation.current.seed && liveConfirmation.current.password);
  const passed = passedGeneration === generation;
  const setPassed = (value: boolean) => {
    if (isCurrentConfirmation()) {
      liveConfirmation.current.confirmed = value;
      setPassedGeneration(value ? generation : undefined);
    }
  };

  const handleConfirm = async () => {
    if (
      liveConfirmation.current.confirmed &&
      isCurrentConfirmation() &&
      !creationRequested.current
    ) {
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
        if (!mounted.current) return;
        alert.error(t('settings.walletSetupFailed'));
        reloadWalletForRecovery();
        return;
      }

      if (!mounted.current) return;
      const confirmed = await refreshControllerStatus();
      if (!mounted.current) return;
      if (confirmed) {
        const destination = consumeContinuation();
        if (destination) navigate(destination, { replace: true });
        else navigate('/home');
      } else reloadWalletForRecovery();
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
          key={generation}
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
