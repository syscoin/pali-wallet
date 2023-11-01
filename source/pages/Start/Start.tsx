import { Form, Input } from 'antd';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { Link } from 'react-router-dom';

import { PrimaryButton, Button } from 'components/index';
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
            className="bg-brand-deepPink100 w-[17.5rem] h-10 text-white font-base font-medium rounded-2xl"
          >
            {t('buttons.unlock')}
          </Button>
        </Form.Item>
      </Form>
      <a
        className={`mt-10 hover:text-brand-graylight text-[#A2A5AB] ${
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
    <div className="flex flex-col items-center bg-[url('../../../source/assets/images/GET_STARTED2.png')] justify-center min-w-full h-full">
      <ValidationModal
        setIsOpen={setIsOpenValidation}
        showModal={isOpenValidation}
      />
      <p className=" pt-[13rem] mb-2 text-center text-white text-opacity-92 font-poppins text-sm font-light leading-normal tracking-[0.175rem]">
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
