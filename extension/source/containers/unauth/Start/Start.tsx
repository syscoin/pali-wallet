import React from 'react';
import LogoImage from 'assets/images/logo-s.svg';
import { Button, Link } from 'components/index';
import { useUtils } from 'hooks/index';

export const Start = () => {
  const { history } = useUtils();

  return (
    <div className="mt-20 flex justify-center items-center flex-col min-w-full p-2">
      <p className=" text-brand-deepPink100 text-center text-lg  font-normal mb-2 tracking-wider">WELCOME TO</p>

      <h1 className=" text-brand-royalBlue font-bold text-center text-4xl m-0 font-sans leading-4 tracking-wide"
      >Pali Wallet</h1>

      <img src={LogoImage} className="w-52 my-8" alt="syscoin" />

      <Button
        type="submit"
        onClick={() => history.push('/create/pass')}
      >
        Get started
      </Button>

      <Link className="font-light mt-20 text-base hover:text-brand-graylight text-brand-royalBluemedium transition-all duration-300" to="/import">
        Import using wallet seed phrase
      </Link>
    </div>
  );
};
