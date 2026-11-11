import { Form, Input } from 'antd';
import React, {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from 'components/index';
import { refreshControllerStatus } from 'hooks/controllerStatus';
import { useQueryData } from 'hooks/index';
import { useController } from 'hooks/useController';
import { useUtils } from 'hooks/useUtils';
import { dispatchBackgroundEvent } from 'utils/browser';
import { extractErrorMessage } from 'utils/index';
import { clearTransactionNavigationState } from 'utils/navigationState';

import { LocalPasskeyUnlock } from './LocalPasskeyUnlock';
import { StartFreshWallet } from './StartFreshWallet';

const Unlock: React.FC<{
  allowFreshStart?: boolean;
  externalRoute: string;
  isExternal: boolean;
  onFreshStartOpenChange?: (open: boolean) => void;
  setIsOpenValidation: Dispatch<SetStateAction<boolean>>;
}> = ({
  allowFreshStart = false,
  isExternal,
  externalRoute,
  onFreshStartOpenChange,
  setIsOpenValidation,
}) => {
  const { navigate, alert } = useUtils();
  const { controllerEmitter } = useController();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [isResetOpen, setIsResetOpen] = useState(false);
  const onResetOpenChange = useCallback(
    (open: boolean) => {
      setIsResetOpen(open);
      onFreshStartOpenChange?.(open);
    },
    [onFreshStartOpenChange]
  );
  const submitting = useRef(false);
  const { t, i18n } = useTranslation();
  const { language } = i18n;

  // Get query data to check if this is an authentication popup
  const queryData = useQueryData();
  const { host, eventName } = queryData;
  const navigation = useMemo(
    () => ({ isExternal, externalRoute, host, eventName }),
    [isExternal, externalRoute, host, eventName]
  );
  const latestNavigation = useRef(navigation);
  latestNavigation.current = navigation;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const finishUnlock = async () => {
    const captured = navigation;
    if (!(await refreshControllerStatus()))
      throw new Error(t('start.unlockConfirmationFailed'));
    if (!mounted.current || latestNavigation.current !== captured) return;
    setErrorMessage(null);
    if (!captured.isExternal) return navigate('/home');
    if (
      (!captured.externalRoute ||
        captured.externalRoute.includes('/external/login')) &&
      captured.host &&
      captured.eventName
    ) {
      await clearTransactionNavigationState();
      if (!mounted.current || latestNavigation.current !== captured) return;
      dispatchBackgroundEvent(`${captured.eventName}.${captured.host}`, null);
      window.close();
      return;
    }
    return navigate(captured.externalRoute);
  };

  const onSubmit = async ({ password }: { password: string }) => {
    if (submitting.current || isResetOpen) return;
    submitting.current = true;
    try {
      setIsLoading(true);

      const unlocked = await controllerEmitter(
        ['wallet', 'unlockFromController'],
        [password]
      );
      if (unlocked !== true) throw new Error(t('start.wrongPassword'));
      return await finishUnlock();
    } catch (e) {
      if (!mounted.current) return;
      setIsLoading(false);

      // Extract the actual error message
      const errorMsg = extractErrorMessage(e, t('start.wrongPassword'));

      // Check if it's a rate limiting error
      if (errorMsg.includes('Too many failed attempts')) {
        // Show rate limiting error as an alert for better visibility
        alert.error(errorMsg);
      } else {
        // For regular password errors, show in the form
        setErrorMessage(errorMsg);
      }
    } finally {
      submitting.current = false;
    }
  };

  return (
    <>
      <Form
        className="flex flex-col gap-6 items-center justify-center w-full max-w-md text-center"
        name="basic"
        onFinish={onSubmit}
        autoComplete="on"
        id="login"
      >
        <Form.Item
          name="password"
          className="w-[17.5rem]"
          validateStatus={errorMessage ? 'error' : undefined}
          hasFeedback={!!errorMessage}
          help={errorMessage}
        >
          <Input.Password
            disabled={isResetOpen || isLoading || passkeyBusy}
            className="custom-input-password relative"
            placeholder={t('settings.enterYourPassword')}
            aria-label={t('settings.enterYourPassword')}
            id="password"
            autoComplete="current-password"
          />
        </Form.Item>

        <Form.Item>
          <Button
            id="unlock-btn"
            type="submit"
            className="bg-brand-deepPink100 w-[17.5rem] h-10 text-bkg-1 text-base	 font-base font-medium rounded-2xl"
            loading={isLoading}
            disabled={isResetOpen || passkeyBusy}
          >
            {t('buttons.unlock')}
          </Button>
        </Form.Item>
      </Form>
      <LocalPasskeyUnlock
        key={`${isExternal}:${externalRoute}:${host}:${eventName}`}
        disabled={isLoading || isResetOpen}
        onStart={() => {
          if (submitting.current || isResetOpen) return false;
          submitting.current = true;
          setPasskeyBusy(true);
          return true;
        }}
        onSettled={() => {
          submitting.current = false;
          setPasskeyBusy(false);
        }}
        onUnlocked={finishUnlock}
      />
      <button
        type="button"
        disabled={isLoading || passkeyBusy || isResetOpen}
        className={`mt-7 hover:text-brand-graylight text-[#A2A5AB] ${
          language === 'es' ? 'text-xs' : 'text-base'
        } font-light transition-all duration-300 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60`}
        id="import-wallet-link"
        onClick={() => {
          if (!submitting.current && !isResetOpen) setIsOpenValidation(true);
        }}
      >
        {t('start.importUsing')}
      </button>
      {allowFreshStart && !isExternal && (
        <StartFreshWallet
          disabled={isLoading || passkeyBusy}
          onOpenChange={onResetOpenChange}
        />
      )}
    </>
  );
};

export default Unlock;
