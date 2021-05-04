import  React, { FC, useState } from 'react';

import styles from './index.scss';
import Button from 'components/Button';
import TutorialPanel from './TutorialPanel';

const ConnectHardwareWalletView: FC = () => {
  const [selected, setSelected] = useState<boolean>(false);

  return (
    <div className={styles.wrapper} style={{ color: "white", textAlign: "center" }}>
      <p style={{ textAlign: "center" }}>Select a hardware wallet you'd like to use with Syscoin Wallet</p>

      <div className={styles.options}>
        <div className={selected ? styles.optionSelected : styles.option} onClick={() => setSelected(!selected)}>
          Trezor
        </div>
      </div>

      <p style={{ textAlign: "center" }}>Don't have a hardware wallet?</p>
      <p style={{ margin: "0 1rem 3rem", textAlign: "center" }}>Order a Trezor wallet and keep your funds in cold storage. Learn more.</p>

      <Button 
        type="submit"
        theme="btn-gradient-primary"
        variant={styles.button}
      >
        Connect
      </Button>

     <TutorialPanel />
    </div>
  );
};

export default ConnectHardwareWalletView;