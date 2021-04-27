import  React, { FC, useState } from 'react';

import styles from './index.scss';
import Button from 'components/Button';

const AccountView: FC = () => {
  const [selected, setSelected] = useState(false);

  return (
    <div className={styles.centered}>
      <h1>Connect a hardware wallet</h1>
      <p>Select a hardware wallet you'd like to use with Syscoin Wallet</p>

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

      <p style={{ marginTop: "1rem" }}>Don't have a hardware wallet?</p>
      <p style={{ margin: "0 1rem" }}>Order a Ledger or a Trezor wallet and keep your funds in cold storage. Learn more.</p>
    </div>
  );
};

export default AccountView;