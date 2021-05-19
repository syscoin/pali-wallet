import React, { FC, useState } from 'react';

import styles from './index.scss';
import Button from 'components/Button';
import TutorialPanel from './TutorialPanel';
var TrezorConnect = window.trezorConnect;
const ConnectHardwareWalletView: FC = () => {
  const [selected, setSelected] = useState<boolean>(false);


  const onclick = async () => {
    // TrezorConnect.manifest({
    //   email: 'developer@xyz.com',
    //   appUrl: 'http://your.application.com'
    // })
    TrezorConnect.getAddress({
      path: "m/49'/0'/0'/0/0",
      coin: "btc"
    });
    console.log(TrezorConnect)
  }
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
        onClick={onclick}
      >
        Connect
      </Button>

      <TutorialPanel />
    </div>
  );
};

export default ConnectHardwareWalletView;