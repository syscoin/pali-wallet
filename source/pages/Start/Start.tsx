import { Form, Input } from 'antd';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Button } from 'components/index';
import { ImportWalletWarning } from 'components/Modal/WarningBaseModal';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { migrateWalletState } from 'state/migrateWalletState';

export const Start = (props: any) => {
  const { navigate } = useUtils();
  const [isOpenValidation, setIsOpenValidation] = useState(false);
  const [hasAccount, setHasAccount] = useState(false);
  const { controllerEmitter } = useController();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { t, i18n } = useTranslation();
  const { language } = i18n;
  const { isExternal, externalRoute } = props;
  const hasVault = !!JSON.parse(localStorage.getItem('sysweb3-vault'));
  const isFirstStep = !hasAccount && !hasVault;

  useEffect(() => {
    const checkAccounts = async () => {
      const result: any = await controllerEmitter([
        'wallet',
        'getActiveAccount',
      ]);

      setHasAccount(!!result.activeAccount.address);
    };

    checkAccounts();

    return () => {
      checkAccounts();
    };
  }, []);

  const onSubmit = async ({ password }: { password: string }) => {
    try {
      await migrateWalletState('persist:root', 'state', hasAccount);

      const result = await controllerEmitter(
        ['wallet', 'unlockFromController'],
        [password]
      );

      if (!result) {
        setErrorMessage(t('start.wrongPassword'));
        return;
      }

      setErrorMessage(null);

      if (!isExternal) {
        return navigate('/home');
      }

      return navigate(externalRoute);
    } catch (e) {
      setErrorMessage(t('start.wrongPassword'));
    }
  };

  const getStarted = (
    <>
      <Button
        id="unlock-btn"
        type="submit"
        onClick={() => navigate('/create-password')}
        className="bg-brand-deepPink100 w-[17.5rem] mt-3 h-10 text-white text-base font-base font-medium rounded-2xl"
      >
        Get started
      </Button>
      <Link
        className={`mt-9 hover:text-brand-graylight text-[#A2A5AB] ${
          language === 'es' ? 'text-xs' : 'text-base'
        } font-light transition-all duration-300 cursor-pointer`}
        to="/import"
        id="import-wallet-link"
      >
        Import using wallet seed phrase
      </Link>
    </>
  );

  const unLock = (
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

  return (
    <div className="flex flex-col items-center bg-no-repeat bg-[url('../../../source/assets/images/GET_STARTED2.png')] justify-center min-w-full h-screen">
      <ImportWalletWarning
        title={t('settings.importWalletWarning')}
        phraseOne={t('settings.thisActionErases')}
        phraseTwo={t('settings.toRestoreThis')}
        phraseThree={t('settings.allYourSettings')}
        onClose={setIsOpenValidation}
        show={isOpenValidation}
      />
      <p className=" pt-[14rem] mb-2 text-center text-white text-opacity-92 font-poppins text-sm font-light leading-normal tracking-[0.175rem]">
        {t('start.welcomeTo')}
      </p>

      <div className="flex flex-row gap-3 mb-6">
        <h1 className="text-[#4DA2CF] text-justify font-poppins text-[37.87px] font-bold leading-[37.87px] tracking-[0.379px]">
          Pali
        </h1>
        <h1 className="text-[#4DA2CF] font-poppins text-[37.87px] font-light leading-[37.87px] tracking-[0.379px]">
          Wallet
        </h1>
      </div>
      {isFirstStep ? getStarted : unLock}
    </div>
  );
};
