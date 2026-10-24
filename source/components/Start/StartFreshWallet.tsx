import { ExclamationIcon } from '@heroicons/react/outline';
import { Input } from 'antd';
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  CenterPanel,
  DialogActionButton,
  DialogActions,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogPrimitive,
} from 'components/Dialog';
import { useController } from 'hooks/useController';
import { useOnboardingSecrets } from 'hooks/useOnboardingSecrets';
import { reloadWalletForRecovery } from 'utils/reloadWalletForRecovery';

type ResetStage = 'beginning' | 'failed' | 'ready' | 'submitting' | 'uncertain';

export const StartFreshWallet = ({
  disabled,
  onOpenChange,
}: {
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const { t } = useTranslation();
  const { controllerEmitter } = useController();
  const { clear } = useOnboardingSecrets();
  const [show, setShow] = useState(false);
  const [stage, setStage] = useState<ResetStage>('beginning');
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);
  const showing = useRef(false);
  const submitting = useRef(false);
  const generation = useRef(0);
  const ticket = useRef<string>();
  const acknowledgementId = useId();
  const confirmationId = useId();

  const close = useCallback(() => {
    if (submitting.current) return;
    generation.current += 1;
    ticket.current = undefined;
    showing.current = false;
    setAcknowledged(false);
    setConfirmation('');
    setShow(false);
    onOpenChange(false);
  }, [onOpenChange]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      ticket.current = undefined;
    };
  }, []);

  useEffect(() => {
    const discard = () => {
      if (!showing.current) return;
      if (submitting.current) {
        generation.current += 1;
        ticket.current = undefined;
        setStage('uncertain');
      } else close();
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') discard();
    };
    window.addEventListener('pagehide', discard);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('pagehide', discard);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [close]);

  const open = async () => {
    if (disabled || showing.current) return;
    const request = ++generation.current;
    showing.current = true;
    ticket.current = undefined;
    setAcknowledged(false);
    setConfirmation('');
    setStage('beginning');
    setShow(true);
    onOpenChange(true);
    try {
      const nextTicket = await controllerEmitter(
        ['wallet', 'beginLockedWalletReset'],
        [],
        10000,
        false
      );
      if (!mounted.current || request !== generation.current) return;
      if (typeof nextTicket !== 'string' || !nextTicket) {
        throw new Error('Invalid reset admission');
      }
      ticket.current = nextTicket;
      setStage('ready');
    } catch {
      if (mounted.current && request === generation.current) {
        setStage('failed');
      }
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      submitting.current ||
      stage !== 'ready' ||
      !acknowledged ||
      confirmation !== 'ERASE' ||
      !ticket.current
    )
      return;
    submitting.current = true;
    const request = ++generation.current;
    const admittedTicket = ticket.current;
    ticket.current = undefined;
    setStage('submitting');
    clear();
    try {
      const reset = await controllerEmitter(
        ['wallet', 'resetLockedWallet'],
        [admittedTicket, 'ERASE'],
        10000,
        false
      );
      if (!mounted.current || request !== generation.current) return;
      if (reset !== true) throw new Error('Reset was not acknowledged');
      reloadWalletForRecovery();
    } catch {
      if (mounted.current && request === generation.current) {
        setStage('uncertain');
      }
    }
  };

  const blocked = stage === 'submitting' || stage === 'uncertain';
  const canSubmit =
    stage === 'ready' && acknowledged && confirmation === 'ERASE';

  return (
    <>
      <button
        id="erase-wallet-link"
        type="button"
        disabled={disabled || show}
        onClick={open}
        className="mt-4 min-h-[44px] max-w-full px-2 text-center text-sm text-content-secondary underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-primary disabled:cursor-not-allowed disabled:opacity-60"
      >
        {t('start.eraseAndStartFresh')}
      </button>
      <DialogPrimitive show={show} onClose={close} initialFocus={cancelRef}>
        <CenterPanel padded={false} scroll={false} className="flex flex-col">
          <form
            id="erase-wallet-confirmation"
            onSubmit={submit}
            aria-busy={stage === 'beginning' || stage === 'submitting'}
            className="flex min-h-0 max-h-[calc(100dvh-2rem)] flex-col"
          >
            <DialogHeader
              title={t('start.eraseConfirm')}
              icon={<ExclamationIcon />}
              onClose={close}
              disabled={blocked}
            />
            <DialogBody className="space-y-4">
              <p>{t('start.eraseWarning')}</p>
              <p>{t('start.eraseFundsWarning')}</p>
              {stage === 'beginning' && (
                <p role="status">{t('buttons.loading')}</p>
              )}
              {stage === 'failed' && (
                <p role="alert">{t('start.eraseFailed')}</p>
              )}
              {stage === 'uncertain' ? (
                <p role="alert">{t('start.eraseUncertain')}</p>
              ) : (
                <>
                  <label
                    htmlFor={acknowledgementId}
                    className="flex min-h-[44px] cursor-pointer items-start gap-3 py-2"
                  >
                    <input
                      id={acknowledgementId}
                      type="checkbox"
                      checked={acknowledged}
                      disabled={stage !== 'ready'}
                      onChange={(event) =>
                        setAcknowledged(event.target.checked)
                      }
                      className="mt-1 h-4 w-4 shrink-0"
                    />
                    <span>{t('start.eraseAcknowledge')}</span>
                  </label>
                  <label htmlFor={confirmationId} className="block space-y-2">
                    <span className="block">
                      {t('start.eraseTypeConfirmation', { word: 'ERASE' })}
                    </span>
                    <Input
                      id={confirmationId}
                      value={confirmation}
                      disabled={stage !== 'ready'}
                      onChange={(event) => setConfirmation(event.target.value)}
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      className="custom-input-normal"
                    />
                  </label>
                </>
              )}
            </DialogBody>
            <DialogFooter>
              {stage === 'uncertain' ? (
                <DialogActions>
                  <DialogActionButton
                    id="erase-check-wallet"
                    type="button"
                    onClick={reloadWalletForRecovery}
                  >
                    {t('buttons.checkWallet')}
                  </DialogActionButton>
                </DialogActions>
              ) : (
                <DialogActions>
                  <DialogActionButton
                    ref={cancelRef}
                    id="cancel-erase-wallet"
                    type="button"
                    tone="secondary"
                    disabled={blocked}
                    onClick={close}
                  >
                    {t('buttons.cancel')}
                  </DialogActionButton>
                  <DialogActionButton
                    id="confirm-erase-wallet"
                    type="submit"
                    tone="danger"
                    disabled={!canSubmit}
                    loading={stage === 'submitting'}
                  >
                    {t('start.eraseConfirm')}
                  </DialogActionButton>
                </DialogActions>
              )}
            </DialogFooter>
          </form>
        </CenterPanel>
      </DialogPrimitive>
    </>
  );
};
