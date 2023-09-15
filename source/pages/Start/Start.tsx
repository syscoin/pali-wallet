import { Form, Input } from 'antd';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { Link } from 'react-router-dom';

import LogoImage from 'assets/images/logo-s.svg';
import { PrimaryButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';

import { ValidationModal } from './Modal';

export const Start = (props: any) => {
  const { navigate } = useUtils();
  const {
    wallet: { unlockFromController },
  } = getController();
  const { accounts, activeAccount } = useSelector(
    (state: RootState) => state.vault
  );
  const [isOpenValidation, setIsOpenValidation] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { t, i18n } = useTranslation();
  const { language } = i18n;
  const { isExternal, externalRoute } = props;

  const isFirstStep =
    accounts[activeAccount.type][activeAccount.id].address === '';

  const getStarted = (
    <>
      <PrimaryButton type="submit" onClick={() => navigate('/create-password')}>
        Get started
      </PrimaryButton>

      <Link
        className="mt-20 hover:text-brand-graylight text-brand-royalbluemedium font-poppins text-base font-light transition-all duration-300"
        to="/import"
        id="import-wallet-link"
      >
        Import using wallet seed phrase
      </Link>
    </>
  );

  const onSubmit = async ({ password }: { password: string }) => {
    try {
      const result = await unlockFromController(password);

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

  const unLock = (
    <>
      <Form
        className="flex flex-col gap-8 items-center justify-center w-full max-w-xs text-center md:max-w-md"
        name="basic"
        onFinish={onSubmit}
        autoComplete="off"
        id="login"
      >
        <Form.Item
          name="password"
          className="w-full"
          validateStatus={'error'}
          hasFeedback={!!errorMessage}
        >
          <Input.Password
            className="input-small relative"
            placeholder={t('settings.enterYourPassword')}
            id="password"
          />
        </Form.Item>
        {!!errorMessage && (
          <p className="m-[-20px] p-0 w-full text-center text-red-600 font-poppins text-xs">
            {errorMessage}
          </p>
        )}

        <Form.Item>
          <PrimaryButton type="submit" id="unlock-btn">
            {t('buttons.unlock')}
          </PrimaryButton>
        </Form.Item>
      </Form>
      <a
        className={`mt-10 hover:text-brand-graylight text-brand-royalblue ${
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
    <div className="flex flex-col items-center justify-center p-2 pt-20 min-w-full">
      <ValidationModal
        setIsOpen={setIsOpenValidation}
        showModal={isOpenValidation}
      />
      <p className="mb-2 text-center text-brand-deepPink100 text-lg font-normal tracking-wider">
        {t('start.welcomeTo')}
      </p>

      <h1 className="m-0 text-center text-brand-royalblue font-poppins text-4xl font-bold tracking-wide leading-4">
        Pali Wallet
      </h1>

      <img src={LogoImage} className="my-8 w-52" alt="syscoin" />

      {isFirstStep ? getStarted : unLock}
    </div>
  );
};
