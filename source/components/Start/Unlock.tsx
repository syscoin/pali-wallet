import { Form, Input } from 'antd';
import React, { Dispatch, SetStateAction, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from 'components/index';
import { useController } from 'hooks/useController';
import { useUtils } from 'hooks/useUtils';
import { migrateWalletState } from 'state/migrateWalletState';

const Unlock: React.FC<{
  externalRoute: string;
  isExternal: boolean;
  setIsOpenValidation: Dispatch<SetStateAction<boolean>>;
}> = ({ isExternal, externalRoute, setIsOpenValidation }) => {
  const { navigate } = useUtils();
  const { controllerEmitter } = useController();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { t, i18n } = useTranslation();
  const { language } = i18n;

  const onSubmit = async ({ password }: { password: string }) => {
    try {
      setIsLoading(true);
      await migrateWalletState('persist:root', 'state', true);

      const result = await controllerEmitter(
        ['wallet', 'unlockFromController'],
        [password]
      );

      if (!result) {
        setErrorMessage(t('start.wrongPassword'));
        setIsLoading(false);
        return;
      }

      setErrorMessage(null);

      if (!isExternal) {
        return navigate('/home');
      }

      return navigate(externalRoute);
    } catch (e) {
      setErrorMessage(t('start.wrongPassword'));
      setIsLoading(false);
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
          validateStatus={'error'}
          hasFeedback={!!errorMessage}
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
