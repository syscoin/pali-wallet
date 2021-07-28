import React, { FC, useState } from 'react';
import Button from 'components/Button';
import { useController } from 'hooks/index';

import styles from './index.scss';
import TutorialPanel from './TutorialPanel';

const ConnectHardwareWalletView: FC = () => {
  const [selected, setSelected] = useState<boolean>(false);
  const controller = useController();

  const onclick = async () => {
    controller.wallet.createHardwareWallet();

  };

  return (
    <div
      className={styles.wrapper}
      style={{ color: 'white', textAlign: 'center' }}
    >
      <p style={{ textAlign: 'center' }}>
        Select a hardware wallet you'd like to use with Pali Wallet
      </p>

      <div className={styles.options}>
        <div
          className={selected ? styles.optionSelected : styles.option}
          onClick={() => setSelected(!selected)}
        >
          Trezor
        </div>
      </div>

      <p style={{ textAlign: 'center' }}>Don't have a hardware wallet?</p>
      <p style={{ margin: '0 1rem 3rem', textAlign: 'center' }}>
        Order a Trezor wallet and keep your funds in cold storage.
        <a href="https://trezor.io/" target="_blank" rel="noreferrer">
          Buy now
        </a>
      </p>

      <Button
        type="submit"
        theme="btn-gradient-primary"
        variant={styles.button}
        onClick={onclick}
        disabled={!selected}
      >
        Connect
      </Button>

      <TutorialPanel />
    </div>
  );
};

export default ConnectHardwareWalletView;
