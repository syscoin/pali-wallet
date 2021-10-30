import React from 'react';
import Button from 'components/Button';
import Link from 'components/Link';
import LogoImage from 'assets/images/logo.svg';

const Start = () => {
  return (
    <div>
      <h1 className="heading-start full-width t-roboto t-royalBlue">
        <p>Welcome to</p>
        <br />
        Pali Wallet
      </h1>
      <img src={`/${LogoImage}`} alt="syscoin" />
      <Button
        type="submit"
        theme="btn-gradient-primary"
        linkTo="/create/pass"
      >
        Get started
      </Button>
      <Link color="tertiary" to="/import">
        Import using wallet seed phrase
      </Link>
    </div>
  );
};

export default Start;
