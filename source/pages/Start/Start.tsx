import React from 'react';
import { useForm } from 'react-hook-form';
import { useSelector } from 'react-redux';
import { Link } from 'react-router-dom';

import LogoImage from 'assets/images/logo-s.svg';
import { PrimaryButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';

export const Start = (props: any) => {
  const { navigate } = useUtils();
  const {
    wallet: { unlock, checkPassword },
  } = getController();
  const encryptedMnemonic = useSelector(
    (state: RootState) => state.vault.encryptedMnemonic
  );

  const { isExternal, externalRoute } = props;
  const { handleSubmit, register } = useForm({
    reValidateMode: 'onChange',
  });

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
    await unlock(password);

    if (!isExternal) {
      navigate('/home');

      return true;
    }

    navigate(externalRoute);

    return true;
  };

  const unLock = (
    <>
      <form
        className="flex flex-col gap-6 items-center justify-center text-center"
        onSubmit={handleSubmit(onSubmit)}
      >
        <input
          type="password"
          placeholder="Enter your password"
          className="input-small relative md:w-full"
          {...register('password', {
            required: true,
            validate: {
              checkPwd: async (value) => {
                const isValid = checkPassword(value);

                if (!isValid) return false;

                return await onSubmit({ password: value });
              },
            },
          })}
        />

        <PrimaryButton type="submit">Unlock</PrimaryButton>
      </form>

      <Link
        className="mt-10 hover:text-brand-graylight text-brand-royalblue text-base font-light transition-all duration-300"
        to="/import"
        id="import-wallet-link"
      >
        Import using wallet seed phrase
      </Link>
    </>
  );

  return (
    <div className="flex flex-col items-center justify-center p-2 pt-20 min-w-full">
      <p className="mb-2 text-center text-brand-deepPink100 text-lg font-normal tracking-wider">
        WELCOME TO
      </p>

      <h1 className="m-0 text-center text-brand-royalblue font-poppins text-4xl font-bold tracking-wide leading-4">
        Pali Wallet
      </h1>

      <img src={LogoImage} className="my-8 w-52" alt="syscoin" />

      {encryptedMnemonic ? unLock : getStarted}
    </div>
  );
};
