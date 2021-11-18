import React from 'react';
import { Link } from 'components/index';
import LogoImage from 'assets/images/logo-s.svg';
import { useUtils } from 'hooks/index';
import { Button } from 'antd';

const Start = () => {
  const { history } = useUtils();
  
  return (
    <div className="mt-20 flex justify-center items-center flex-col min-w-full p-2">
      <p className=" text-brand-deepPink100 text-center text-lg  font-normal mb-2 tracking-wider">WELCOME TO</p>

      <h1 className="text-brand-royalBlue font-bold text-center text-4xl m-0 font-sans leading-4 tracking-wide"
      >Pali Wallet</h1> 

      <img src={LogoImage} className="w-52 my-8" alt="syscoin" />
     
      <div className="p-0.5 bg-primary rounded-full">
        <Button
          className="bg-brand-navy tracking-normal text-base py-2.5 px-12 cursor-pointer rounded-full text-brand-white hover:bg-gradient-primary"
          onClick={() => history.push('/create/pass')}
        >
          Get Started
        </Button>
      </div>
      
      <Link className="text-brand-deepPink font-light mt-20 text-base text-brand-royalBlue transition-all duration-300" to="/import">
        Import using wallet seed phrase
      </Link>
    </div> 
  );
};

export default Start;
