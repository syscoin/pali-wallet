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
    >
      <span className={styles.textCenter}>
        Select a hardware wallet you'd like to use with Pali Wallet
      </span>

      <div className={styles.options}>
        <div
          className={selected ? styles.optionSelected : styles.option}
          onClick={() => setSelected(!selected)}
        >
          Trezor
        </div>
      </div>

      <span className={styles.textCenter}>Don't have a hardware wallet?</span>
      <span className={styles.textGap}>
        Order a Trezor wallet and keep your funds in cold storage.
      </span>

      <a className={styles.link} href="https://trezor.io/" target="_blank" rel="noreferrer">
        Buy now
      </a>

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
