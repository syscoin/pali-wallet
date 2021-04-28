import  React, { FC, useState, useCallback } from 'react';

import styles from './index.scss';
import Button from 'components/Button';
import TutorialPanel from './TutorialPanel';

const AccountView: FC = () => {
  const [toggle, setToggle] = useState<boolean>(false);

  return (
    <div className={styles.wrapper} style={{ color: "white", textAlign: "center" }}>
      <p style={{ textAlign: "center" }}>Select a hardware wallet you'd like to use with Syscoin Wallet</p>

      <div className={styles.options}>
        <div className={styles.option}>
          Ledger
        </div>

        <div className={styles.option}>
          Trezor
        </div>
      </div>

      <Button 
        type="submit"
        theme="btn-gradient-primary"
        variant={styles.button}
      >
        Connect
      </Button>

      <p style={{ marginTop: "1rem", textAlign: "center" }}>Don't have a hardware wallet?</p>
      <p style={{ margin: "0 1rem", textAlign: "center" }}>Order a Ledger or a Trezor wallet and keep your funds in cold storage. Learn more.</p>

     <TutorialPanel />
    </div>
  );
};

export default AccountView;