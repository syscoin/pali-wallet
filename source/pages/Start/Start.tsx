import React from 'react';
import LogoImage from 'assets/images/logo-s.svg';
import { PrimaryButton, Link } from 'components/index';
import { useUtils } from 'hooks/index';

export const Start = () => {
  const { navigate } = useUtils();

  return (
    <div className="flex flex-col items-center justify-center mt-20 p-2 min-w-full">
      <p className="mb-2 text-center text-brand-deepPink100 text-lg font-normal tracking-wider">
        WELCOME TO
      </p>

      <h1 className="m-0 text-center text-brand-royalblue font-poppins text-4xl font-bold tracking-wide leading-4">
        Pali Wallet
      </h1>

      <img src={LogoImage} className="my-8 w-52" alt="syscoin" />

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
    </div>
  );
};
