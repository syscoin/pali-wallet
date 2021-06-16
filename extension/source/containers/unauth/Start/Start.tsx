import React from 'react';
import Button from 'components/Button';
import Link from 'components/Link';
import LogoImage from 'assets/images/logo.svg';

import styles from './Start.scss';

const Start = () => {
  return (
    <div className={styles.home}>
      <h1 className="heading-start full-width t-roboto t-royalBlue">
        <p>Welcome to</p>
        <br />
        <b>Pali Wallet</b>
      </h1>
      <img src={`/${LogoImage}`} className={styles.logo} alt="syscoin" />
      <Button
        type="submit"
        theme="btn-gradient-primary"
        variant={styles.started}
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
