import { Form, Input } from 'antd';
import React, { Dispatch, SetStateAction, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from 'components/index';
import { useQueryData } from 'hooks/index';
import { useController } from 'hooks/useController';
import { useUtils } from 'hooks/useUtils';
import { dispatchBackgroundEvent } from 'utils/browser';
import { extractErrorMessage } from 'utils/index';
import { clearNavigationState } from 'utils/navigationState';

const Unlock: React.FC<{
  externalRoute: string;
  isExternal: boolean;
  setIsOpenValidation: Dispatch<SetStateAction<boolean>>;
}> = ({ isExternal, externalRoute, setIsOpenValidation }) => {
  const { navigate, alert } = useUtils();
  const { controllerEmitter } = useController();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { t, i18n } = useTranslation();
  const { language } = i18n;

  // Get query data to check if this is an authentication popup
  const queryData = useQueryData();
  const { host, eventName } = queryData;

  const onSubmit = async ({ password }: { password: string }) => {
    try {
      setIsLoading(true);

      await controllerEmitter(['wallet', 'unlockFromController'], [password]);

      // unlockFromController returns true on success, false on invalid password
      // If we get here without throwing, it was successful
      setErrorMessage(null);

      if (!isExternal) {
        return navigate('/home');
      }

      // Check if this is an authentication popup (external with login route or no externalRoute)
      if (
        isExternal &&
        (!externalRoute || externalRoute.includes('/external/login')) &&
        host &&
        eventName
      ) {
        // This is an authentication popup - dispatch success
        // Let the pipeline continue and close when the final response is ready
        clearNavigationState();
        dispatchBackgroundEvent(`${eventName}.${host}`, null);
        window.close();
        // Note: Window will be closed by popup promise after pipeline completes
        return;
      }

      // For external routes, navigate to the destination
      return navigate(externalRoute as string);
    } catch (e) {
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
    }
  };

  return (
    <>
      <Form
        className="flex flex-col gap-6 items-center justify-center w-full max-w-xs text-center md:max-w-md"
        name="basic"
        onFinish={onSubmit}
        autoComplete="off"
        id="login"
      >
        <Form.Item
          name="password"
          className="w-full flex justify-center"
          validateStatus={errorMessage ? 'error' : undefined}
          hasFeedback={!!errorMessage}
          help={errorMessage}
        >
          <Input.Password
            className="custom-input-password relative"
            placeholder={t('settings.enterYourPassword')}
            id="password"
          />
        </Form.Item>

        <Form.Item>
          <Button
            id="unlock-btn"
            type="submit"
            className="bg-brand-deepPink100 w-[17.5rem] h-10 text-white text-base	 font-base font-medium rounded-2xl"
            loading={isLoading}
          >
            {t('buttons.unlock')}
          </Button>
        </Form.Item>
      </Form>
      <a
        className={`mt-7 hover:text-brand-graylight text-[#A2A5AB] ${
          language === 'es' ? 'text-xs' : 'text-base'
        } font-light transition-all duration-300 cursor-pointer`}
        id="import-wallet-link"
        onClick={() => setIsOpenValidation(true)}
      >
        {t('start.importUsing')}
      </a>
    </>
  );
};

export default Unlock;
